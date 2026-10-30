import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bakeNormalPixels} from './normal-bake.js';

function grid(n,{bulge=false,uvScale=1}={}){
 const coords=[],uv=[],idx=[];
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
  const x=i/n,y=j/n;
  coords.push(x,y,bulge?0.025*Math.sin(x*Math.PI*4)*Math.sin(y*Math.PI*5):0);
  uv.push(x/uvScale,y/uvScale);
 }
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const a=j*(n+1)+i,b=a+1,c=a+n+1,d=c+1;
  idx.push(a,b,c,b,d,c);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 g.setIndex(idx);g.computeVertexNormals();
 return g;
}
test('offline BVH tangent-normal bake reproduces flat source as neutral normals',()=>{
 const high=grid(20),low=grid(5);
 const result=bakeNormalPixels(high,low,{size:64});
 assert.equal(result.pixels.length,64*64*4);
 assert.ok(result.hitCount>3500,'most UV pixels covered by BVH hits');
 assert.equal(result.missCount,0);
 for(let i=0;i<result.pixels.length;i+=4){
  assert.ok(Math.abs(result.pixels[i]-128)<=1);
  assert.ok(Math.abs(result.pixels[i+1]-128)<=1);
  assert.equal(result.pixels[i+2],255);
  assert.equal(result.pixels[i+3],255);
 }
 high.dispose();low.dispose();
});
test('bake captures high-poly shape difference without moving low-poly vertices',()=>{
 const high=grid(52,{bulge:true}),low=grid(8);
 const original=low.getAttribute('position').array.slice();
 const result=bakeNormalPixels(high,low,{size:64,maxRayRatio:.1});
 assert.ok(result.hitCount>3000);
 let changed=0;
 for(let i=0;i<result.pixels.length;i+=4)
  if(Math.abs(result.pixels[i]-128)>4||Math.abs(result.pixels[i+1]-128)>4)changed++;
 assert.ok(changed>300,'high-poly detail encoded in tangent normal channels');
 assert.deepEqual(Array.from(low.getAttribute('position').array),Array.from(original));
 high.dispose();low.dispose();
});
test('gltfpack-like x16 texture atlas maps full 64px normal image safely',()=>{
 const high=grid(15,{bulge:true,uvScale:16}),low=grid(5,{uvScale:16});
 const result=bakeNormalPixels(high,low,{size:64,repeat:[16,16]});
 assert.ok(result.hitCount>3000,'UV transform repeat covers full normal texture');
 high.dispose();low.dispose();
});
test('invalid or out-of-bounds UV or missing attributes fail safely',()=>{
 const high=grid(8),low=grid(4,{uvScale:1});
 assert.throws(()=>bakeNormalPixels(high,low,{size:8}),/32/);
 low.getAttribute('uv').setX(0,1.5);
 assert.throws(()=>bakeNormalPixels(high,low,{size:64}),/UV/);
 high.dispose();low.dispose();
});
