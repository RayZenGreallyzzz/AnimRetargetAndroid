/**
 * Target budgeting for the ENTIRE Phoenix Forge ONE character.
 * No geometry mutation: caller creates all candidate meshes first and commits
 * them atomically only when the actual total meets the requested target.
 */
export const MIN_AUTOLOD_TRIANGLES=12000;
export const MAX_AUTOLOD_TRIANGLES=50000;
export function validateTotalTarget(n){
 if(!Number.isInteger(n)||n<MIN_AUTOLOD_TRIANGLES||n>MAX_AUTOLOD_TRIANGLES)
  throw new RangeError('Укажи общее количество от 12 000 до 50 000 треугольников.');
 return n;
}
function legalEntry(x) {
 if(!Number.isInteger(x.triangles)||x.triangles<0)throw Error('Некорректное число треугольников меша.');
 return {name:String(x.name||'Mesh'),triangles:x.triangles,locked:!!x.locked,
  reason:x.reason||'',min:x.triangles<=64?x.triangles:
   Math.min(x.triangles,Math.max(64,Math.min(600,Math.round(Math.sqrt(x.triangles)*2))))};
}
/**
 * Cost-aware fair allocation: a square-root weight gives small detailed meshes
 * a higher ratio than a pure area-based split. UV/morph/skinning safety is
 * handled by the caller; locked entries never change.
 * @param {Array<{name:string,triangles:number,locked?:boolean,reason?:string}>} entries
 */
export function planTotalLOD(entries,target){
 validateTotalTarget(target);
 if(!Array.isArray(entries)||!entries.length)throw Error('Нет мешей для AutoLOD.');
 const parts=entries.map(legalEntry);
 const original=parts.reduce((n,p)=>n+p.triangles,0);
 if(original<=target)return {status:'already',original,target,planned:original,parts:parts.map(p=>({...p,goal:p.triangles}))};
 const fixed=parts.reduce((n,p)=>n+(p.locked?p.triangles:p.min),0);
 if(fixed>target){
  return {status:'impossible',reason:'Даже минимальное безопасное распределение потребует '+fixed+
   ' треугольников. Некоторые мелкие детали/морфы нельзя сокращать. Исходник сохранён.',
    original,target,minimum:fixed,parts:parts.map(p=>({...p,goal:p.locked?p.triangles:p.min}))};
 }
 const work=parts.map((p,i)=>({...p,index:i,goal:p.locked?p.triangles:p.min}));
 let remaining=target-fixed,attempts=0;
 while(remaining>0 && attempts++<parts.length+3){
  const eligible=work.filter(p=>!p.locked&&p.goal<p.triangles);
  if(!eligible.length)break;
  const sum=eligible.reduce((a,p)=>a+Math.sqrt(p.triangles),0);
  if(sum<=0)break;
  let assigned=0;
  const fractions=[];
  for(const p of eligible){
   const exact=remaining*Math.sqrt(p.triangles)/sum;
   const add=Math.min(p.triangles-p.goal,Math.floor(exact));
   p.goal+=add; assigned+=add;
   fractions.push({p,frac:exact-Math.floor(exact)});
  }
  remaining-=assigned;
  if(!remaining)break;
  fractions.sort((a,b)=>b.frac-a.frac||a.p.index-b.p.index);
  let added=0;
  for(const {p} of fractions){
   if(!remaining)break;
   if(p.goal<p.triangles){p.goal++;remaining--;added++;}
  }
  if(assigned===0&&added===0)break;
 }
 const planned=work.reduce((n,p)=>n+p.goal,0);
 if(planned>target)throw Error('Ошибка распределения бюджета: сумма превышает цель.');
 return {status:'planned',original,target,planned,parts:work.map(({index,...p})=>p)};
}
