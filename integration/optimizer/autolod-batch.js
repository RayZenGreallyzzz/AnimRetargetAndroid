import {planTotalLOD} from './autolod-budget.js';
import {optimizeInBackground} from './optimizer-background.js';

/**
 * Atomic, cancellable multiple-mesh optimization. A failure anywhere aborts
 * and disposes every candidate; source meshes are never mutated here.
 * Individual QEM candidates already pass the surface-quality gate.
 */
export function optimizeCharacterInBackground(entries,target,optionsForMesh,progress=()=>{},simplify=optimizeInBackground){
 const plan=planTotalLOD(entries.map(e=>({
   name:e.name,triangles:e.triangles,locked:e.locked,reason:e.reason
 })),target);
 let cancelled=false,active=null;
 const built=[];
 const promise=(async()=>{
  try{
   if(plan.status==='impossible')throw Error(plan.reason);
   if(plan.status==='already')return {plan,candidates:[],total:plan.original,already:true};
   for(let i=0;i<entries.length;i++){
    if(cancelled)throw Error('Автооптимизация отменена. Оригинал сохранён.');
    const p=plan.parts[i], entry=entries[i];
    if(p.goal>=p.triangles)continue;
    progress({current:i+1,count:entries.length,mesh:p.name,before:p.triangles,target:p.goal});
    const job=simplify(entry.mesh.geometry,p.goal,optionsForMesh(entry.mesh),()=>{});
    active=job;
    const result=await job.promise;
    active=null;
    if(cancelled){result.geometry?.dispose();throw Error('Автооптимизация отменена. Оригинал сохранён.')}
    if(!result.geometry)throw Error(p.name+': '+(result.reason||'Не удалось построить геометрию.'));
    if(!Number.isInteger(result.triangles)||result.triangles<1||result.triangles>p.goal){
      result.geometry.dispose();
      throw Error(p.name+': целевой бюджет недостижим без потери качества ('+
        String(result.triangles)+' вместо '+p.goal+').');
    }
    built.push({mesh:entry.mesh,before:entry.mesh.geometry,geometry:result.geometry,
      triangles:result.triangles,stats:result});
   }
   const total=plan.original-built.reduce((n,p)=>{
    const source=entries.find(e=>e.mesh===p.mesh);
    return n+source.triangles-p.triangles;
   },0);
   if(total>target)throw Error('Общее число треугольников превышает цель. Исходник сохранён.');
   return {plan,candidates:built,total,target,already:false};
  }catch(error){
   for(const p of built)p.geometry?.dispose();
   throw error;
  }
 })();
 return {promise,cancel(){cancelled=true;active?.cancel()}};
}
