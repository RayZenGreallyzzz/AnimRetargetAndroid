import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bakePbrPixels,samplePbrTexture} from './pbr-bake.js';
function grid(n,scale=1,z=0){
 const positions=[],uv=[],index=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){
  positions.push(x/n,y/n,z);uv.push(x/n/scale,y/n/scale);
 }
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;
  index.push(a,b,c,b,d,c);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 g.setIndex(index);g.computeVertexNormals();return g;
}
function source(key='map',scale=1,width=64){
 const pixels=new Uint8ClampedArray(width*width*4);
 for(let y=0;y<width;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;
  pixels[i]=Math.round(255*x/(width-1));
  pixels[i+1]=Math.round(255*y/(width-1));
  pixels[i+2]=key==='metalnessMap'?213:17;
  pixels[i+3]=(x<width/2?255:120);
 }
 return {key,pixels,width,height:width,repeat:[scale,scale],
  offset:[0,0],wrapS:'clamp',wrapT:'clamp',channel:0};
}
test('PBR high-to-low transfers albedo gradients and alpha with original UV',()=>{
 const high=grid(20),low=grid(5),src=source();
 const res=bakePbrPixels(high,low,{size:64,sources:[src]});
 assert.equal(res.maps.length,1);
 assert.ok(res.hitCount>3900,'nearly all UV atlas pixels should project');
 assert.equal(res.missCount,0);
 const map=res.maps[0],at=(x,y,c)=>map.pixels[(y*64+x)*4+c];
 assert.ok(Math.abs(at(16,24,0)-64)<8,'red gradient');
 assert.ok(Math.abs(at(16,24,1)-96)<8,'green gradient');
 assert.equal(at(16,24,3),255);
 assert.equal(at(48,24,3),120,'transparent fabric alpha preserved');
 high.dispose();low.dispose();
});
test('gltfpack x16 UV atlas transfers packed roughness/metallic and emission',()=>{
 const high=grid(20,16),low=grid(7,16);
 const src=source('metalnessMap',16),glow=source('emissiveMap',16);
 const res=bakePbrPixels(high,low,{size:64,sources:[src,glow],
  outputRepeat:[16,16]});
 assert.equal(res.maps.length,2);
 assert.ok(res.hitCount>3900);
 assert.equal(res.maps[0].pixels[(20*64+20)*4+2],213,'metallic packed B not lost');
 assert.equal(res.maps[1].pixels[(20*64+20)*4+2],17,'emissive map sample preserved');
 high.dispose();low.dispose();
});
test('source repeat and offset map colors independently from target atlas',()=>{
 const src=source('map',1,8);
 src.repeat=[2,2];src.offset=[.2,.1];src.wrapS='repeat';
 const result=new Uint8ClampedArray(4);
 samplePbrTexture(src,.45,.25,result);
 assert.ok(result[0]<255);
 assert.ok(result[1]>50);
});
test('PBR transfer refuses a target so far from source that colors would smear',()=>{
 const high=grid(8),low=grid(5,1,10);
 assert.throws(()=>bakePbrPixels(high,low,{
  size:64,sources:[source()],maxRayRatio:.01
 }),/Запекание отменено/);
 high.dispose();low.dispose();
});
test('PBR transfer blocks UV channel mismatch, atlas overflow and unsupported maps',()=>{
 const high=grid(5),low=grid(5),src=source();
 assert.throws(()=>bakePbrPixels(high,low,{size:64,sources:[{...src,channel:1}]}),/UV канал/);
 low.getAttribute('uv').setX(0,1.3);
 assert.throws(()=>bakePbrPixels(high,low,{size:64,sources:[src]}),/UV целевого атласа/);
 high.dispose();low.dispose();
});
