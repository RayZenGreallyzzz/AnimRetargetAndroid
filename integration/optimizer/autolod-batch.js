import {planTotalLOD,MAX_AUTOLOD_TRIANGLES} from './autolod-budget.js';
import {optimizeInBackground} from './optimizer-background.js';

/**
 * All-mesh offline AutoLOD. No geometry is attached to a live Mesh until
 * every candidate passes the simplifier's shape-quality checks.
 * The requested target is a preference; the hard ceiling remains 50k.
 * A low target may be impossible without visible geometric damage.
 */
export function optimizeCharacterInBackground(entries,target,optionsForMesh,progress=()=>{},simplify=optimizeInBackground){
 let cancelled=false,active=null;
 const built=[];
 const promise=(async()=>{
  try{
   const plan=planTotalLOD(entries.map(e=>({
     name:e.name,triangles:e.triangles,locked:e.locked,reason:e.reason
   })),target);
   if(plan.status==='impossible')throw Error(plan.reason);
   if(plan.status==='already')return {plan,candidates:[],total:plan.original,already:true};
   // Slack can be spent ONLY on a failed quality attempt, not on arbitrary
   // reduction failures. Total output is always <= 50,000 triangles.
   let slack=MAX_AUTOLOD_TRIANGLES-target;
   let approximate=false;
   for(let i=0;i<entries.length;i++){
    if(cancelled)throw Error('Автооптимизация отменена. Оригинал сохранён.');
    const part=plan.parts[i], entry=entries[i];
    if(part.goal>=part.triangles)continue;
    const ceiling=Math.min(part.triangles-1,part.goal+slack);
    const goals=[part.goal,Math.min(ceiling,Math.ceil(part.goal*1.4)),
      Math.min(ceiling,Math.ceil(part.goal*1.8)),ceiling]
      .filter((v,i,a)=>v>0&&a.indexOf(v)===i);
    let winner=null,reason='';
    let attempts=0;
    // Increasing the simplifier error tolerance is safe ONLY because each
    // result must still pass BVH surface-quality validation in simplifyQEM.
    // Start with the requested quality before trying stronger QEM.
    const initial=optionsForMesh(entry.mesh);
    const baseError=Number(initial?.qemError)||.025;
    const tolerances=[baseError,Math.max(baseError,.075),Math.max(baseError,.14)]
      .filter((v,i,a)=>a.indexOf(v)===i);
    for(const goal of goals){
     for(const qemError of tolerances){
      if(cancelled)throw Error('Автооптимизация отменена. Оригинал сохранён.');
      attempts++;
      progress({current:i+1,count:entries.length,mesh:part.name,before:part.triangles,
        target:goal,attempt:attempts,approximate:goal>part.goal});
      let result;
      try{
       const job=simplify(entry.mesh.geometry,goal,{...initial,qemError},()=>{});
       active=job;
       result=await job.promise;
       active=null;
      }catch(e){
       active=null;
       reason=e?.message||String(e);
       if(/памят|Worker|неподдерживаемый буфер|нет POSITION|некоррект|морф/i.test(reason))
        throw Error(part.name+': '+reason);
       continue;
      }
      if(cancelled){result?.geometry?.dispose();throw Error('Автооптимизация отменена. Оригинал сохранён.');}
      if(result?.geometry && Number.isInteger(result.triangles) && 
         result.triangles>0 && result.triangles<=goal){
       winner=result;break;
      }
      reason=result?.reason||'Не удалось уменьшить до '+goal+' треугольников.';
      result?.geometry?.dispose();
     }
     if(winner)break;
    }
    if(!winner)throw Error(part.name+': ни один безопасный уровень AutoLOD не прошёл проверку. '+
      reason+' Попробуй 50 000 △ или используй менее сложную исходную модель.');
    const extra=Math.max(0,winner.triangles-part.goal);
    slack-=extra;
    approximate ||= extra>0;
    built.push({mesh:entry.mesh,before:entry.mesh.geometry,geometry:winner.geometry,
      triangles:winner.triangles,stats:winner});
   }
   const total=plan.original-built.reduce((n,p)=>{
    const source=entries.find(e=>e.mesh===p.mesh);
    return n+source.triangles-p.triangles;
   },0);
   if(total>MAX_AUTOLOD_TRIANGLES)
    throw Error('AutoLOD превысил максимальный бюджет 50 000. Исходник сохранён.');
   return {plan,candidates:built,total,target,approximate:approximate||total>target,already:false};
  }catch(error){
   for(const p of built)p.geometry?.dispose();
   throw error;
  }
 })();
 return {promise,cancel(){cancelled=true;active?.cancel()}};
}
