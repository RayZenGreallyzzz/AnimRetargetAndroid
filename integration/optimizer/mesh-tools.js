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
  const index=g.index,source=index?Array.from(index.array):Array.from({length:count},(_,i)=>i);
  const map=new Map(),buckets=[],oldToNew=new Int32Array(count);
  const uvCell=Math.max(.005,cell*.1);
  for(let i=0;i<count;i++){
    let key=[Math.floor(pos.getX(i)/cell),Math.floor(pos.getY(i)/cell),Math.floor(pos.getZ(i)/cell)].join(',');
    if(options.preserveUV!==false && uv)key+='|u'+Math.floor(uv.getX(i)/uvCell)+':'+Math.floor(uv.getY(i)/uvCell);
    if(options.preserveNormals!==false)key+='|n'+normalKey(attrs,i);
    if(options.protectSkin!==false)key+='|j'+jointKey(attrs,i);
    let id=map.get(key);
    if(id===undefined){id=buckets.length;map.set(key,id);buckets.push([]);}
    buckets[id].push(i);oldToNew[i]=id;
  }
  const faces=[];
  for(let k=0;k+2<source.length;k+=3){
    const a=oldToNew[source[k]],b=oldToNew[source[k+1]],c=oldToNew[source[k+2]];
    if(a!==b&&a!==c&&b!==c)faces.push(a,b,c);
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
  return {geometry:result,vertices:active.length,triangles:faces.length/3};
}
export function simplifyGeometry(g,target,options={}){
  const pos=g.getAttribute('position');
  if(!pos)return {reason:'Нет атрибута POSITION.'};
  const oldCount=Math.floor((g.index?.count||pos.count)/3);
  if(!Number.isFinite(target)||target<64||target>=oldCount)return {reason:'Цель должна быть меньше исходного количества (мин. 64).'};
  if(oldCount>260000)return {reason:'Слишком крупный меш для безопасной обработки на планшете.'};
  g.computeBoundingBox();const size=g.boundingBox.getSize(new THREE.Vector3());
  const dim=Math.max(size.x,size.y,size.z);
  if(!Number.isFinite(dim)||dim<=0)return {reason:'Неправильный размер меша.'};
  let best=null;
  const trials=options.trials||10;
  for(let i=0;i<trials;i++){
    const ratio=i/(trials-1),cell=(dim/2500)*Math.pow(2500/3,ratio);
    const candidate=cluster(g,cell,options);
    if(candidate.geometry && candidate.triangles<oldCount){
      if(!best||Math.abs(candidate.triangles-target)<Math.abs(best.triangles-target)){
        best?.geometry.dispose();best=candidate;
      }else candidate.geometry.dispose();
      if(best.triangles<=target&&best.triangles>=target*.82)break;
    }
  }
  if(!best)return {reason:'При защите UV и костей сетка не уменьшается: выбери другую модель или настройки.'};
  return {...best,originalTriangles:oldCount,target,method:'vertex clustering'};
}
export function closestSegmentDistanceSq(p,a,b){
  const ab=b.clone().sub(a),d=ab.lengthSq();
  if(d<1e-10)return p.distanceToSquared(a);
  const t=clamp(p.clone().sub(a).dot(ab)/d,0,1);
  return p.distanceToSquared(a.clone().addScaledVector(ab,t));
}
export function getBindCapsules(mesh,radiusScale=1){
  if(!mesh.isSkinnedMesh||!mesh.skeleton)return [];
  const bones=mesh.skeleton.bones,inverses=mesh.skeleton.boneInverses;
  const local=mesh.matrixWorld.clone().invert();
  const points=bones.map((_,i)=>new THREE.Vector3().setFromMatrixPosition(local.clone().multiply(inverses[i].clone().invert())));
  mesh.geometry.computeBoundingBox();
  const diag=mesh.geometry.boundingBox.getSize(new THREE.Vector3()).length();
  const base=Math.max(diag*.025,.0001);
  return bones.map((bone,i)=>{
    const child=bones.findIndex(b=>b.parent===bone);
    let a=points[i],b=child>=0?points[child]:points[i].clone();
    if(child<0&&bone.parent){
      const parent=bones.indexOf(bone.parent);
      if(parent>=0){a=points[parent];b=points[i];}
    }
    const length=a.distanceTo(b),radius=Math.max(base*.35,Math.min(base*2.6,length*.24))*radiusScale;
    return {name:bone.name||('Bone '+i),index:i,start:a,end:b,radius,length};
  });
}
/** Attenuate original weights outside a bone capsule, never force hard zero seams.
 * Apply only to the selected mesh and only on explicit user approval.
 */
export function guardSkinToCapsules(g,capsules,{softness=1.5}={}){
  const pos=g.getAttribute('position'),joint=g.getAttribute('skinIndex'),weight=g.getAttribute('skinWeight');
  if(!pos||!joint||!weight)return {reason:'Нужны skinIndex и skinWeight.'};
  const out=g.clone(),jDst=out.getAttribute('skinIndex'),wDst=out.getAttribute('skinWeight');
  const p=new THREE.Vector3();let changed=0;
  for(let i=0;i<pos.count;i++){
    p.fromBufferAttribute(pos,i);
    const entries=[];
    for(let slot=0;slot<4;slot++){
      const id=joint.getComponent(i,slot),w=weight.getComponent(i,slot);
      if(w<=0)continue;
      const c=capsules[id];
      if(!c){entries.push([id,w]);continue;}
      const d=Math.sqrt(closestSegmentDistanceSq(p,c.start,c.end));
      const factor=d<=c.radius?1:Math.exp(-1.5*Math.pow((d-c.radius)/Math.max(c.radius*softness,.00001),2));
      entries.push([id,w*Math.max(.00001,factor)]);
    }
    const skin=normalizedTop4(entries,joint.getX(i));
    let diff=false;
    for(let slot=0;slot<4;slot++){
      if(Math.abs(weight.getComponent(i,slot)-skin.weights[slot])>1e-4||
       joint.getComponent(i,slot)!==skin.joints[slot])diff=true;
      jDst.setComponent(i,slot,skin.joints[slot]);wDst.setComponent(i,slot,skin.weights[slot]);
    }
    if(diff)changed++;
  }
  jDst.needsUpdate=true;wDst.needsUpdate=true;
  return {geometry:out,changed};
}
