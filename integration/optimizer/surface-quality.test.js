import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {compareSurfaces} from './surface-quality.js';
function mesh(pts,ix){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
 g.setIndex(ix);return g;
}
const cubePositions=[-1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1,-1,-1,1,1,-1,1,1,1,1,-1,1,1];
const cubeIndices=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0];
test('same mesh has zero measured surface deviation',()=>{
 const a=mesh(cubePositions,cubeIndices);
 const b=a.clone();
 const q=compareSurfaces(a,b,{samples:24});
 assert.equal(q.accepted,true);assert.ok(q.maxFraction<1e-6);a.dispose();b.dispose();
});
test('shrunk geometry is rejected instead of claiming zero movement',()=>{
 const a=mesh(cubePositions,cubeIndices);
 const b=mesh(cubePositions.map(x=>x*.5),cubeIndices);
 const q=compareSurfaces(a,b,{samples:24});
 assert.equal(q.accepted,false);
 assert.match(q.reason,/Габариты/);
 a.dispose();b.dispose();
});
test('missing surface is rejected even with the same bounds',()=>{
 const a=mesh(cubePositions,cubeIndices);
 const b=mesh(cubePositions,[0,1,2,4,6,5]);
 const q=compareSurfaces(a,b,{samples:30});
 assert.equal(q.accepted,false);
 assert.ok(q.maxFraction>.012);
 a.dispose();b.dispose();
});
