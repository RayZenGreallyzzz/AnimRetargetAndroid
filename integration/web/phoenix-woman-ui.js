/* Phoenix Character Forge — real Woman skeleton controller for staged Rig 7.6.
 * Rest-pose breast bone offsets are adjustable. GLB inverse bind matrices
 * are regenerated; other Rig 7.6 functions and original build stay untouched.
 */
(function(){
 'use strict';
 const state={breast:true,tail:false,wings:false,ears:false,height:0,depth:0,width:0,revision:0};
 const order=['breast','tail','wings','ears'];
 const path=()=> 'rigs/rig-woman-'+order.map(k=>state[k]?'1':'0').join('')+'.glb';
 const file=()=>path()+'?phoenixChest='+state.revision;
 const suffix={breast:4,tail:4,wings:8,ears:6};
 window.PhoenixWomanRig={
   get file(){return file()},
   get options(){return {...state}},
   get chestOffsets(){return {height:state.height,depth:state.depth,width:state.width}}
 };
 // Three GLTFLoader uses fetch for the rig GLB. Intercept only Woman template
 // GLBs; other models, textures and animations keep their original transport.
 const originalFetch=window.fetch.bind(window);
 window.fetch=async function(input,init){
   const url=typeof input==='string'?input:(input?.url||String(input));
   const res=await originalFetch(input,init);
   if(!res.ok||!/(?:^|\/)rig-woman-[01]{4}\.glb(?:[?#]|$)/i.test(url))return res;
   if(!state.breast || (!state.height&&!state.depth&&!state.width))return res;
   try{
     const raw=await res.arrayBuffer();
     const adjusted=window.PhoenixWomanRigTransform?.adjust(raw,{
       height:state.height,depth:state.depth,width:state.width
     });
     if(!adjusted)throw Error('Woman transform unavailable');
     const headers=new Headers(res.headers);
     headers.delete('content-length');headers.delete('content-encoding');
     headers.set('content-type','model/gltf-binary');
     return new Response(adjusted,{status:200,headers});
   }catch(error){
     console.error('Woman rig transform failed',error);
     // Fail closed: do not silently load the wrong bone locations. The user
     // can choose a neutral slider position and reload the built-in skeleton.
     return new Response('Woman rig transform: '+String(error),{status:422});
   }
 };
 const updateSummary=()=>{
   const label=document.getElementById('phoenix-woman-current-bones');
   if(!label)return;
   const n=order.reduce((sum,k)=>sum+(state[k]?suffix[k]:0),0);
   label.textContent='Woman: '+n+' дополнительных костей; '+
     order.filter(k=>state[k]).map(k=>({breast:'грудь',tail:'хвост',wings:'крылья',ears:'уши'})[k]).join(' · ');
 };
 function injectChestAdjustments(profile){
   const host=document.getElementById('chest-guard-panel')||document.getElementById('phoenix-woman-bone-options');
   if(!host || host.querySelector('#phoenix-woman-adjust'))return;
   const block=document.createElement('div');
   block.id='phoenix-woman-adjust';
   block.style.cssText='background:#1b2a39;border:1px solid #bb7950;border-radius:10px;padding:10px;display:grid;gap:9px;margin-top:8px;color:#f1f1f1;';
   block.innerHTML=[
     '<strong>🦴 Настройка положения костей груди Woman</strong>',
     '<small>Это положение костей (Bind Pose), а не размер защитной области груди.</small>',
     '<label>Высота: <output id="phoenix-breast-height-value">0 см</output><input id="phoenix-breast-height" type="range" min="-0.12" max="0.12" step="0.005" value="0" style="width:100%"></label>',
     '<label>Вперёд / назад: <output id="phoenix-breast-depth-value">0 см</output><input id="phoenix-breast-depth" type="range" min="-0.12" max="0.12" step="0.005" value="0" style="width:100%"></label>',
     '<label>Расстояние между костями: <output id="phoenix-breast-width-value">0 см</output><input id="phoenix-breast-width" type="range" min="-0.08" max="0.08" step="0.005" value="0" style="width:100%"></label>',
     '<button id="phoenix-woman-apply" type="button" style="background:#d7a066;color:#141b24;padding:10px;border:0;border-radius:8px;font-weight:bold">Применить положение костей</button>',
     '<small id="phoenix-woman-adjust-status">Нижнее исходное положение груди включено. Перезагрузка скелета необходима после изменения.</small>'
   ].join('');
   host.appendChild(block);
   const ids=[['height','height'],['depth','depth'],['width','width']];
   for(const [id,key] of ids){
     const el=document.getElementById('phoenix-breast-'+id);
     el.addEventListener('input',()=>{
       const value=Number(el.value);
       document.getElementById('phoenix-breast-'+id+'-value').textContent=
         (value*100>0?'+':'')+Math.round(value*1000)/10+' см';
       document.getElementById('phoenix-woman-adjust-status').textContent='Настройки ещё не применены к скелету.';
     });
   }
   document.getElementById('phoenix-woman-apply').onclick=()=>{
     if(profile.value!=='woman'){
       document.getElementById('phoenix-woman-adjust-status').textContent='Сначала выбери профиль Woman.';
       return;
     }
     if(!window.confirm('Перезагрузить скелет Woman с новым положением груди? Несохранённые правки костей и весов могут потеряться.'))return;
     for(const [id,key] of ids)state[key]=Number(document.getElementById('phoenix-breast-'+id).value);
     state.revision++;
     profile.dispatchEvent(new Event('change',{bubbles:true}));
     document.getElementById('phoenix-woman-adjust-status').textContent='Положение применено к шаблону Woman. Проверь ориентацию костей в рентгене.';
   };
   return block;
 }
 function init(){
   const profile=document.getElementById('skeleton-selection');
   const panel=document.getElementById('phoenix-woman-bone-options');
   if(!profile||!panel)return;
   injectChestAdjustments(profile);
   const reflect=()=>{
     const woman=profile.value==='woman';
     panel.style.display=woman?'flex':'none';
     const adjust=document.getElementById('phoenix-woman-adjust');
     if(adjust)adjust.style.display=woman?'grid':'none';
     if(woman){
       const guard=document.getElementById('chest-guard-enabled');
       if(guard&&!guard.checked){
         guard.checked=true;
         guard.dispatchEvent(new Event('input',{bubbles:true}));
       }
     }
     updateSummary();
   };
   profile.addEventListener('change',reflect);
   order.forEach(k=>{
     const el=document.getElementById('phoenix-woman-'+k);
     if(!el)return;
     el.checked=state[k];
     el.addEventListener('change',()=>{
       state[k]=el.checked;
       updateSummary();
       if(profile.value==='woman'){
         state.revision++;
         profile.dispatchEvent(new Event('change',{bubbles:true}));
       }
     });
   });
   reflect();
   new MutationObserver(reflect).observe(profile,{childList:true});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
