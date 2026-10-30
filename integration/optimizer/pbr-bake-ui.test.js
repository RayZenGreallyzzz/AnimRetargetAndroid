import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPbrBaker} from './pbr-bake-ui.js';

function fixture({hasPreview=true,hasMaps=true}={}){
 const el={};
 for(const name of ['pbr-bake','pbr-reset','pbr-download','pbr-replace',
  'pbr-save-which','pbr-color','pbr-metal','pbr-ao','pbr-emissive','pbr-size','pbr-status']){
  el[name]={checked:false,disabled:true,textContent:'',value:'256',
   replaceChildren(){this.children=[]},append(child){this.children??=[];this.children.push(child)}};
 }
 const material={map:hasMaps?{channel:0}:null};
 const geometry={getAttribute:name=>name==='uv'?{count:4}:null};
 const mesh={geometry,material},preview={mesh,before:geometry,geometry};
 const log=[],pbr=setupPbrBaker({
  getMesh:()=>mesh,getPending:()=>hasPreview?preview:null,
  getOriginal:()=>undefined,
  $:name=>el[name],notify:message=>log.push(message),
  canStart:()=>true
 });
 return {el,pbr,log,mesh};
}
test('PBR re-bake is opt-in and warns instead of reading existing maps',async()=>{
 const {el,pbr,log,mesh}=fixture();
 pbr.refresh();
 assert.match(el['pbr-status'].textContent,/уже сохраняются/);
 await el['pbr-bake'].onclick();
 assert.match(el['pbr-status'].textContent,/галочку/);
 assert.equal(mesh.material.map.channel,0);
 assert.equal(pbr.hasMaterial(mesh),false);
 assert.equal(pbr.isBusy(),false);
 assert.ok(log.length>0);
});
test('PBR panel explains missing QEM preview and keeps image download disabled',()=>{
 const {el,pbr}=fixture({hasPreview:false});
 pbr.refresh();
 assert.match(el['pbr-status'].textContent,/QEM-предпросмотр/);
 assert.equal(el['pbr-download'].disabled,true);
});
test('PBR reset button leaves original material untouched without a bake',()=>{
 const {el,pbr,mesh}=fixture();
 const original=mesh.material;
 el['pbr-reset'].onclick();
 assert.equal(mesh.material,original);
 assert.equal(pbr.hasMaterial(mesh),false);
 assert.match(el['pbr-status'].textContent,/Исходные текстуры/);
});
