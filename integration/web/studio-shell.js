/* Phoenix Character Forge shared navigation + offline project workspace.
   Bundled into COPIES of Rig Animation Studio and Character Studio; originals unchanged. */
(() => {
  "use strict";
  const native = window.PhoenixNative;
  const rootPath = location.pathname;
  const tool = rootPath.includes("/optimize/") ? "optimize" : (rootPath.includes("/character/") ? "character" : "rig");
  const ACCENT = "#ff8a36";
  const rules = [
    ".phoenix-suite-tabs{display:flex;align-items:center;gap:5px;max-width:100%;overflow-x:auto;scrollbar-width:thin;padding:4px 5px;border-radius:12px;background:#151820;border:1px solid #444a55;z-index:2100}",
    ".phoenix-suite-tabs button{white-space:nowrap;flex-shrink:0;min-height:37px;background:#242a34;border:1px solid #3a4250;color:#f4f4f4;border-radius:8px;padding:6px 10px;font:600 12px system-ui}",
    ".phoenix-suite-tabs button.is-active{background:#853b19;border-color:#f68a44;color:#fff}",
    ".phoenix-active-character{flex-shrink:0;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aee4aa;font:600 11px system-ui;padding:4px 7px;border:1px solid #426946;border-radius:7px}",
    ".phoenix-suite-tabs button:focus-visible,.phoenix-workspace button:focus-visible{outline:2px solid #ff8a36}",
    ".phoenix-workspace-backdrop{position:fixed;inset:0;z-index:2147483646;background:#000b;display:flex;align-items:center;justify-content:center;padding:12px}",
    ".phoenix-workspace{width:min(540px,98vw);max-height:83vh;overflow:auto;background:#191d27;color:#f0f2f5;border:1px solid #6c778c;border-radius:14px;padding:16px;font:14px system-ui;box-shadow:0 10px 50px #000b}",
    ".phoenix-workspace h3{font-size:18px;margin:3px 0 12px}.phoenix-workspace p{color:#bbc1ce;line-height:1.5}",
    ".phoenix-workspace button{min-height:40px;padding:7px 10px;background:#303847;border:1px solid #556276;border-radius:8px;color:white;margin:3px}",
    ".phoenix-workspace .file{display:flex;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid #3c4250;padding:7px 0;flex-wrap:wrap}",
    ".phoenix-workspace .file span{word-break:break-word;flex:1;min-width:140px}.phoenix-workspace .footer{display:flex;justify-content:flex-end;gap:7px}",
    ".phoenix-workspace select{padding:9px;color:#fff;background:#2b3442;border-radius:6px;max-width:100%}",
    "@media(max-width:770px){.ras-nav{height:auto!important;min-height:96px!important;flex-wrap:wrap!important;gap:6px!important;padding:5px 8px!important}.phoenix-suite-tabs{width:100%;order:2}.phoenix-suite-tabs button{font-size:11px;min-height:38px;padding:5px 8px}#tool-panel{top:104px!important;max-height:calc(100dvh - 115px)!important}}"
  ].join("\n");

  const css = document.createElement("style"); css.textContent = rules; document.head.appendChild(css);
  function call(name, ...args) {
    if (!native || typeof native[name] !== "function") return null;
    try { return native[name](...args); } catch (e) { console.error("Phoenix bridge", name, e); return null; }
  }
  function toast(message) {
    let el = document.getElementById("phoenix-suite-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "phoenix-suite-toast";
      Object.assign(el.style, {position:"fixed",right:"12px",bottom:"12px",zIndex:"2147483647",background:"#242c38",border:"1px solid "+ACCENT,color:"#fff",borderRadius:"10px",padding:"10px 16px",maxWidth:"300px",font:"13px system-ui"});
      document.body.append(el);
    }
    el.textContent = message;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el?.remove(), 6000);
  }
  function escapeHTML(x) {return String(x).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  const destinations = tool === "character"
    ? [{id:"base-file",label:"Персонаж (GLB)"},{id:"detail-file",label:"Деталь (GLB)"},{id:"project-file",label:"Проект (.pcs)"}]
    : tool === "optimize" ? [{id:"opt-model-file",label:"Оптимизация (GLB)"}]
    : [{id:"model-upload",label:"Модель (GLB/FBX/ZIP)"},{id:"import-animations-input",label:"Анимации (GLB)"}];

  function chosenInputs() {
    return destinations.filter(p => document.getElementById(p.id));
  }
  function showPanel() {
    if (document.querySelector(".phoenix-workspace-backdrop")) return;
    if (!native) {toast("Общие файлы доступны внутри Android APK."); return;}
    const popup = document.createElement("div");
    popup.className = "phoenix-workspace-backdrop";
    popup.setAttribute("role","dialog");
    popup.setAttribute("aria-modal","true");
    const panel = document.createElement("div");
    panel.className = "phoenix-workspace";
    const files = (() => {try {return JSON.parse(call("listFiles") || "[]")} catch {return []}})();
    const targets = chosenInputs();
    panel.innerHTML = '<h3>Файлы Phoenix Character Forge</h3>'
     +'<p>Экспортированные модели хранятся во внутреннем хранилище приложения. Выбери файл и импортируй его в активный редактор. Для Retarget нажми вкладку «Ретаргетинг» → «Открыть с персонажем».</p>'
     +'<label>Куда загрузить: <select id="phoenix-target">'+targets.map(t =>'<option value="'+t.id+'">'+escapeHTML(t.label)+'</option>').join("")+'</select></label>'
     + '<div id="phoenix-files"></div><div class="footer"><button id="phoenix-close">Закрыть</button></div>';
    const listing = panel.querySelector("#phoenix-files");
    if(!files.length) listing.innerHTML = "<p>Пока нет сохранённых моделей. Экспортируй GLB или анимацию из редактора.</p>";
    for(const f of files){
      const row = document.createElement("div"); row.className = "file";
      const desc=document.createElement("span");
      const size = typeof f.size === "number" ? " · "+(f.size/1048576).toFixed(1)+" МБ" : "";
      desc.textContent = (f.name || "Файл") + size;
      const load = document.createElement("button");load.textContent="Загрузить";
      load.onclick=async()=> {
        load.disabled=true; load.textContent="Читаю...";
        try {await useWorkspaceFile(f.name,targets.find(p=>p.id===panel.querySelector("#phoenix-target")?.value)?.id);
          popup.remove();
        } catch(e) {toast("Не удалось загрузить: "+e.message); load.disabled=false;load.textContent="Загрузить";}
      };
      const exportButton = document.createElement("button"); exportButton.textContent="В файлы";
      exportButton.onclick=()=>{if(!call("exportFile",f.name))toast("Открываю сохранение через Android...");};
      row.append(desc,load,exportButton);listing.append(row);
    }
    panel.querySelector("#phoenix-close").onclick=()=>popup.remove();
    popup.onclick=e=>{if(e.target===popup) popup.remove()};
    popup.append(panel);document.body.append(popup);
  }

  function base64ToBytes(s) {
    const b = atob(s);
    const bytes=new Uint8Array(b.length);
    for(let i=0;i<b.length;i++)bytes[i]=b.charCodeAt(i);
    return bytes;
  }
  async function useWorkspaceFile(name,targetId) {
    const target=document.getElementById(targetId);
    if(!target || !(target instanceof HTMLInputElement))throw Error("Поле импорта не найдено");
    const size = Number(call("getFileSize",name));
    if(!Number.isFinite(size) || size<0 || size>140*1024*1024)throw Error("Файл слишком большой для импорта на этом устройстве (макс. 140 МБ)");
    const mime=name.toLowerCase().endsWith(".glb")?"model/gltf-binary":"application/octet-stream";
    let file=null;
    // Fast path: stream through Android's private HTTPS-origin workspace handler.
    const fileUrl=call("getWorkspaceUrl",name);
    if(fileUrl && fileUrl.startsWith("https://appassets.androidplatform.net/workspace/")){
      try{
        const response=await fetch(fileUrl,{cache:"no-store"});
        if(!response.ok)throw Error("HTTP "+response.status);
        const blob=await response.blob();
        if(blob.size!==size)throw Error("File size mismatch");
        file=new File([blob],name,{type:mime});
      }catch(error){console.warn("Phoenix stream fallback:",error);}
    }
    if(!file){
      // Backward-compatible fallback for devices without streamed file support.
      const blocks=[];
      for(let offset=0;offset<size;offset+=65536){
        const b64=call("readFileChunk",name,offset,65536);
        if(!b64)throw Error("Не удалось прочитать блок "+offset);
        blocks.push(base64ToBytes(b64));
        if(offset%(1024*1024)<65536)await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      file=new File(blocks,name,{type:mime});
    }
    if(tool==="character" && targetId==="base-file") {
      // Character's original input onchange handler is async, but synthetic
      // dispatchEvent returns immediately and was falsely treated as success.
      // Await the explicitly exported importer instead.
      if(typeof window.PhoenixCharacterImport!=="function")
        throw Error("Character ещё не загрузился. Повтори переход во вкладку.");
      const result=await window.PhoenixCharacterImport(file);
      if(!result?.bones)throw Error("Character не подтвердил загрузку скелета.");
      toast("Character: загружен "+name+" · "+result.bones+" костей");
      return result;
    }
    const transfer=new DataTransfer();
    transfer.items.add(file);
    target.files=transfer.files;
    // Mark the synthetic workspace load so the receiving editor does not
    // publish it again and create an endless GLB revision loop.
    target.dataset.phoenixWorkspaceImport="1";
    try{target.dispatchEvent(new Event("change",{bubbles:true}))}
    finally{delete target.dataset.phoenixWorkspaceImport;}
    toast("Отправлено в "+({rig:"Rig",character:"Character",optimize:"Optimize"}[tool]||tool)+": "+name);
  }
  let navigationBusy=false;
  function currentSharedRevision(){
    try{return Number(JSON.parse(call("getActiveFileJson")||"{}").revision)||0}
    catch{return 0}
  }
  function setRigExportOption(name,value){
    const input=document.querySelector('input[name="'+name+'"][value="'+value+'"]');
    if(input && !input.checked){
      input.checked=true;
      input.dispatchEvent(new Event("change",{bubbles:true}));
    }
  }
  async function commitRigBeforeLeave(next){
    const state=window.PhoenixSync?.getState?.()||{};
    const button=document.getElementById("export-button");
    const exportReady=button && !button.disabled &&
      !!(button.getClientRects?.().length);
    if(!exportReady){
      if(state.dirty){
        throw Error("У Rig есть несохранённые изменения, а экспорт ещё недоступен. Закончи расчёт весов и открой шаг «Анимации → Экспорт», затем повтори переход.");
      }
      // No edits: the shared GLB is already current. No need to export
      // a blank skeleton or demo from the uninitialized Rig editor.
      return;
    }
    // Always transfer the current complete skinned mesh (not skeleton-only or FBX).
    setRigExportOption("export-format","glb");
    setRigExportOption("export-contents","full");
    const before=currentSharedRevision();
    let unsubscribe=null;
    let timeout=null;
    const committed=new Promise((resolve,reject)=>{
      let finished=false;
      const done=(error)=>{
        if(finished)return;finished=true;
        window.removeEventListener("phoenix:workspace-updated",onWrite);
        if(timeout!==null)clearTimeout(timeout);
        if(error)reject(error);else resolve();
      };
      const onWrite=()=>{
        if(currentSharedRevision()>before)done(null);
      };
      window.addEventListener("phoenix:workspace-updated",onWrite);
      timeout=setTimeout(()=>done(new Error(
        "Rig не закончил сохранять GLB. Перейди к экспорту и проверь, что выбран формат GLB и содержимое «Модель + анимации»."
      )),90000);
      unsubscribe=()=>done(new Error("Экспорт Rig прерван"));
      try{button.click()}catch(error){done(error)}
    });
    try{
      toast("Сохраняю кости, веса и анимации из Rig в общий GLB…");
      await committed;
      window.PhoenixSync?.markSaved?.(currentSharedRevision());
    }finally{unsubscribe=null}
  }
  async function switchTool(next){
    if(next===tool||navigationBusy)return;
    navigationBusy=true;
    const items=document.querySelectorAll("#phoenix-suite-tabs button");
    items.forEach(b=>b.disabled=true);
    try{
      await window.PhoenixSync?.whenReady?.();
      if(tool==="optimize"){
        if(typeof window.PhoenixOptimizeSave!=="function")
          throw Error("Оптимизация ещё не готова сохранить общий GLB.");
        if(!(await window.PhoenixOptimizeSave()))
          throw Error("GLB из Оптимизации не сохранён. Заверши предпросмотр или проверь сообщение внизу панели.");
      } else if(tool==="character"){
        if(typeof window.PhoenixCharacterSave!=="function")
          throw Error("Character ещё не готов сохранить персонажа.");
        await window.PhoenixCharacterSave();
      } else if(tool==="rig"){
        await commitRigBeforeLeave(next);
      }
      const state=window.PhoenixSync?.getState?.();
      if(state?.dirty)
        throw Error("Изменения остались несохранёнными; автоматический переход остановлен.");
      call("openTool",next);
    }catch(error){
      toast("Переход остановлен: "+(error?.message||String(error)));
    }finally{
      navigationBusy=false;
      items.forEach(b=>b.disabled=false);
    }
  }
  function buildTabs() {
    document.title = "Phoenix Character Forge — " + (tool === "rig" ? "Риг и анимация" : tool === "optimize" ? "Оптимизация" : "Персонаж");
    const subheading = document.querySelector(".ras-brand-copy strong");
    if (subheading) subheading.textContent = "Phoenix Character Forge";
    const characterName = document.querySelector("header .brand strong");
    if (characterName) characterName.textContent = "PHOENIX CHARACTER FORGE";
    const characterTagline = document.querySelector("header .brand small");
    if (characterTagline) characterTagline.textContent = "RIG · RETARGET · CHARACTER";
    const host = tool==="rig" ? (document.querySelector(".ras-nav") || document.body) : (document.querySelector("header")||document.body);
    if(document.getElementById("phoenix-suite-tabs")) return;
    const tabs=document.createElement("div");tabs.id="phoenix-suite-tabs";tabs.className="phoenix-suite-tabs";
    tabs.setAttribute("aria-label", "Phoenix Character Forge — редакторы");
    const items=[
      {tool:"optimize",label:"① 🧩 Оптимизация"},
      {tool:"rig",label:"② 🦴 Риг и анимация"},
      {tool:"character",label:"③ 🎭 Персонаж"},
      {tool:"retarget",label:"④ 🔁 Ретаргетинг"},
    ];
    for(const item of items){
      const btn=document.createElement("button");btn.type="button";btn.textContent=item.label;
      btn.className=item.tool===tool?"is-active":"";
      btn.setAttribute("aria-current",item.tool===tool?"page":"false");
      btn.onclick=()=>switchTool(item.tool);
      tabs.append(btn);
    }
    const workspace=document.createElement("button");workspace.type="button";
    workspace.textContent="📁 Общие GLB"; workspace.onclick=showPanel;
    tabs.append(workspace);
    const activeLabel=document.createElement("span");
    activeLabel.id="phoenix-active-character";
    activeLabel.className="phoenix-active-character";
    activeLabel.title="Единый GLB для всех вкладок";
    const refreshActiveLabel=()=>{
      try{
        const raw=call("getActiveFileJson"),model=JSON.parse(raw||"{}");
        const revision=Number(model.revision)||0;
        activeLabel.textContent=revision>0
          ?"🟢 Персонаж: "+model.name+" · v"+revision
          :"⚠️ Общий GLB не выбран";
      }catch{activeLabel.textContent="⚠️ Нет общего GLB"}
    };
    refreshActiveLabel();
    window.addEventListener("phoenix:activated",refreshActiveLabel);
    window.addEventListener("phoenix:workspace-updated",refreshActiveLabel);
    tabs.append(activeLabel);
    const memory=document.createElement("button");memory.type="button";
    memory.textContent="🧹 Память"; memory.title="Освободить RAM, закрыв неактивные вкладки после подтверждения";
    memory.onclick=()=>call("releaseHiddenEditors");
    tabs.append(memory);
    host.append(tabs);
  }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",buildTabs,{once:true}); else buildTabs();

  // Capture exported Blob downloads from BOTH web editors; save into the same native workspace.
  // Works with FileSaver's synthetic anchor.click(), and ordinary HTML5 downloads.
  const fileTypes=/\.(glb|gltf|fbx|bvh|zip|pcs|json|obj|vrm|png|jpg|jpeg)$/i;
  function bytesToBase64(bytes){
    let s="";const step=8192;
    for(let i=0;i<bytes.length;i+=step)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+step));
    return btoa(s);
  }
  async function persistBlob(url,filename){
    if(!native)return false;
    toast("Сохраняю "+filename+" в общие файлы...");
    const blob=await (await fetch(url)).blob();
    const token=call("beginSave",filename,blob.size);
    if(!token)throw Error("Нет доступа к хранилищу или недостаточно места");
    try {
      for(let offset=0;offset<blob.size;offset+=65536) {
        const bytes=new Uint8Array(await blob.slice(offset,offset+65536).arrayBuffer());
        if(!call("appendSaveChunk",token,bytesToBase64(bytes)))throw Error("Ошибка записи блока");
        if(offset%(1024*1024)<65536)await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      const saved=call("finishSave",token);
      if(!saved)throw Error("Невозможно завершить сохранение");
      toast("Сохранено: "+filename+" (вкладка «Общие GLB»)");
      window.dispatchEvent(new Event("phoenix:workspace-updated"));
      return true;
    }catch(e){call("cancelSave",token);throw e;}
  }
  document.addEventListener("click",event=>{
    if(!native)return;
    const a=event.target?.closest?.("a[download]");
    if(!a)return;
    const filename=a.download||"model.glb", url=a.href;
    if(!url.startsWith("blob:")||!fileTypes.test(filename))return;
    event.preventDefault();event.stopImmediatePropagation();
    persistBlob(url,filename).catch(e=>toast("Ошибка сохранения: "+e.message));
  },true);
  // The separate synchronization layer uses the same safe chunked file loader.
  // It must not replace or mutate the original Rig or Character editor engines.
  async function saveBlob(blob,name) {
    if(!(blob instanceof Blob)||blob.size<=0)throw Error("Пустой файл модели");
    if(!/\.glb$/i.test(name))throw Error("Передача персонажа поддерживает только GLB");
    const url=URL.createObjectURL(blob);
    try{return await persistBlob(url,name)}
    finally{URL.revokeObjectURL(url)}
  }
  window.PhoenixSuite = Object.freeze({useWorkspaceFile,saveBlob,toast,tool,navigateTo:switchTool});
})();
