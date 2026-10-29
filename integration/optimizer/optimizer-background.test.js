import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import * as THREE from 'three';
import {optimizeInBackground} from './optimizer-background.js';

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
  const job=optimizeInBackground(src,800,{preserveUV:true,protectSkin:true},(pass,total)=>progress.push(pass));
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
