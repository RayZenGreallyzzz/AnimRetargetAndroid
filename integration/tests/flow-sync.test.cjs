const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {resolve}=require('node:path');
const source=readFileSync(resolve(__dirname,'../web/studio-sync.js'),'utf8');
const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
function createNative(){
 let active=null,pending=[],revision=0,saveName='';
 return {
  getActiveFileJson:()=>JSON.stringify(active||{}),
  beginSave:(name,size)=>{saveName=name;pending=[];return 't'},
  appendSaveChunk:(token,base64)=>{if(token!=='t')return false;pending.push(Buffer.from(base64,'base64'));return true},
  finishSave:(token)=>{if(token!=='t')return false;revision++;active={name:saveName,size:Buffer.concat(pending).length,revision,origin:'optimize'};return true},
  cancelSave:()=>{},
  openTool:()=>{},
  getActive:()=>active
 };
}
function mountEditor(tool,native,initialFile=null){
 class HTMLInputElement {}
 const input=new HTMLInputElement();
 input.id=tool==='optimize'?'opt-model-file':tool==='rig'?'model-upload':'base-file';
 input.files=initialFile?[initialFile]:[];
 input.dataset={};
 const docEvents={},docListeners={},winEvents={},timers=[];
 const createElement=()=>({style:{},hidden:false,children:[],addEventListener(){},append(...args){this.children.push(...args)},textContent:'',setAttribute(){}});
 const document={
  readyState:'complete',body:{appendChild(){}},getElementById:id=>id===input.id?input:null,
  createElement,addEventListener:(event,listener)=>{
    (docListeners[event]??=[]).push(listener);
    docEvents[event]=evt=>{for(const fn of docListeners[event])fn(evt)};
  }
 };
 const loadCalls=[];
 const window={
  PhoenixNative:native,PhoenixSuite:{tool,toast(){},async useWorkspaceFile(name,inputId){loadCalls.push({name,inputId})}},
  addEventListener:(event,cb)=>{winEvents[event]=cb},
  dispatchEvent:(event)=>{winEvents[event.type]?.(event)},
  setTimeout:(cb)=>{timers.push(cb)}
 };
 const context={window,document,console,HTMLInputElement,Object,Uint8Array,JSON,
  Number,Set,WeakSet,Promise,Error,String,Blob,Buffer,btoa,
  CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail}},
  requestAnimationFrame:cb=>cb(),setTimeout:cb=>cb()};
 runInNewContext(source,context,{filename:'studio-sync.js'});
 return {document,window,input,docEvents,winEvents,timers,loadCalls,fireReady:()=>timers.splice(0).forEach(fn=>fn())};
}
test('one GLB imported to Optimize is shared and auto-opened in Rig without repicking',async()=>{
 const native=createNative(),blob=Buffer.from('glTF-test-content');
 const file={name:'woman.glb',size:blob.length,slice(a,b){const bytes=blob.subarray(a,b);return {arrayBuffer:async()=>Uint8Array.from(bytes).buffer}}};
 const optimize=mountEditor('optimize',native,file);
 optimize.docEvents.change({target:optimize.input,isTrusted:false});
 await wait();await wait();
 assert.equal(native.getActive().name,'woman.glb');
 assert.equal(native.getActive().revision,1);
 const rig=mountEditor('rig',native);
 rig.fireReady();await wait();
 assert.equal(rig.loadCalls.length,1);
 assert.equal(rig.loadCalls[0].name,'woman.glb');
 assert.equal(rig.loadCalls[0].inputId,'model-upload');
 // A programmatic import from our suite must not publish again.
 rig.input.dataset.phoenixWorkspaceImport='1';
 rig.docEvents.change({target:rig.input,isTrusted:false});
 await wait();
 assert.equal(native.getActive().revision,1);
 // Third independent editor also loads the same current character automatically.
 const character=mountEditor('character',native);
 character.fireReady();await wait();
 assert.equal(character.loadCalls.length,1);
 assert.equal(character.loadCalls[0].name,'woman.glb');
 assert.equal(character.loadCalls[0].inputId,'base-file');
});

test('previously loaded Rig updates automatically to new Character export on reactivation',async()=>{
 const native=createNative();
 const rig=mountEditor('rig',native);
 const base=Buffer.from('base glTF');
 const first={name:'original.glb',size:base.length,slice(a,b){return {arrayBuffer:async()=>Uint8Array.from(base.subarray(a,b)).buffer}}};
 const optimize=mountEditor('optimize',native,first);
 optimize.docEvents.change({target:optimize.input,isTrusted:true});
 await wait();await wait();rig.fireReady();await wait();
 assert.equal(rig.loadCalls.length,1);
 assert.equal(rig.window.PhoenixSync.getState().revision,1);
 const improved=Buffer.from('character new glTF');
 const newer={name:'Character_saved.glb',size:improved.length,slice(a,b){return {arrayBuffer:async()=>Uint8Array.from(improved.subarray(a,b)).buffer}}};
 const character=mountEditor('character',native,newer);
 character.docEvents.change({target:character.input,isTrusted:true});
 await wait();await wait();
 assert.equal(native.getActive().revision,2);
 rig.winEvents['phoenix:activated']();
 await wait();
 assert.equal(rig.loadCalls.length,2,'Rig should automatically adopt new GLB after revisiting');
 assert.equal(rig.loadCalls[1].name,'Character_saved.glb');
 assert.equal(rig.window.PhoenixSync.getState().revision,2);
});
test('an editor with actual local unsaved changes must not silently checkout new GLB',async()=>{
 const native=createNative(),blob=Buffer.from('base glTF');
 const first={name:'original.glb',size:blob.length,slice(a,b){return {arrayBuffer:async()=>Uint8Array.from(blob.subarray(a,b)).buffer}}};
 const rig=mountEditor('rig',native);
 const optimize=mountEditor('optimize',native,first);
 optimize.docEvents.change({target:optimize.input,isTrusted:true});
 await wait();rig.fireReady();await wait();
 const current=rig.window.PhoenixSync.getState();
 assert.equal(current.hasModel,true);
 const changedInput={id:'bone-strength',isTrusted:true,closest(){return false}};
 rig.docEvents.input({target:changedInput,isTrusted:true});
 assert.equal(rig.window.PhoenixSync.getState().dirty,true);
 const second={name:'another.glb',size:blob.length,slice(a,b){return {arrayBuffer:async()=>Uint8Array.from(blob.subarray(a,b)).buffer}}};
 const char=mountEditor('character',native,second);
 char.docEvents.change({target:char.input,isTrusted:true});
 await wait();await wait();
 rig.winEvents['phoenix:activated']();await wait();
 assert.equal(rig.loadCalls.length,1,'Dirty Rig must keep local unexported bones');
 assert.equal(rig.window.PhoenixSync.getState().dirty,true);
});
