import * as THREE from 'three';
import {simplifyGeometry} from './mesh-tools.js';
import {simplifyQEM} from './meshopt-qem.js';
import {bakeNormalPixels} from './normal-bake.js';
import {bakePbrPixels} from './pbr-bake.js';

function packGeometry(g){
 const attributes={};const transfers=[];
 for(const [name,attr] of Object.entries(g.attributes)){
  const array=attr.array; // generated BufferGeometry: no interleaved arrays
  if(!array || !ArrayBuffer.isView(array))throw Error('Unsupported output attribute '+name);
  attributes[name]={array,itemSize:attr.itemSize,normalized:attr.normalized};
  transfers.push(array.buffer);
 }
 const index=g.getIndex()?.array||null;
 if(index)transfers.push(index.buffer);
 return {data:{attributes,index,groups:g.groups.map(x=>({...x}))},transfers};
}
function decodeGeometry(raw){
 const {attributes,index,groups}=raw;
 const g=new THREE.BufferGeometry();
 for(const [name,a] of Object.entries(attributes))
  g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
 if(index)g.setIndex(new THREE.BufferAttribute(index,1));
 for(const gr of groups||[])g.addGroup(gr.start,gr.count,gr.materialIndex);
 return g;
}
self.onmessage=async e=>{
 if(e.data?.kind==='bakePbr'){
  let high=null,low=null;
  try{
   high=decodeGeometry(e.data.high);
   low=decodeGeometry(e.data.low);
   const result=bakePbrPixels(high,low,e.data.options);
   self.postMessage({kind:'pbrDone',result},result.maps.map(m=>m.pixels.buffer));
  }catch(error){self.postMessage({kind:'error',message:error?.message||String(error)})}
  finally{high?.dispose();low?.dispose()}
  return;
 }
 if(e.data?.kind==='bakeNormals'){
  let high=null,low=null;
  try{
   high=decodeGeometry(e.data.high);
   low=decodeGeometry(e.data.low);
   const result=bakeNormalPixels(high,low,e.data.options);
   self.postMessage({kind:'normalDone',result},[result.pixels.buffer]);
  }catch(error){self.postMessage({kind:'error',message:error?.message||String(error)})}
  finally{high?.dispose();low?.dispose()}
  return;
 }
 if(e.data?.kind!=='simplify')return;
 let g=null,result=null;
 try{
  const {attributes,index,groups}=e.data.geometry;
  g=new THREE.BufferGeometry();
  for(const [name,a] of Object.entries(attributes))
   g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
  if(index)g.setIndex(new THREE.BufferAttribute(index,1));
  for(const gr of groups||[])g.addGroup(gr.start,gr.count,gr.materialIndex);
  const options={...e.data.options,onProgress:(attempt,total)=>{
   self.postMessage({kind:'progress',attempt,total});
  }};
  result=options.method==='qem' ? await simplifyQEM(g,e.data.target,options) : simplifyGeometry(g,e.data.target,options);
  if(!result.geometry){
   self.postMessage({kind:'error',message:result.reason||'Не удалось оптимизировать модель'});return;
  }
  const packed=packGeometry(result.geometry);
  const {geometry,...stats}=result;
  self.postMessage({kind:'done',geometry:packed.data,stats},packed.transfers);
 }catch(error){self.postMessage({kind:'error',message:error?.message||String(error)})}
 finally{result?.geometry?.dispose();g?.dispose()}
};