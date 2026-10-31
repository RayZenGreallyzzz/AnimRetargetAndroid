import test from 'node:test';
import assert from 'node:assert/strict';
import {optimizeCharacterInBackground} from './autolod-batch.js';
function fixture(counts){
 return counts.map((triangles,i)=>({
  name:'mesh'+i,triangles,mesh:{name:'mesh'+i,geometry:{value:triangles}}}));
}
test('full character optimizes all meshes and preserves original pointers until preview',async()=>{
 const all=fixture([20000,15000,12000]);let calls=0;
 const fn=(g,target)=>{
  calls++;return {promise:Promise.resolve({geometry:{value:target,dispose(){}},triangles:target}),cancel(){}};
 };
 const result=await optimizeCharacterInBackground(all,25000,()=>({}),()=>{},fn).promise;
 assert.equal(result.total,25000);assert.equal(result.candidates.length,3);
 assert.equal(calls,3);
 assert.ok(all.every(e=>e.mesh.geometry.value===e.triangles),'no mutation before preview');
});
test('failed quality result aborts entire batch and disposes previous results',async()=>{
 const all=fixture([30000,30000]);let disposed=0,n=0;
 const fn=(g,target)=>{
  n++;
  return g.value===30000 && n>1?
   {promise:Promise.resolve({reason:'Повреждён силуэт'}),cancel(){}}:
   {promise:Promise.resolve({geometry:{dispose(){disposed++}},triangles:target}),cancel(){}};
 };
 await assert.rejects(optimizeCharacterInBackground(all,12000,()=>({}),()=>{},fn).promise,/силуэт/);
 assert.equal(disposed,1);
 assert.ok(all.every(e=>e.mesh.geometry.value===30000));
});
test('morph/locked meshes remain untouched in atomic whole-character run',async()=>{
 const all=fixture([4000,40000]);all[0].locked=true;
 const res=await optimizeCharacterInBackground(all,12000,()=>({}),()=>{},
  (g,target)=>({promise:Promise.resolve({geometry:{dispose(){}},triangles:target}),cancel(){}})).promise;
 assert.equal(res.total,12000);assert.equal(res.candidates.length,1);
 assert.equal(res.candidates[0].mesh,all[1].mesh);
});
test('cannot silently claim requested budget if simplifier exceeds its allocation',async()=>{
 const all=fixture([60000]);
 await assert.rejects(optimizeCharacterInBackground(all,12000,()=>({}),()=>{},
  (g,target)=>({promise:Promise.resolve({geometry:{dispose(){}},triangles:target+100}),cancel(){}})).promise,/ни один безопасный уровень/);
});
test('already optimized requires no worker',async()=>{
 const all=fixture([6000,4000]);
 const result=await optimizeCharacterInBackground(all,12000,()=>{},()=>{},
  ()=>{throw Error('must not run')}).promise;
 assert.equal(result.already,true);
});

test('when 25k fails surface gate, AutoLOD finds safer <=50k instead of returning nothing',async()=>{
 const all=fixture([1200000]);
 const seen=[];
 let disposed=0;
 const mock=(g,goal,opts)=>{
  seen.push({goal,error:opts.qemError});
  // Pretend the low mesh gets rejected by geometric QA, 35k+ passes.
  if(goal<35000)return {promise:Promise.resolve({reason:'Сохранение объёма: ошибка поверхности'}),cancel(){}};
  return {promise:Promise.resolve({geometry:{dispose(){disposed++}},triangles:goal}),cancel(){}};
 };
 const out=await optimizeCharacterInBackground(all,25000,()=>({qemError:.025}),()=>{},mock).promise;
 assert.equal(out.candidates.length,1);
 assert.ok(out.total>=35000 && out.total<=50000);
 assert.equal(out.approximate,true);
 assert.ok(seen.some(a=>a.goal===25000));
 assert.equal(all[0].mesh.geometry.value,1200000,'original untouched');
});
test('50k hard ceiling remains, even if a slower quality variant needs more',async()=>{
 const all=fixture([1000000]);
 const mock=(g,goal)=>({promise:Promise.resolve({reason:'Защита формы не позволяет '+goal}),cancel(){}});
 await assert.rejects(optimizeCharacterInBackground(all,50000,()=>({}),()=>{},mock).promise,
   /ни один безопасный уровень/);
 assert.equal(all[0].mesh.geometry.value,1000000);
});
