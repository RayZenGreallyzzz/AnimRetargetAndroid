import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometrySignature,readClothProtection} from './cloth-mask.js';
function makeMesh(){
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0,1,1,0],3));
 g.setIndex([0,1,2,1,3,2]);
 return new THREE.Mesh(g,new THREE.MeshBasicMaterial());
}
test('Optimizer accepts matching Character cloth mask ranges',()=>{
 const m=makeMesh();
 m.userData.pcsClothMask={type:'phoenix-cloth-guard-v1',vertices:4,
   signature:geometrySignature(m.geometry),runs:[[0,2],[3,1]]};
 const decoded=readClothProtection(m);
 assert.equal(decoded.reason,null);
 assert.equal(decoded.hasMask,true);
 assert.equal(decoded.count,3);
 assert.deepEqual(Array.from(decoded.mask),[1,1,0,1]);
 m.geometry.dispose();m.material.dispose();
});
test('Optimizer refuses stale masks after vertex changes and malformed overlapping ranges',()=>{
 const m=makeMesh();
 m.userData.pcsClothMask={type:'phoenix-cloth-guard-v1',vertices:4,
   signature:geometrySignature(m.geometry),runs:[[1,2],[2,1]]};
 assert.match(readClothProtection(m).reason,/Повреждены/);
 m.userData.pcsClothMask.runs=[[1,2]];
 m.geometry.getAttribute('position').setX(3,3);
 assert.match(readClothProtection(m).reason,/несовместима/);
 m.geometry.dispose();m.material.dispose();
});
