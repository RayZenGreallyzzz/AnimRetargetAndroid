/* Phoenix Character Forge — Woman skeleton controller.
 * Injected ONLY into a staged copy of the user's exact Rig Animation Studio 7.6.
 * The original app and its Chest Guard/animation/export logic remain intact.
 */
(function(){
  'use strict';
  const initial={breast:true,tail:false,wings:false,ears:false};
  const state={...initial};
  const order=['breast','tail','wings','ears'];
  const file=()=> 'rigs/rig-woman-'+order.map(k=>state[k]?'1':'0').join('')+'.glb';
  window.PhoenixWomanRig={get file(){return file();},get options(){return {...state};}};
  const suffix={breast:4,tail:4,wings:8,ears:6};
  const updateSummary=()=>{
    const label=document.getElementById('phoenix-woman-current-bones');
    if(!label)return;
    const n=order.reduce((sum,k)=>sum+(state[k]?suffix[k]:0),0);
    label.textContent='Woman: '+n+' дополнительных костей; '+
      order.filter(k=>state[k]).map(k=>({breast:'грудь',tail:'хвост',wings:'крылья',ears:'уши'})[k]).join(' · ');
  };
  function init(){
    const profile=document.getElementById('skeleton-selection');
    const panel=document.getElementById('phoenix-woman-bone-options');
    if(!profile||!panel)return;
    const reflect=()=>{
      const woman=profile.value==='woman';
      panel.style.display=woman?'flex':'none';
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
          // Existing v7.6 selection handler re-loads preview skeleton from
          // the new rig_file. No exporter or original Rig logic is replaced.
          profile.dispatchEvent(new Event('change',{bubbles:true}));
        }
      });
    });
    reflect();
    // The base app fills this select asynchronously after indexing rig packs.
    // Observe only to update visual mode, not to create fake options.
    new MutationObserver(reflect).observe(profile,{childList:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();