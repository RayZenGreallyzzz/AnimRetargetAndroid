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
    nextButton.onclick=()=>{if(!getActive())return warn("Сначала импортируй GLB");bridge.openTool("rig");};
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
    note.textContent = (outOfDate ? "Есть новая версия: " : "Общий персонаж: ")
      + text(model.name) + " · ревизия " + model.revision;
    syncButton.hidden = syncing || (hasModel && !outOfDate);
    if(nextButton)nextButton.hidden=tool!=="optimize"||syncing;
    if (!hasModel) syncButton.textContent = "Открыть в этом редакторе";
    else syncButton.textContent = "Загрузить новую версию";
  }

  async function syncActive(manual = false) {
    const active = getActive();
    if (!active || syncing) return;
    if (hasModel && active.revision === lastRevision) return;
    // A user may already have edited the current editor; never overwrite silently.
    if (manual && hasModel && !window.confirm(
      "Загрузить другую версию GLB? Несохранённые изменения в этой вкладке могут быть потеряны."
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
    } catch(err) {
      warn("Не удалось синхронизировать модель: " + (err?.message || String(err)));
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
      if(latest){lastRevision=latest.revision;hasModel=true;}
      updateStatus();
    } catch (err) {
      if (token) bridge.cancelSave(token);
      warn("Не удалось сохранить общую модель: " + (err?.message || String(err)));
    }
  }

  function onFileInputChange(event) {
    const input = event.target;
    if (!input || input.id !== modelInput) return;
    // Synthetic events are generated when the shared model is imported by suite.
    // Publishing those again would cause an infinite sync revision loop.
    if (!event.isTrusted) return;
    const file = input.files && input.files[0];
    if (!file || handledFiles.has(file)) return;
    handledFiles.add(file);
    hasModel = true;
    lastRevision = getActive()?.revision ?? -1;
    updateStatus();
    void publishImportedFile(file);
  }

  function onReactivated() {
    const active = getActive();
    if (!active) {
      // Restored local file selection can appear before sync listeners mount.
      // Adopt once, but never re-publish files created by our own workspace import.
      const input=document.getElementById(modelInput);
      const file=input?.files?.[0];
      if(file && !handledFiles.has(file) && !input.dataset.phoenixWorkspaceImport){
        handledFiles.add(file);hasModel=true;
        void publishImportedFile(file);
      }
      updateStatus();return;
    }
    // First opening of the other module: automatically load the latest exported model.
    if (!hasModel && !syncing) {
      void syncActive(false);
    } else {
      // Existing edits must not be silently replaced by another tab's changes.
      updateStatus();
    }
  }

  function init() {
    mount();
    document.addEventListener("change", onFileInputChange, true);
    window.addEventListener("phoenix:activated", onReactivated);
    window.addEventListener("phoenix:workspace-updated", () => {
      const active = getActive();
      if (active && active.origin === tool) {
        hasModel = true;
        lastRevision = active.revision;
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
