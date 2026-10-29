import * as THREE from 'three';
import {simplifyGeometry} from './mesh-tools.js';

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
self.onmessage=e=>{
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
  result=simplifyGeometry(g,e.data.target,options);
  if(!result.geometry){
   self.postMessage({kind:'error',message:result.reason||'Не удалось оптимизировать модель'});return;
  }
  const packed=packGeometry(result.geometry);
  const {geometry,...stats}=result;
  self.postMessage({kind:'done',geometry:packed.data,stats},packed.transfers);
 }catch(error){self.postMessage({kind:'error',message:error?.message||String(error)})}
 finally{result?.geometry?.dispose();g?.dispose()}
};