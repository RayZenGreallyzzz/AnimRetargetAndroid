/* Phoenix Character Forge v2: reliable GLB handoff without cloning or mutating the 3D engines.
 * Only publishes complete GLB files. Unsaved bone/animation/face edits remain in their
 * own editor until that editor explicitly exports a GLB.
 */
(() => {
  "use strict";
  const suite = window.PhoenixSuite;
  const bridge = window.PhoenixNative;
  if (!bridge || !suite) return;
  const tool = suite.tool;
  const modelInput = tool === "character" ? "base-file" : (tool === "optimize" ? "opt-model-file" : "model-upload");
  const MAX_MB = 140;
  const MAX_SIZE = MAX_MB * 1024 * 1024;
  let lastRevision = -1;
  let hasModel = false;
  let syncing = false;
  let dirty = false;
  let publishing = null;
  let localSource = null;
  let lastError = '';
  let note = null, syncButton = null, nextButton = null, status = null;
  const handledFiles = new WeakSet();

  const getActive = () => {
    try {
      const raw = bridge.getActiveFileJson();
      const data = JSON.parse(raw || "{}");
      return (data && typeof data.name === "string" && /\.glb$/i.test(data.name)
        && Number.isFinite(data.revision) && data.revision > 0) ? data : null;
    } catch (err) { console.error("Phoenix getActive", err); return null; }
  };
  const text = value => String(value || "").replace(/[\u0000-\u001f]/g, "");
  const warn = message => suite.toast(message);

  const mount = () => {
    if (document.getElementById("phoenix-sync-bar")) return;
    const holder = document.createElement("div");
    holder.id = "phoenix-sync-bar";
    holder.setAttribute("role", "status");
    Object.assign(holder.style, {
      position: "fixed", bottom: "14px", left: "12px", maxWidth: "min(360px, 75vw)",
      zIndex: "2120", background: "rgba(24, 30, 42,.95)",
      color: "#f7f7f7", border: "1px solid #e58d4d",
      borderRadius: "12px", padding: "8px 10px",
      boxShadow: "0 4px 14px #0008", font: "12px system-ui",
    });
    note = document.createElement("span");
    note.style.display = "block";
    note.style.marginBottom = "5px";
    syncButton = document.createElement("button");
    syncButton.type = "button";
    syncButton.textContent = "Загрузить актуальную GLB";
    Object.assign(syncButton.style, {
      border: "1px solid #e58d4d", borderRadius:"7px",
      background:"#763819",color:"#fff",padding:"6px 8px", minHeight:"32px"
    });
    syncButton.addEventListener("click", () => { void syncActive(true); });
    nextButton=document.createElement("button");
    nextButton.type="button";
    nextButton.textContent="Далее → Rig";
    nextButton.hidden=true;
    Object.assign(nextButton.style,{
      border:"1px solid #e58d4d",borderRadius:"7px",background:"#246643",
      color:"#fff",padding:"6px 8px",marginLeft:"4px",minHeight:"32px"
    });
    nextButton.onclick=async()=>{
      if(typeof window.PhoenixOptimizeCommit==="function"){
        nextButton.disabled=true;
        try{await window.PhoenixOptimizeCommit()}
        finally{nextButton.disabled=false}
        return;
      }
      warn("Сначала открой модель в Optimize и сохрани результат.");
    };
    holder.append(note,syncButton,nextButton);
    document.body.appendChild(holder);
    status = holder;
    updateStatus();
  };

  function updateStatus() {
    const model = getActive();
    if (!note || !status) return;
    if (!model) {
      note.textContent = tool==="optimize"
        ? "Шаг 1: открой GLB один раз здесь. После оптимизации экспортируй и перейди в Rig."
        : "В этом редакторе может отображаться локальный персонаж, но ОБЩЕГО GLB ещё нет. Сохрани/импортируй GLB (первый шаг — Оптимизация).";
      syncButton.hidden = true;
      if(nextButton)nextButton.hidden=true;
      return;
    }
    const outOfDate = hasModel && model.revision !== lastRevision;
    note.textContent = (outOfDate ? (dirty?"⚠️ Вкладка изменена, а общий GLB новее: ":"Синхронизирую новую версию: ") : "Общий персонаж: ")
      + text(model.name) + " · ревизия " + model.revision
      + (dirty?" · здесь есть несохранённые правки":"")
      + (lastError?" · ошибка: "+text(lastError):"");
    syncButton.hidden = syncing || (hasModel && !outOfDate);
    if(nextButton)nextButton.hidden=tool!=="optimize"||syncing;
    if (!hasModel) syncButton.textContent = "Открыть в этом редакторе";
    else syncButton.textContent = "Загрузить новую версию";
  }

  async function syncActive(manual = false) {
    const active = getActive();
    if (!active || syncing) return;
    if (hasModel && active.revision === lastRevision) return;
    if (!manual && dirty && hasModel) {
      warn("Есть новые изменения общего GLB, но здесь несохранённые правки. Сохрани их в GLB или выбери «Загрузить новую версию».");
      updateStatus();
      return;
    }
    // A user may already have edited the current editor; never overwrite silently.
    if (manual && hasModel && dirty && !window.confirm(
      "Загрузить актуальный общий GLB? Несохранённые изменения в этой вкладке будут потеряны."
    )) return;
    if (active.size > MAX_SIZE || active.size <= 0) {
      warn("Общая модель слишком большая для передачи. Максимум " + MAX_MB + " МБ.");
      return;
    }
    const input = document.getElementById(modelInput);
    if (!(input instanceof HTMLInputElement)) {
      warn("Импорт модели пока не готов в этом редакторе");
      return;
    }
    syncing = true;
    updateStatus();
    try {
      await suite.useWorkspaceFile(active.name, modelInput);
      hasModel = true;
      lastRevision = active.revision;
      dirty = false;
      localSource = active.name;
      lastError = "";
      window.dispatchEvent(new CustomEvent("phoenix:shared-model-loaded",{detail:{
        name:active.name,revision:active.revision,tool
      }}));
    } catch(err) {
      lastError = err?.message || String(err);
      warn("Не удалось синхронизировать модель: " + lastError);
    } finally {
      syncing = false;
      updateStatus();
    }
  }

  // User-selected GLB becomes the workspace source. It is copied in 64 KiB chunks,
  // not as a giant base64 string, and does not overwrite an existing exported model.
  async function publishImportedFile(file) {
    if (!file || !/\.glb$/i.test(file.name)) return;
    if (file.size > MAX_SIZE || file.size === 0) {
      warn("Для синхронизации выбери GLB до " + MAX_MB + " МБ.");
      return;
    }
    let token = "";
    try {
      token = bridge.beginSave(file.name, file.size);
      if (!token) {
        warn("Общее хранилище занято. Повтори загрузку после экспорта.");
        return;
      }
      for(let offset = 0; offset < file.size; offset += 65536) {
        const part = new Uint8Array(await file.slice(offset,offset + 65536).arrayBuffer());
        let binary = "";
        for(let i=0;i<part.length;i+=8192)
          binary += String.fromCharCode(...part.subarray(i,i+8192));
        if (!bridge.appendSaveChunk(token, btoa(binary)))
          throw Error("Ошибка записи общего GLB");
        if (offset % (1024*1024) < 65536) {
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }
      if (!bridge.finishSave(token)) throw Error("Сохранение не завершено");
      token = "";
      const latest = getActive();
      if(latest){lastRevision=latest.revision;hasModel=true;localSource=latest.name;}
      dirty=false;lastError="";
      window.dispatchEvent(new Event("phoenix:workspace-updated"));
      updateStatus();
    } catch (err) {
      if (token) bridge.cancelSave(token);
      lastError=err?.message||String(err);
      warn("Не удалось сохранить общую модель: " + lastError);
    }
  }

  function onFileInputChange(event) {
    const input = event.target;
    if (!input || input.id !== modelInput) return;
    // Synthetic events are generated when the shared model is imported by suite.
    // Publishing those again would cause an infinite sync revision loop.
    if (input.dataset.phoenixWorkspaceImport==="1") return;
    // Original Rig may dispatch a synthetic change after Android file pick.
    // Accept it, but never loop on files imported by the shared workspace.
    const file = input.files && input.files[0];
    if (!file || handledFiles.has(file)) return;
    handledFiles.add(file);
    hasModel = true;
    localSource = file.name;
    dirty = false;
    lastRevision = getActive()?.revision ?? -1;
    updateStatus();
    publishing = publishImportedFile(file).finally(()=>{
      publishing=null;
      updateStatus();
    });
  }

  function onReactivated() {
    const active = getActive();
    if (!active) {
      // Restored local file selection can appear before sync listeners mount.
      // Adopt once, but never re-publish files created by our own workspace import.
      const input=document.getElementById(modelInput);
      const file=input?.files?.[0];
      if(file && !handledFiles.has(file) && !input.dataset.phoenixWorkspaceImport){
        handledFiles.add(file);hasModel=true;localSource=file.name;
        publishing=publishImportedFile(file).finally(()=>{publishing=null;updateStatus()});
      }
      updateStatus();return;
    }
    // First opening of the other module: automatically load the latest exported model.
    if (!syncing && !publishing &&
        (!hasModel || active.revision !== lastRevision)) {
      // Other WebViews are paused on Android. Reload their current GLB
      // when activated, unless this particular editor contains local edits.
      if (!dirty)void syncActive(false);
      else updateStatus();
    } else updateStatus();
  }

  function trackLocalEdit(event) {
    // Ignore programmatic UI state changes and camera controls. Treat trusted
    // user rig/weight/animation edits as dirty to avoid destroying them
    // when a newer GLB is published by another tab.
    if (!hasModel || syncing || !event?.isTrusted || publishing) return;
    const target=event.target;
    if (!target || target.id===modelInput || target.id==="phoenix-sync-bar" ||
        target.closest?.("#phoenix-suite-tabs, #phoenix-sync-bar")) return;
    if (/^(animation-filter|source-bones-filter|target-bones-filter)$/.test(target.id||""))return;
    dirty=true;updateStatus();
  }
  // Used by native toolbar and by editor save handoffs to ensure the first
  // imported GLB has completed its shared-workspace write before navigation.
  window.PhoenixSync=Object.freeze({
    async whenReady(){if(publishing)await publishing;return getActive()},
    getState(){return {revision:lastRevision,dirty,syncing,hasModel,source:localSource}},
    markSaved(revision){dirty=false;hasModel=true;lastRevision=revision??getActive()?.revision??lastRevision;lastError="";updateStatus()}
  });
  function init() {
    mount();
    document.addEventListener("change", onFileInputChange, true);
    document.addEventListener("change", trackLocalEdit, true);
    document.addEventListener("input", trackLocalEdit, true);
    window.addEventListener("phoenix:activated", onReactivated);
    // Trigger another import when the actual Character Three.js module finishes
    // initializing (it can load after the 600ms/2000ms attempts on Android).
    window.addEventListener("phoenix:character-import-ready", onReactivated);
    window.addEventListener("phoenix:workspace-updated", () => {
      const active = getActive();
      if (active && active.origin === tool) {
        hasModel = true;dirty=false;lastError="";
        localSource=active.name;lastRevision=active.revision;
      }
      updateStatus();
    });
    // Vite and three.js initialise after parsing; input handlers must exist first.
    window.setTimeout(onReactivated, 600);
    window.setTimeout(onReactivated, 2000);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init,{once:true});
  else init();
})();
