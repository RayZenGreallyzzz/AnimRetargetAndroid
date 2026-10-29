import * as THREE from 'three';

/** Conservative vertex clustering. It is not semantic retopology.
 * Original geometry remains untouched. Skinned vertices carry valid 4-weight data.
 */
export function describe(root) {
  const meshes=[];
  root.traverse(node=>{
    if (!node.isMesh || !node.geometry) return;
    const g=node.geometry, pos=g.getAttribute('position');
    if(!pos) return;
    const triangles=Math.floor((g.index?.count || pos.count)/3);
    meshes.push({node,name:node.name||node.uuid.slice(0,8),vertices:pos.count,triangles,
      skinned:!!node.isSkinnedMesh,bones:node.isSkinnedMesh?(node.skeleton?.bones.length||0):0,
      morphs:Object.keys(g.morphAttributes||{}).some(k=>g.morphAttributes[k]?.length),
      groups:g.groups.length,uv:!!g.getAttribute('uv')});
  });
  return {meshes,vertices:meshes.reduce((v,m)=>v+m.vertices,0),
    triangles:meshes.reduce((v,m)=>v+m.triangles,0)};
}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function normalizedTop4(entries,fallback=0){
  const map=new Map();
  for(const [bone,weight] of entries){
    if(!Number.isFinite(bone)||!Number.isFinite(weight)||weight<=0)continue;
    map.set(Math.round(bone),(map.get(Math.round(bone))||0)+weight);
  }
  const sorted=[...map].sort((a,b)=>b[1]-a[1]).slice(0,4);
  let sum=sorted.reduce((a,b)=>a+b[1],0);
  if(sum<=1e-8){sorted.splice(0,sorted.length,[fallback,1]);sum=1;}
  const joints=[0,0,0,0],weights=[0,0,0,0];
  for(let i=0;i<sorted.length;i++){joints[i]=sorted[i][0];weights[i]=sorted[i][1]/sum;}
  return {joints,weights};
}
function normalKey(attrs,i){
  const a=attrs.normal;
  return a?[Math.round(a.getX(i)*6),Math.round(a.getY(i)*6),Math.round(a.getZ(i)*6)].join(':'):'';
}
function jointKey(attrs,i){
  const joint=attrs.skinIndex,weight=attrs.skinWeight;
  if(!joint||!weight)return '';
  const ids=[];
  for(let j=0;j<4;j++)if(weight.getComponent(i,j)>.08)ids.push(joint.getComponent(i,j));
  return ids.sort((a,b)=>a-b).join(':');
}
const supported=new Set(['position','normal','uv','uv1','uv2','color','skinIndex','skinWeight']);
function cluster(g,cell,options={}){
  const attrs=g.attributes,pos=attrs.position;
  if(Object.values(g.morphAttributes||{}).some(a=>a?.length))
    return {reason:'Содержит морфы лица: упрощение отключено для сохранения мимики.'};
  if(g.groups.length>1)return {reason:'Несколько групп материалов: нужна защита раздельных поверхностей.'};
  if(Object.keys(attrs).some(n=>!supported.has(n)))return {reason:'Нестандартные атрибуты меша: небезопасно менять сетку.'};
  if(!pos)return {reason:'Нет POSITION.'};
  if(!!attrs.skinIndex!==!!attrs.skinWeight)return {reason:'Некорректные skin weights.'};
  const count=pos.count,uv=attrs.uv;
  // Avoid copying huge index buffers into an Array<number> (~8 bytes/entry).
  // Keep the original typed index view and generate sequential indices on demand.
  const index=g.index,source=index?.array||null,sourceLength=index?.count??count;
  const map=new Map(),buckets=[],oldToNew=new Int32Array(count);
  // UV coordinates are dimensionless, while cell is in POSITION units.
  // gltfpack can quantize POSITION to 0..16383 and remap UV via a ×16
  // KHR_texture_transform. Scaling UV cells from POSITION length (old code)
  // collapsed an entire texture atlas into one bucket despite "protect UV".
  const texSize=Math.max(128,Math.min(16384,Number(options.textureSize)||2048));
  const uvRepeat=Math.max(1,Math.min(128,Number(options.uvRepeat)||1));
  const maxUvTexels=Math.max(.5,Math.min(64,Number(options.maxUvTexels)||4));
  const uvCell=maxUvTexels/(texSize*uvRepeat);
  for(let i=0;i<count;i++){
    let key=[Math.floor(pos.getX(i)/cell),Math.floor(pos.getY(i)/cell),Math.floor(pos.getZ(i)/cell)].join(',');
    if(options.preserveUV!==false && uv)key+='|u'+Math.floor(uv.getX(i)/uvCell)+':'+Math.floor(uv.getY(i)/uvCell);
    if(options.preserveNormals!==false)key+='|n'+normalKey(attrs,i);
    if(options.protectSkin!==false)key+='|j'+jointKey(attrs,i);
    let id=map.get(key);
    if(id===undefined){id=buckets.length;map.set(key,id);buckets.push([]);}
    buckets[id].push(i);oldToNew[i]=id;
  }
  // Compute each bucket's new vertex position BEFORE deciding triangle
  // winding. Collapsing corners can invert triangles on curved surfaces.
  const centers=buckets.map(bucket=>{
    let x=0,y=0,z=0;
    for(const i of bucket){x+=pos.getX(i);y+=pos.getY(i);z+=pos.getZ(i);}
    return [x/bucket.length,y/bucket.length,z/bucket.length];
  });
  function normalCross(ax,ay,az,bx,by,bz,cx,cy,cz){
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    return [uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
  }
  const faces=[],seenFaces=new Set();let correctedWinding=0,degenerateDropped=0,duplicatesDropped=0;
  for(let k=0;k+2<sourceLength;k+=3){
    const ia=source?source[k]:k,ib=source?source[k+1]:k+1,ic=source?source[k+2]:k+2;
    let a=oldToNew[ia],b=oldToNew[ib],c=oldToNew[ic];
    if(a===b||a===c||b===c)continue;
    const centerA=centers[a],centerB=centers[b],centerC=centers[c];
    const oldCross=normalCross(pos.getX(ia),pos.getY(ia),pos.getZ(ia),
      pos.getX(ib),pos.getY(ib),pos.getZ(ib),pos.getX(ic),pos.getY(ic),pos.getZ(ic));
    const newCross=normalCross(...centerA,...centerB,...centerC);
    const oldAreaSq=oldCross[0]**2+oldCross[1]**2+oldCross[2]**2;
    const newAreaSq=newCross[0]**2+newCross[1]**2+newCross[2]**2;
    if(newAreaSq<=Math.max(1e-20,oldAreaSq*1e-8)){degenerateDropped++;continue;}
    const orientation=oldCross[0]*newCross[0]+oldCross[1]*newCross[1]+oldCross[2]*newCross[2];
    if(orientation<0){const swap=b;b=c;c=swap;correctedWinding++;}
    const sorted=[a,b,c].sort((x,y)=>x-y).join(':');
    if(seenFaces.has(sorted)){duplicatesDropped++;continue;}
    seenFaces.add(sorted);faces.push(a,b,c);
  }
  if(faces.length===0)return {reason:'Параметры уничтожают все грани.'};
  const keep=new Set(faces),remap=new Int32Array(buckets.length).fill(-1),active=[];
  for(let i=0;i<buckets.length;i++)if(keep.has(i)){remap[i]=active.length;active.push(buckets[i]);}
  const result=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(attrs)){
    const values=[];
    for(const bucket of active){
      if(name==='skinIndex'||name==='skinWeight'){
        const entries=[];
        for(const vi of bucket)for(let s=0;s<4;s++)
          entries.push([attrs.skinIndex.getComponent(vi,s),attrs.skinWeight.getComponent(vi,s)/bucket.length]);
        const skin=normalizedTop4(entries,attrs.skinIndex.getX(bucket[0]));
        values.push(...(name==='skinIndex'?skin.joints:skin.weights));
      }else{
        const start=values.length;
        for(let c=0;c<attribute.itemSize;c++){
          let v=0;
          for(const vi of bucket)v+=attribute.getComponent(vi,c);
          values.push(v/bucket.length);
        }
        if(name==='normal'&&attribute.itemSize>=3){
          const length=Math.hypot(values[start],values[start+1],values[start+2])||1;
          for(let c=0;c<3;c++)values[start+c]/=length;
        }
      }
    }
    const arr=name==='skinIndex'?new Uint16Array(values):new Float32Array(values);
    result.setAttribute(name,new THREE.BufferAttribute(arr,attribute.itemSize,name!=='skinIndex'&&attribute.normalized));
  }
  const indices=faces.map(i=>remap[i]);
  result.setIndex(indices);
  if(g.groups.length===1)result.addGroup(0,indices.length,g.groups[0].materialIndex);
  if(!result.getAttribute('normal'))result.computeVertexNormals();
  result.computeBoundingBox();result.computeBoundingSphere();
  // Quantify the worst original-vertex movement created by clustering;
  // refuse an aggressive target rather than silently crushing the model.
  let maxMovement=0,sumSquaredMovement=0,movedCount=0;
  const finalPos=result.getAttribute('position');
  for(let i=0;i<active.length;i++){
    const bucket=active[i],xx=finalPos.getX(i),yy=finalPos.getY(i),zz=finalPos.getZ(i);
    for(const vi of bucket){
      const dx=xx-pos.getX(vi),dy=yy-pos.getY(vi),dz=zz-pos.getZ(vi);
      const squared=dx*dx+dy*dy+dz*dz;
      maxMovement=Math.max(maxMovement,Math.sqrt(squared));
      sumSquaredMovement+=squared;movedCount++;
    }
  }
  // Measure actual texture-coordinate movement in material pixel units.
  let maxUvMovementTexels=0;
  if(uv){
    const outUV=result.getAttribute('uv'),ratio=texSize*uvRepeat;
    for(let i=0;i<active.length;i++){
      const bucket=active[i],u=outUV.getX(i),v=outUV.getY(i);
      for(const vi of bucket){
        const error=Math.hypot(u-uv.getX(vi),v-uv.getY(vi))*ratio;
        if(error>maxUvMovementTexels)maxUvMovementTexels=error;
      }
    }
  }
  return {geometry:result,vertices:active.length,triangles:faces.length/3,
    maxMovement,rmsMovement:Math.sqrt(sumSquaredMovement/Math.max(1,movedCount)),
    maxUvMovementTexels,correctedWinding,degenerateDropped,duplicatesDropped};
}
export function simplifyGeometry(g,target,options={}){
  if(Object.values(g.morphAttributes||{}).some(a=>a?.length))
    return {reason:'Содержит морфы лица: упрощение запрещено для сохранения мимики.'};
  if(g.groups.length>1)
    return {reason:'Несколько групп материалов: сетка сохранена без изменений.'};
  const pos=g.getAttribute('position');
  if(!pos)return {reason:'Нет атрибута POSITION.'};
  const oldCount=Math.floor((g.index?.count||pos.count)/3);
  if(!Number.isFinite(target)||target<64||target>=oldCount)return {reason:'Цель должна быть меньше исходного количества (мин. 64).'};
  // Large geometry is handled by the same safety-preserving algorithm, but
  // with fewer expensive candidate passes in a background Worker. A fixed
  // polygon-count restriction was incorrect (large GLBs are valid).
  g.computeBoundingBox();const size=g.boundingBox.getSize(new THREE.Vector3());
  const dim=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(dim)||dim<=0)return {reason:'Неправильный размер меша.'};
  const diagonal=Math.max(size.length(),1e-8);
  const maxMovementRatio=Math.max(.002,Math.min(.15,Number(options.maxMovementRatio??.035)));

  // Coarse logarithmic search establishes a bracket around the requested
  // triangle budget. Vertex clustering has discrete jumps: returning only
  // coarse 10 samples routinely oversimplifies by 2–3x (198450 -> 7938).
  // Refine the bracket without changing UV/skin/normals protection options.
  let best=null,below=null,above=null,attempts=0;
  const isLarge=oldCount>260000;
  const trials=Math.max(3,Math.min(24,Math.round(options.trials??(isLarge?5:10))));
  const refinements=Math.max(0,Math.min(12,Math.round(options.refinements??(isLarge?4:7))));
  const lower=dim/2500,upper=dim/3;
  const evaluate=cell=>{
    attempts++;
    if(typeof options.onProgress==='function')options.onProgress(attempts,trials+refinements);
    const candidate=cluster(g,cell,options);
    if(!candidate.geometry)return;
    if(candidate.triangles>=oldCount || candidate.maxMovement/diagonal>maxMovementRatio ||
      (options.preserveUV!==false && candidate.maxUvMovementTexels>Math.max(.5,Number(options.maxUvTexels)||4)*1.5) ||
      candidate.correctedWinding>oldCount*.025){
      candidate.geometry.dispose();return;
    }
    const score=Math.abs(candidate.triangles-target);
    if(!best||score<Math.abs(best.triangles-target)){
      best?.geometry.dispose();best={...candidate,cellSize:cell};
    }else candidate.geometry.dispose();
    if(candidate.triangles>=target){
      // The closest high-count result must use the largest known small cell.
      if(!above||cell>above.cell)above={cell,triangles:candidate.triangles};
    }else {
      // The closest low-count result must use the smallest known large cell.
      if(!below||cell<below.cell)below={cell,triangles:candidate.triangles};
    }
  };
  for(let i=0;i<trials;i++){
    const ratio=i/(trials-1);
    evaluate(lower*Math.pow(upper/lower,ratio));
  }
  for(let i=0;i<refinements&&above&&below&&above.cell<below.cell;i++){
    if(best&&Math.abs(best.triangles-target)<=target*.025)break;
    const middle=Math.sqrt(above.cell*below.cell);
    if(middle<=above.cell||middle>=below.cell)break;
    evaluate(middle);
  }
  if(!best)return {reason:'При защите UV, текстур и костей сетка не уменьшается безопасно. Для уменьшения до 20 000 может потребоваться новая UV-развёртка и запекание текстур, как в Tripo. Исходная модель сохранена.'};
  return {...best,originalTriangles:oldCount,target,attempts,
    targetErrorPercent:Math.round(10000*(best.triangles-target)/target)/100,
    maxMovementPercent:Math.round(best.maxMovement/diagonal*10000)/100,
    maxUvMovementTexels:Math.round(best.maxUvMovementTexels*100)/100,
    largeMode:isLarge,
    method:'vertex clustering (adaptive target refinement; shape movement capped)'};
}
export function closestSegmentDistanceSq(p,a,b){
  const ab=b.clone().sub(a),d=ab.lengthSq();
  if(d<1e-10)return p.distanceToSquared(a);
  const t=clamp(p.clone().sub(a).dot(ab)/d,0,1);
  return p.distanceToSquared(a.clone().addScaledVector(ab,t));
}
/**
 * Capsules in GEOMETRY bind space; stable even while the model is animated.
 * Their radii are inferred from nearby vertices with *strong* skin influence,
 * rather than using one global body-size radius for all parts.
 * Robust quantiles reject stray weights across the torso/opposite limb.
 */
export function getBindCapsules(mesh,radiusScale=1){
  if(!mesh?.isSkinnedMesh || !mesh.skeleton)return [];
  const geo=mesh.geometry,position=geo.getAttribute('position'),
        joint=geo.getAttribute('skinIndex'),weight=geo.getAttribute('skinWeight');
  if(!position || !mesh.skeleton.boneInverses?.length)return [];
  const bones=mesh.skeleton.bones,inv=mesh.skeleton.boneInverses;
  // bindMatrix is fixed in the REST pose; matrixWorld would move with animation.
  const unbind=mesh.bindMatrix.clone().invert();
  const points=bones.map((_,i)=>{
    const rest=unbind.clone().multiply(inv[i].clone().invert());
    return new THREE.Vector3().setFromMatrixPosition(rest);
  });
  geo.computeBoundingBox();
  const diag=Math.max(geo.boundingBox.getSize(new THREE.Vector3()).length(),1e-4);
  const influenceCount=new Uint32Array(bones.length);
  if(joint&&weight){
    for(let i=0;i<position.count;i++)for(let k=0;k<4;k++){
      const id=joint.getComponent(i,k);
      if(id>=0&&id<bones.length&&weight.getComponent(i,k)>.15)influenceCount[id]++;
    }
  }
  const capsules=bones.map((bone,i)=>{
    const childIndices=[];
    for(let k=0;k<bones.length;k++)if(bones[k].parent===bone)childIndices.push(k);
    // Prefer a useful weighted descendant over an unweighted end helper.
    childIndices.sort((a,b)=>influenceCount[b]-influenceCount[a]);
    const child=childIndices[0];
    let start=points[i],end=child!==undefined?points[child]:points[i].clone();
    if(child===undefined && bone.parent){
      const parent=bones.indexOf(bone.parent);
      if(parent>=0){start=points[parent];end=points[i];}
    }
    const length=start.distanceTo(end);
    const floor=Math.max(.003*diag,1e-5);
    const ceiling=Math.max(floor,Math.min(.16*diag,Math.max(.018*diag,length*.8)));
    const fallback=Math.max(floor,Math.min(ceiling,length*.23||.018*diag));
    return {name:bone.name||('Bone '+i),index:i,start,end,length,
      radius:fallback,radiusSource:'fallback',sampleCount:0,
      _floor:floor,_ceiling:ceiling,_samples:[]};
  });
  if(joint&&weight){
    // A tiny subset of vertices is sufficient for visually fitting each bone.
    // On mobile this costs O(vertices * 4), with no triangles/BVH rebuild.
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      for(let k=0;k<4;k++){
        const w=weight.getComponent(i,k);
        if(w<.35)continue;
        const b=joint.getComponent(i,k),cap=capsules[b];
        if(cap)cap._samples.push(Math.sqrt(pointSegmentDistanceSqXYZ(x,y,z,cap.start,cap.end)));
      }
    }
  }
  for(const cap of capsules){
    cap.sampleCount=cap._samples.length;
    if(cap.sampleCount>=6){
      cap._samples.sort((a,b)=>a-b);
      const idx=Math.floor((cap.sampleCount-1)*.82);
      const q=cap._samples[idx];
      cap.radius=Math.max(cap._floor,Math.min(cap._ceiling,q*1.12));
      cap.radiusSource='weighted-vertices';
    }
    cap.radius*=Math.max(.2,Math.min(4,radiusScale));
    delete cap._samples;delete cap._floor;delete cap._ceiling;
  }
  return capsules;
}
// No temporary Vector3 allocations in the vertex-by-bone hot loop.
function pointSegmentDistanceSqXYZ(x,y,z,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
  const lenSq=dx*dx+dy*dy+dz*dz;
  const t=lenSq<1e-12?0:clamp(((x-a.x)*dx+(y-a.y)*dy+(z-a.z)*dz)/lenSq,0,1);
  const rx=x-(a.x+dx*t),ry=y-(a.y+dy*t),rz=z-(a.z+dz*t);
  return rx*rx+ry*ry+rz*rz;
}
/**
 * Preview-only influence diagnostics/correction.
 * Existing dominant influence is NEVER silently replaced in default mode.
 *
 * allowReassign: opt-in for a visibly broken clothing mesh. If no original
 * influences belong to nearby capsules, find the four nearest eligible
 * capsules in bind space (not from the animation frame). Softness protects
 * seams; no hard cutoff is applied to good existing weights.
 */
export function guardSkinToCapsules(geometry,capsules,{softness=1.5,allowReassign=false,protectedVertices=null}={}){
  const pos=geometry.getAttribute('position'),
        joint=geometry.getAttribute('skinIndex'),
        weight=geometry.getAttribute('skinWeight');
  if(!pos||!joint||!weight)return {reason:'Нужны skinIndex и skinWeight.'};
  if(joint.itemSize!==4||weight.itemSize!==4)
    return {reason:'Для безопасной коррекции требуются четыре слота весов.'};
  if(protectedVertices && protectedVertices.length!==pos.count)return {reason:'Маска одежды не совпадает с количеством вершин. Отмена обработки.'};
  const out=geometry.clone(),destJ=out.getAttribute('skinIndex'),
        destW=out.getAttribute('skinWeight');
  let changed=0,reassigned=0,outOfCapsule=0,unresolved=0,protectedCount=0;
  const safeSoftness=Math.max(.1,Math.min(5,softness));
  for(let i=0;i<pos.count;i++){
    if(protectedVertices?.[i]){protectedCount++;continue;}
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    const candidates=[],original=[],local=[];
    let total=0;
    for(let slot=0;slot<4;slot++){
      const id=joint.getComponent(i,slot),w=weight.getComponent(i,slot);
      if(w<=0)continue;
      total+=w;
      original.push([id,w]);
      const c=capsules[id];
      if(!c){candidates.push([id,w]);continue;}
      const d=Math.sqrt(pointSegmentDistanceSqXYZ(x,y,z,c.start,c.end));
      const ratio=d/Math.max(c.radius,1e-6);
      if(ratio<=1.20)local.push(id);
      const relative=Math.max(0,d-c.radius)/Math.max(c.radius*safeSoftness,1e-6);
      const factor=ratio<=1?1:Math.exp(-1.5*relative*relative);
      candidates.push([id,w*Math.max(1e-5,factor)]);
    }
    if(total<=0){unresolved++;continue;}
    const hasLocal=local.length>0;
    if(!hasLocal)outOfCapsule++;
    let used=candidates;
    if(allowReassign&&!hasLocal){
      // Preserve local clothing placement; do not copy humanoid weights
      // by vertex index from a different topology.
      const nearby=[];
      for(const c of capsules){
        if(!c||c.radius<=0)continue;
        const d=Math.sqrt(pointSegmentDistanceSqXYZ(x,y,z,c.start,c.end));
        const ratio=d/Math.max(c.radius,1e-6);
        if(ratio<=1.20)nearby.push({id:c.index,ratio,
          score:Math.exp(-2*ratio*ratio)});
      }
      nearby.sort((a,b)=>a.ratio-b.ratio);
      if(nearby.length){
        used=nearby.slice(0,4).map(n=>[n.id,n.score]);
        reassigned++;
      }else unresolved++;
    }else if(!hasLocal)unresolved++;
    const skin=normalizedTop4(used,joint.getX(i));
    let diff=false;
    for(let slot=0;slot<4;slot++){
      if(Math.abs(weight.getComponent(i,slot)-skin.weights[slot])>1e-4 ||
        joint.getComponent(i,slot)!==skin.joints[slot])diff=true;
      destJ.setComponent(i,slot,skin.joints[slot]);
      destW.setComponent(i,slot,skin.weights[slot]);
    }
    if(diff)changed++;
  }
  destJ.needsUpdate=true;destW.needsUpdate=true;
  return {geometry:out,changed,reassigned,outOfCapsule,unresolved,protectedCount};
}
