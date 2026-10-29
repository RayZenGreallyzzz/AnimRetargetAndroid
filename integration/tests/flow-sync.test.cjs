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
 const docEvents={},winEvents={},timers=[];
 const createElement=()=>({style:{},hidden:false,children:[],addEventListener(){},append(...args){this.children.push(...args)},textContent:'',setAttribute(){}});
 const document={
  readyState:'complete',body:{appendChild(){}},getElementById:id=>id===input.id?input:null,
  createElement,addEventListener:(event,listener)=>{docEvents[event]=listener}
 };
 const loadCalls=[];
 const window={
  PhoenixNative:native,PhoenixSuite:{tool,toast(){},async useWorkspaceFile(name,inputId){loadCalls.push({name,inputId})}},
  addEventListener:(event,cb)=>{winEvents[event]=cb},setTimeout:(cb)=>{timers.push(cb)}
 };
 const context={window,document,console,HTMLInputElement,Object,Uint8Array,JSON,
  Number,Set,WeakSet,Promise,Error,String,Blob,Buffer,btoa,
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
