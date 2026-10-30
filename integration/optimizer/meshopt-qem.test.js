import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {simplifyQEM} from './meshopt-qem.js';

function makeGrid(n){
 const pos=[],uv=[],weights=[],joints=[],indices=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
  const px=x/n,py=y/n;
  pos.push(px,py,0.05*Math.sin(px*16)*Math.cos(py*13));
  uv.push(px/16,py/16); // Tripo-like atlas with ×16 repeat
  const left=px<.5;
  joints.push(left?1:2,left?2:1,0,0);weights.push(.83,.17,0,0);
 }
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
  indices.push(a,c,b,b,c,d);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
 g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 g.setIndex(indices);g.computeVertexNormals();return g;
}
test('QEM reduces curved skinned mesh while preserving exact UV atlas values and weight IDs',async()=>{
 const src=makeGrid(110),count=src.index.count/3;
 const out=await simplifyQEM(src,6000,{qemError:.12});
 assert.ok(out.geometry,out.reason);
 assert.ok(out.triangles<count,'QEM must actually simplify');
 assert.equal(out.maxUvMovementTexels,0);
 assert.equal(out.maxMovementPercent,0);
 assert.ok(out.geometry.getAttribute('uv'));
 const pos=out.geometry.getAttribute('position'),uv=out.geometry.getAttribute('uv'),skin=out.geometry.getAttribute('skinIndex'),weight=out.geometry.getAttribute('skinWeight');
 for(let i=0;i<pos.count;i++){
  assert.ok(Math.abs(uv.getX(i)-pos.getX(i)/16)<1e-7);
  assert.ok(Math.abs(uv.getY(i)-pos.getY(i)/16)<1e-7);
  const left=pos.getX(i)<.5;
  assert.equal(skin.getX(i),left?1:2);
  assert.equal(skin.getY(i),left?2:1);
  const w=weight.getX(i)+weight.getY(i)+weight.getZ(i)+weight.getW(i);
  assert.ok(Math.abs(w-1)<1e-6);
 }
 assert.equal(src.index.count/3,count,'original geometry remains unchanged');
 out.geometry.dispose();src.dispose();
});
test('QEM fails closed on morph targets and separate material groups',async()=>{
 const g=makeGrid(25);
 g.morphAttributes.position=[g.getAttribute('position').clone()];
 const protectedMorph=await simplifyQEM(g,350);
 assert.match(protectedMorph.reason,/Морф/);
 delete g.morphAttributes.position;
 g.addGroup(0,120,0);g.addGroup(120,g.index.count-120,1);
 const protectedGroups=await simplifyQEM(g,350);
 assert.match(protectedGroups.reason,/material groups/);
 g.dispose();
});
test('QEM can attempt >260k face mesh without unsafe vertex clustering',async()=>{
 const g=makeGrid(370),source=g.index.count/3,started=Date.now();
 const out=await simplifyQEM(g,45000,{qemError:.16});
 console.log('QEM_LARGE_BENCHMARK',JSON.stringify({source,triangles:out.triangles,ms:Date.now()-started,error:out.qemError,reason:out.reason}));
 assert.ok(out.geometry,out.reason);
 assert.ok(out.triangles<source);
 assert.ok(out.geometry.getAttribute('uv'));
 assert.ok(out.geometry.getAttribute('skinIndex'));
 out.geometry.dispose();g.dispose();
});

test('QEM output GLB preserves rig, texture UVs and animation clip after export',async()=>{
 const src=makeGrid(30),result=await simplifyQEM(src,550,{attributeAware:true,qemError:.1});
 assert.ok(result.geometry,result.reason);
 const originalReader=globalThis.FileReader;
 globalThis.FileReader=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.({target:this})})}
  readAsDataURL(blob){blob.arrayBuffer().then(buf=>{this.result='data:'+blob.type+';base64,'+Buffer.from(buf).toString('base64');this.onloadend?.({target:this})})}
 };
 const root=new THREE.Group(),body=new THREE.Bone(),hand=new THREE.Bone();
 body.name='Body';hand.name='Hand';body.add(hand);root.add(body);
 const mesh=new THREE.SkinnedMesh(result.geometry,new THREE.MeshStandardMaterial());
 root.add(mesh);root.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([body,hand]));
 const clip=new THREE.AnimationClip('QEM_Walk',1,[new THREE.QuaternionKeyframeTrack(
  'Hand.quaternion',[0,1],[0,0,0,1,0,.2,0,.9797959]
 )]);
 try{
  const bin=await new GLTFExporter().parseAsync(root,{binary:true,trs:true,animations:[clip]});
  assert.ok(bin instanceof ArrayBuffer);
  const d=new DataView(bin),size=d.getUint32(12,true);
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bin,20,size)).trim());
  assert.equal(gltf.animations?.length,1);
  assert.equal(gltf.skins?.length,1);
  const attrs=gltf.meshes?.[0]?.primitives?.[0]?.attributes||{};
  for(const a of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])
   assert.ok(attrs[a]!==undefined,'missing '+a);
 }finally{
  mesh.geometry.dispose();mesh.material.dispose();src.dispose();
  globalThis.FileReader=originalReader;
 }
});

test('million-triangle stress: offline QEM processes Tripo-size geometry while retaining UV',async()=>{
 const started=Date.now(),g=makeGrid(725),source=g.index.count/3;
 assert.equal(source,1051250);
 const out=await simplifyQEM(g,300000,{qemError:.15,attributeAware:true,uvRepeat:16});
 console.log('QEM_MILLION_BENCHMARK',JSON.stringify({
  source,target:300000,output:out.triangles||0,vertices:out.vertices||0,
  elapsedMs:Date.now()-started,wasmError:out.qemError||null,reason:out.reason||null
 }));
 assert.ok(out.geometry,out.reason);
 assert.ok(out.triangles<source,'no hard 1M limit');
 assert.ok(out.geometry.getAttribute('uv'));
 assert.ok(out.geometry.getAttribute('skinWeight'));
 out.geometry.dispose();g.dispose();
});
