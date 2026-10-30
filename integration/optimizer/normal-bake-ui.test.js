import test from 'node:test';
import assert from 'node:assert/strict';
import {setupNormalBaker} from './normal-bake-ui.js';

function fixture(hasNormal=true){
 const elements={
  'bake-normal':{textContent:'',onclick:null},
  'bake-download':{disabled:true,onclick:null},
  'bake-overwrite':{checked:false,onchange:null},
  'bake-status':{textContent:''},
  'bake-size':{value:'256'},'bake-depth':{value:'.035'}
 };
 const geometry={getAttribute:name=>name==='uv'?{count:3}:null};
 const mesh={geometry,material:{normalMap:hasNormal?{}:null}};
 const preview={mesh,before:{getAttribute:()=>({count:3})},geometry};
 const messages=[];
 const controller=setupNormalBaker({
  getMesh:()=>mesh,getPending:()=>preview,
  getOriginal:()=>undefined,$:id=>elements[id],
  notify:message=>messages.push(message)
 });
 return {controller,elements,messages};
}

test('Existing Tripo normal map warns inline and keeps PNG disabled',async()=>{
 const {controller,elements,messages}=fixture(true);
 controller.refresh();
 assert.match(elements['bake-status'].textContent,/уже есть normal map/);
 assert.equal(elements['bake-download'].disabled,true);
 await elements['bake-normal'].onclick();
 assert.match(elements['bake-status'].textContent,/галочку/);
 assert.match(messages.at(-1),/галочку/);
 assert.equal(controller.isBusy(),false);
});
test('Bake panel immediately explains why PNG is disabled and updates on checkbox',()=>{
 const {controller,elements}=fixture(true);
 controller.refresh();
 elements['bake-overwrite'].checked=true;
 elements['bake-overwrite'].onchange();
 assert.match(elements['bake-status'].textContent,/Готово к запеканию/);
 assert.equal(elements['bake-download'].disabled,true);
});
test('Bake panel detects missing QEM preview without starting an empty bake',()=>{
 const {controller,elements}=fixture(false);
 controller.refresh();
 assert.match(elements['bake-status'].textContent,/Сначала выполни QEM/);
});
