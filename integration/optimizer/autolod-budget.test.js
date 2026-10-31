import test from 'node:test';
import assert from 'node:assert/strict';
import {planTotalLOD,validateTotalTarget} from './autolod-budget.js';
test('validate global target from 12k to 50k inclusive',()=>{
 for(const n of [12000,25000,50000])assert.equal(validateTotalTarget(n),n);
 for(const n of [11999,50001,NaN,25000.5])assert.throws(()=>validateTotalTarget(n));
});
test('1.2M triangle single-mesh cow budgets 12k/25k/50k',()=>{
 for(const target of [12000,25000,50000]){
  const p=planTotalLOD([{name:'cow',triangles:1239212}],target);
  assert.equal(p.status,'planned');assert.equal(p.planned,target);assert.equal(p.parts[0].goal,target);
 }
});
test('entire character multi-mesh allocations sum exactly to global budget',()=>{
 const input=[{name:'body',triangles:770000},{name:'hair',triangles:330000},
  {name:'cloth',triangles:120000},{name:'eyes',triangles:19212}];
 for(const target of [12000,25000,50000]){
  const p=planTotalLOD(input,target);
  assert.equal(p.status,'planned');assert.equal(p.parts.reduce((s,x)=>s+x.goal,0),target);
  assert.ok(p.parts.every(x=>x.goal>0&&x.goal<=x.triangles));
  assert.ok(p.parts[1].goal/input[1].triangles>p.parts[0].goal/input[0].triangles,
   'smaller hair mesh should receive more relative detail');
 }
});
test('unsimplifiable morph details remain untouched within total',()=>{
 const p=planTotalLOD([{name:'face',triangles:3000,locked:true,reason:'morph'},
  {name:'body',triangles:80000}],12000);
 assert.equal(p.parts[0].goal,3000);
 assert.equal(p.parts[1].goal,9000);
});
test('impossible target rejects instead of deforming or silently skipping',()=>{
 const p=planTotalLOD([{name:'morphpacked',triangles:26000,locked:true},
  {name:'body',triangles:80000}],12000);
 assert.equal(p.status,'impossible');assert.ok(p.minimum>p.target);
});
test('already within budget requires no geometry changes',()=>{
 const p=planTotalLOD([{name:'A',triangles:110},{name:'B',triangles:5000}],12000);
 assert.equal(p.status,'already');assert.equal(p.parts[0].goal,110);
});
test('many tiny meshes never produce negative or out-of-range goals',()=>{
 const all=Array.from({length:30},(_,i)=>({name:'object'+i,triangles:1000+i*13}));
 const p=planTotalLOD(all,12000);
 assert.equal(p.status,'planned');assert.equal(p.planned,12000);
 assert.ok(p.parts.every(x=>x.goal>=64&&x.goal<=x.triangles));
});
