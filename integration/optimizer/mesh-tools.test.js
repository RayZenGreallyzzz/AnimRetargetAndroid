import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {normalizedTop4,simplifyGeometry,closestSegmentDistanceSq,guardSkinToCapsules} from './mesh-tools.js';

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
