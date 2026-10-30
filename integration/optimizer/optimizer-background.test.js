import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import * as THREE from 'three';
import {optimizeInBackground,bakeNormalsInBackground} from './optimizer-background.js';

function makeMesh(n){
 const pos=[],uv=[],j=[],w=[],index=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
  pos.push(x/n,y/n,0);uv.push(x/n,y/n);
  j.push(x<n/2?0:1,x<n/2?1:0,0,0);
  w.push(.85,.15,0,0);
 }
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
  index.push(a,c,b,b,c,d);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(j,4));
 g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(w,4));
 g.setIndex(index);
 g.computeVertexNormals();
 return g;
}
const nativeWorker=globalThis.Worker;
class NodeBrowserWorker{
 constructor(){
  this.worker=new NodeWorker(new URL('./tests/node-worker-shim.mjs',import.meta.url),{type:'module'});
  this.worker.on('message',data=>this.onmessage?.({data}));
  this.worker.on('error',error=>this.onerror?.({message:error.message}));
 }
 postMessage(data,transfer){this.worker.postMessage(data,transfer)}
 terminate(){void this.worker.terminate()}
}
test('background worker receives copy, preserves source and transfers optimized skin geometry',async()=>{
 globalThis.Worker=NodeBrowserWorker;
 const src=makeMesh(45),before=src.index.count,progress=[];
 try{
  const job=optimizeInBackground(src,800,{preserveUV:false,protectSkin:true},(pass,total)=>progress.push(pass));
  const out=await job.promise;
  assert.ok(out.geometry,out.reason);
  assert.ok(out.triangles<before/3);
  assert.equal(src.index.count,before,'source stays untouched after transfer');
  for(const field of ['position','normal','uv','skinIndex','skinWeight'])
   assert.ok(out.geometry.getAttribute(field),'missing '+field);
  assert.ok(progress.length>0,'worker progress must reach UI');
  out.geometry.dispose();
 }finally{src.dispose();globalThis.Worker=nativeWorker}
});
test('worker can be cancelled before changing original model',async()=>{
 globalThis.Worker=NodeBrowserWorker;
 const src=makeMesh(150);
 try{
  const job=optimizeInBackground(src,1000,{preserveUV:true,protectSkin:true});
  job.cancel();
  await assert.rejects(job.promise,/отменён/);
  assert.equal(src.index.count,150*150*6);
 }finally{src.dispose();globalThis.Worker=nativeWorker}
});

test('gltfpack-style stride8 POSITION and stride4 normalized NORMAL round-trip through worker',async()=>{
 globalThis.Worker=NodeBrowserWorker;
 const g=makeMesh(46),n=g.getAttribute('position').count;
 const quantPos=new Uint16Array(n*4),quantNorm=new Int8Array(n*4);
 for(let i=0;i<n;i++){
  quantPos[i*4]=Math.round(g.getAttribute('position').getX(i)*13000);
  quantPos[i*4+1]=Math.round(g.getAttribute('position').getY(i)*16000);
  quantPos[i*4+2]=0;quantPos[i*4+3]=0;
  quantNorm[i*4]=0;quantNorm[i*4+1]=0;quantNorm[i*4+2]=127;quantNorm[i*4+3]=0;
 }
 g.setAttribute('position',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(quantPos,4),3,0,false));
 g.setAttribute('normal',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(quantNorm,4),3,0,true));
 try{
  const job=optimizeInBackground(g,1200,{preserveUV:false,protectSkin:true});
  const result=await job.promise;
  assert.ok(result.geometry,result.reason);
  assert.ok(result.triangles<46*46*2);
  const pos=result.geometry.getAttribute('position'),normal=result.geometry.getAttribute('normal');
  assert.equal(pos.array.constructor,Float32Array);
  assert.ok(Math.max(pos.getX(0),pos.getX(pos.count-1))>1000);
  assert.ok(normal.getZ(0)>.98 && normal.getZ(0)<=1);
  assert.equal(normal.normalized,false);
  assert.ok(result.geometry.getAttribute('uv'));
  result.geometry.dispose();
 }finally{g.dispose();globalThis.Worker=nativeWorker}
});

test('QEM WASM runs inside the actual transferred geometry worker and keeps UV and weights',async()=>{
 globalThis.Worker=NodeBrowserWorker;
 const source=makeMesh(75),original=source.index.count;
 try{
  const task=optimizeInBackground(source,2500,{
    method:'qem',attributeAware:true,qemError:.075,uvRepeat:16
  });
  const result=await task.promise;
  assert.ok(result.geometry,result.reason);
  assert.ok(result.triangles<original/3,'QEM must really reduce geometry inside Worker');
  for(const k of ['uv','normal','skinIndex','skinWeight'])
   assert.ok(result.geometry.getAttribute(k),'missing '+k);
  assert.equal(source.index.count,original,'original shared source untouched');
  assert.equal(result.method.includes('Meshoptimizer'),true);
  result.geometry.dispose();
 }finally{source.dispose();globalThis.Worker=nativeWorker}
});

test('high-to-low normal-map bake runs inside real transferable background worker',async()=>{
 globalThis.Worker=NodeBrowserWorker;
 const high=makeMesh(20),low=makeMesh(5);
 try{
  const job=bakeNormalsInBackground(high,low,{size:64,repeat:[1,1]});
  const result=await job.promise;
  assert.equal(result.size,64);
  assert.equal(result.pixels.length,64*64*4);
  assert.ok(result.hitCount>2500,'BVH must hit original high-poly mesh');
  assert.equal(high.index.count,20*20*6,'original high-poly unchanged');
  assert.equal(low.index.count,5*5*6,'low-poly unchanged');
 }finally{high.dispose();low.dispose();globalThis.Worker=nativeWorker}
});
test('high-to-low normal baking can be cancelled with original geometry intact',async()=>{
 globalThis.Worker=NodeBrowserWorker;
 const high=makeMesh(75),low=makeMesh(15);
 try{
  const job=bakeNormalsInBackground(high,low,{size:128});
  job.cancel();
  await assert.rejects(job.promise,/отменено/);
  assert.equal(high.index.count,75*75*6);
 }finally{high.dispose();low.dispose();globalThis.Worker=nativeWorker}
});
