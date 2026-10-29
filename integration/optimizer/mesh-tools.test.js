import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {normalizedTop4,simplifyGeometry,closestSegmentDistanceSq,guardSkinToCapsules,getBindCapsules} from './mesh-tools.js';

test('top-four joint weights normalize and keep highest influences',()=>{
  const result=normalizedTop4([[2,.3],[3,.1],[4,.2],[5,.3],[6,.1],[2,.1]]);
  assert.equal(result.weights.length,4);
  assert.ok(Math.abs(result.weights.reduce((a,b)=>a+b,0)-1)<1e-6);
  assert.ok(result.joints.includes(2));
  assert.ok(!result.joints.includes(6));
});

function makeGrid(N=25){
  const positions=[],uv=[],indices=[],joints=[],weights=[];
  for(let y=0;y<=N;y++)for(let x=0;x<=N;x++){
    positions.push(x/N,y/N,0);
    uv.push(x/N,y/N);
    joints.push(x<N/2?0:1,x<N/2?1:0,0,0);
    weights.push(.85,.15,0,0);
  }
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const a=y*(N+1)+x,b=a+1,c=a+N+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(
    Array.from({length:(N+1)*(N+1)},()=>[0,0,1]).flat(),3));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
  g.setIndex(indices);
  return g;
}
test('conservative clustering reduces triangles without mutating original skin',()=>{
  const source=makeGrid(25);
  const oldTriangles=source.index.count/3;
  const oldVertices=source.getAttribute('position').count;
  const result=simplifyGeometry(source,350,{preserveUV:false,protectSkin:true});
  assert.ok(result.geometry,result.reason);
  assert.ok(result.triangles<oldTriangles);
  assert.ok(result.vertices<oldVertices);
  const a=result.geometry.getAttribute('skinWeight');
  const j=result.geometry.getAttribute('skinIndex');
  for(let v=0;v<a.count;v++){
    let sum=0;
    for(let k=0;k<4;k++){sum+=a.getComponent(v,k);assert.ok(j.getComponent(v,k)>=0);}
    assert.ok(Math.abs(sum-1)<1e-5);
  }
  assert.equal(source.index.count/3,oldTriangles);
  assert.equal(source.getAttribute('position').count,oldVertices);
  result.geometry.dispose();source.dispose();
});

test('facial morph targets never undergo destructive decimation',()=>{
  const g=makeGrid(25);
  g.morphAttributes.position=[g.getAttribute('position').clone()];
  const out=simplifyGeometry(g,350,{preserveUV:false});
  assert.match(out.reason,/морфы/i);
  assert.equal(out.geometry,undefined);
  g.dispose();
});

test('capsule guard renormalizes existing clothing weights and leaves original intact',()=>{
  const g=makeGrid(4);
  const before=g.getAttribute('skinWeight').getX(0);
  const c=[
    {start:new THREE.Vector3(0,0,0),end:new THREE.Vector3(0,1,0),radius:.15},
    {start:new THREE.Vector3(1,0,0),end:new THREE.Vector3(1,1,0),radius:.15}
  ];
  const out=guardSkinToCapsules(g,c);
  assert.ok(out.geometry);
  assert.equal(g.getAttribute('skinWeight').getX(0),before);
  for(let i=0;i<out.geometry.getAttribute('skinWeight').count;i++){
    const w=out.geometry.getAttribute('skinWeight');
    let sum=0;for(let j=0;j<4;j++)sum+=w.getComponent(i,j);
    assert.ok(Math.abs(sum-1)<1e-5);
  }
  assert.ok(closestSegmentDistanceSq(new THREE.Vector3(0,0.4,0),c[0].start,c[0].end)<1e-9);
  out.geometry.dispose();g.dispose();
});


test('bind pose capsules stay aligned even when mesh world position changes',()=>{
  const bone0=new THREE.Bone(),bone1=new THREE.Bone();bone0.name='UpperArm';bone1.name='Forearm';
  bone0.add(bone1);
  const g=new THREE.BufferGeometry();
  const pts=[],joint=[],weight=[];
  for(let k=0;k<20;k++){
    const a=(k/20)*Math.PI*2;
    pts.push(Math.cos(a)*.18, .2+(k%3)*.15, Math.sin(a)*.18);
    joint.push(0,1,0,0);weight.push(.85,.15,0,0);
  }
  g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joint,4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weight,4));
  const mesh=new THREE.SkinnedMesh(g,new THREE.MeshBasicMaterial());
  const bindMatrix=new THREE.Matrix4().makeTranslation(10,0,0);
  const inverse0=new THREE.Matrix4().makeTranslation(-10,0,0);
  const inverse1=new THREE.Matrix4().makeTranslation(-10,-1,0);
  mesh.bind(new THREE.Skeleton([bone0,bone1],[inverse0,inverse1]),bindMatrix);
  mesh.position.set(150,12,3);
  mesh.updateMatrixWorld(true);
  let caps=getBindCapsules(mesh,1);
  assert.ok(caps.length===2);
  assert.ok(Math.abs(caps[0].start.x)<1e-5,'bone bind point must be in geometry local space');
  assert.ok(Math.abs(caps[0].end.y-1)<1e-5,'child bind point should be one unit along Y');
  assert.equal(caps[0].radiusSource,'weighted-vertices');
  const first=caps[0].radius;
  assert.ok(first>.03 && first<.45,'capsule should fit actual weighted surface, not whole-character radius');
  mesh.position.set(-900,0,0);
  mesh.updateMatrixWorld(true);
  caps=getBindCapsules(mesh,1);
  assert.ok(Math.abs(caps[0].radius-first)<1e-9);
  assert.ok(Math.abs(caps[0].start.x)<1e-5,'animation/world movement must not shift bind capsule');
  g.dispose();mesh.material.dispose();
});

test('wrong-limb garment vertex is reassigned only after explicit opt-in',()=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([1,.5,0],3));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,0,0,0],4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0],4));
  const c=[
    {index:0,start:new THREE.Vector3(0,0,0),end:new THREE.Vector3(0,1,0),radius:.2},
    {index:1,start:new THREE.Vector3(1,0,0),end:new THREE.Vector3(1,1,0),radius:.2}
  ];
  const conservative=guardSkinToCapsules(g,c,{allowReassign:false});
  assert.equal(conservative.geometry.getAttribute('skinIndex').getX(0),0);
  assert.equal(conservative.reassigned,0);
  assert.equal(conservative.unresolved,1);
  const repair=guardSkinToCapsules(g,c,{allowReassign:true});
  assert.equal(repair.geometry.getAttribute('skinIndex').getX(0),1);
  assert.equal(repair.geometry.getAttribute('skinWeight').getX(0),1);
  assert.equal(repair.reassigned,1);
  assert.equal(g.getAttribute('skinIndex').getX(0),0,'source untouched until apply');
  conservative.geometry.dispose();repair.geometry.dispose();g.dispose();
});

test('no plausible capsule does not silently bind cloth to arbitrary bone',()=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([50,50,50],3));
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,0,0,0],4));
  g.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0],4));
  const c=[{index:0,start:new THREE.Vector3(0,0,0),end:new THREE.Vector3(0,1,0),radius:.2}];
  const output=guardSkinToCapsules(g,c,{allowReassign:true});
  assert.equal(output.unresolved,1);
  assert.equal(output.reassigned,0);
  assert.equal(output.geometry.getAttribute('skinIndex').getX(0),0);
  output.geometry.dispose();g.dispose();
});

test('capsule repair never changes painted clothing weights or joint assignments',()=>{
 const g=makeGrid(8),count=g.getAttribute('position').count;
 const originalJ=Array.from(g.getAttribute('skinIndex').array), originalW=Array.from(g.getAttribute('skinWeight').array);
 const protect=new Uint8Array(count);for(let i=0;i<count;i++)if(i%3===0)protect[i]=1;
 const c=[
  {index:0,start:new THREE.Vector3(0,0,0),end:new THREE.Vector3(0,1,0),radius:.22},
  {index:1,start:new THREE.Vector3(1,0,0),end:new THREE.Vector3(1,1,0),radius:.22}
 ];
 const out=guardSkinToCapsules(g,c,{allowReassign:true,protectedVertices:protect});
 assert.ok(out.geometry,out.reason);assert.equal(out.protectedCount,protect.reduce((a,b)=>a+b,0));
 const j=out.geometry.getAttribute('skinIndex').array,w=out.geometry.getAttribute('skinWeight').array;
 for(let i=0;i<count;i++)if(protect[i])for(let k=0;k<4;k++){
  assert.equal(j[i*4+k],originalJ[i*4+k], 'cloth joint must not change');
  assert.equal(w[i*4+k],originalW[i*4+k], 'cloth weight must not change');
 }
 const invalid=guardSkinToCapsules(g,c,{protectedVertices:new Uint8Array(3)});
 assert.match(invalid.reason,/не совпадает/);
 out.geometry.dispose();g.dispose();
});

test('Tripo-scale diagnostic: ~198k source triangles towards 20k with UV, skin and normals',()=>{
 const mesh=makeGrid(315),goal=20000,source=mesh.index.count/3;
 const start=Date.now();
 const out=simplifyGeometry(mesh,goal,{preserveUV:false,protectSkin:true,trials:10});
 const elapsed=Date.now()-start;
 console.log('TRIPO_SCALE_BENCHMARK',JSON.stringify({source,target:goal,achieved:out.triangles||0,vertices:out.vertices||0,elapsedMs:elapsed,reason:out.reason||null,ratio:out.triangles?out.triangles/source:null}));
 assert.ok(out.geometry,out.reason);
 assert.ok(out.triangles<source,'algorithm must actually remove triangles');
 assert.ok(Math.abs(out.triangles-goal)<goal*.15,`20k target must be within 15%, got ${out.triangles}`);
 assert.ok(out.geometry.getAttribute('uv'),'UV must survive');
 assert.ok(out.geometry.getAttribute('skinWeight'),'skin weights must survive');
 assert.ok(out.geometry.getAttribute('normal'),'normals must survive');
 for(let v=0;v<out.geometry.getAttribute('skinWeight').count;v++){
  const w=out.geometry.getAttribute('skinWeight');
  let sum=0;for(let k=0;k<4;k++)sum+=w.getComponent(v,k);
  assert.ok(Math.abs(sum-1)<1e-4,'every output vertex is fully normalized');
 }
 out.geometry.dispose();mesh.dispose();
});

test('curved textured surface keeps measured shape and does not reverse triangle winding',()=>{
 const mesh=makeGrid(120),p=mesh.getAttribute('position');
 const z=(x,y)=>.075*Math.sin(6*Math.PI*x)*Math.cos(4*Math.PI*y);
 for(let i=0;i<p.count;i++)p.setZ(i,z(p.getX(i),p.getY(i)));
 mesh.computeBoundingBox();mesh.computeBoundingSphere();
 const out=simplifyGeometry(mesh,4000,{preserveUV:false,protectSkin:true});
 assert.ok(out.geometry,out.reason);
 assert.ok(out.maxMovementPercent<=3.5,'measured clustering movement must meet shape cap');
 const q=out.geometry.getAttribute('position');
 let rms=0,flipped=0,active=0;
 for(let i=0;i<q.count;i++){const e=q.getZ(i)-z(q.getX(i),q.getY(i));rms+=e*e;}
 rms=Math.sqrt(rms/q.count);
 for(let k=0;k<out.geometry.index.count;k+=3){
  const ai=out.geometry.index.getX(k),bi=out.geometry.index.getX(k+1),ci=out.geometry.index.getX(k+2);
  const cross=(q.getX(bi)-q.getX(ai))*(q.getY(ci)-q.getY(ai))-
    (q.getY(bi)-q.getY(ai))*(q.getX(ci)-q.getX(ai));
  if(Math.abs(cross)<1e-10)continue;
  active++;
  if(cross>0)flipped++;
 }
 console.log('CURVED_SHAPE_BENCHMARK',JSON.stringify({rmsZ:rms,flipped,faces:active,triangles:out.triangles,movement:out.maxMovementPercent}));
 assert.ok(rms<.015,'curved surface shape should stay close');
 assert.equal(flipped,0,'triangle winding must not invert');
 out.geometry.dispose();mesh.dispose();
});

test('optimized skinned character GLB round-trip retains UV, bones and animation',async()=>{
 // Minimal browser FileReader shim for node: no textures / DOM canvas required.
 const oldReader=globalThis.FileReader;
 globalThis.FileReader=class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.({target:this})}).catch(error=>{this.error=error;this.onerror?.(error)})}
  readAsDataURL(blob){blob.arrayBuffer().then(data=>{this.result='data:'+blob.type+';base64,'+Buffer.from(data).toString('base64');this.onloadend?.({target:this})})}
 };
 let mesh=null,source=null;
 try{
  source=makeGrid(45);
  const out=simplifyGeometry(source,1500,{preserveUV:false,protectSkin:true});
  assert.ok(out.geometry,out.reason);
  const root=new THREE.Group();
  const hips=new THREE.Bone();hips.name='Hips';hips.position.set(0,0,0);
  const arm=new THREE.Bone();arm.name='Arm';arm.position.set(.5,.4,0);hips.add(arm);
  mesh=new THREE.SkinnedMesh(out.geometry,new THREE.MeshStandardMaterial({color:0xffffff}));
  root.add(mesh);root.add(hips);root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hips,arm]));
  const clip=new THREE.AnimationClip('walk',1,[
   new THREE.QuaternionKeyframeTrack(arm.name+'.quaternion',[0,1],[0,0,0,1,0,.2,0,.9797959])
  ]);
  const output=await new GLTFExporter().parseAsync(root,{binary:true,trs:true,animations:[clip]});
  assert.ok(output instanceof ArrayBuffer,'export GLB binary');
  const view=new DataView(output);
  assert.equal(view.getUint32(0,true),0x46546c67);
  assert.equal(view.getUint32(8,true),output.byteLength);
  const jsonChunkBytes=view.getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(output,20,jsonChunkBytes)).trim());
  assert.ok(json.skins?.length,'skin and inverse bind matrices present');
  assert.ok(json.animations?.length,'animation clip present');
  const attributes=json.meshes?.[0]?.primitives?.[0]?.attributes||{};
  for(const attr of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])
    assert.ok(attributes[attr]!==undefined,attr+' attribute must be exported');
 }finally{
  if(mesh){mesh.geometry.dispose();mesh.material.dispose();}
  source?.dispose();globalThis.FileReader=oldReader;
 }
});

test('previous 260000-triangle cap is gone: 273800 triangles optimize with skin and UVs',()=>{
 const source=makeGrid(370),original=source.index.count/3;
 assert.equal(original,273800);
 const start=Date.now();
 const result=simplifyGeometry(source,20000,{preserveUV:false,protectSkin:true});
 console.log('LARGE_MESH_BENCHMARK',JSON.stringify({
  source:original,target:20000,triangles:result.triangles,elapsedMs:Date.now()-start,
  reason:result.reason||null,attempts:result.attempts,maxMovementPercent:result.maxMovementPercent
 }));
 assert.ok(result.geometry,result.reason);
 assert.ok(result.triangles<original);
 assert.ok(result.geometry.getAttribute('uv'));
 assert.ok(result.geometry.getAttribute('skinIndex'));
 assert.ok(result.geometry.getAttribute('skinWeight'));
 assert.ok(result.triangles>=13000,'no accidental 20k oversimplification');
 result.geometry.dispose();source.dispose();
});

test('gltfpack KHR_texture_transform ×16 atlas never collapses distant texels while UV protection is enabled',()=>{
 const g=makeGrid(80),uv=g.getAttribute('uv');
 for(let i=0;i<uv.count;i++){uv.setXY(i,uv.getX(i)/16,uv.getY(i)/16)}
 const out=simplifyGeometry(g,2000,{preserveUV:true,protectSkin:false,
   textureSize:2048,uvRepeat:16,maxUvTexels:4});
 if(out.geometry){
  assert.ok(out.maxUvMovementTexels<=6,'UV must move by only a few effective image pixels');
  assert.ok(out.geometry.getAttribute('uv'),'UV attribute survives');
  out.geometry.dispose();
 }else{
  assert.match(out.reason,/UV|текстур/,'safe rejection when reaching target would distort atlas');
 }
 g.dispose();
});
