/**
 * Read the exact cloth-protection metadata written by Phoenix Character Studio.
 * Never infer a mask from nearest bones or accept a mask after topology changes.
 * Signature and compact ranges intentionally mirror Character Studio.
 */
export function geometrySignature(geo) {
 const p=geo?.getAttribute?.('position'),idx=geo?.getIndex?.();
 if(!p)return '';
 let h=2166136261>>>0;
 const hash=n=>{h=Math.imul(h^(n>>>0),16777619)>>>0};
 hash(p.count);hash(idx?.count||p.count);
 const step=Math.max(1,Math.floor(p.count/96));
 for(let i=0;i<p.count;i+=step){
  hash(Math.round(p.getX(i)*100000));hash(Math.round(p.getY(i)*100000));hash(Math.round(p.getZ(i)*100000));
 }
 const last=p.count-1;
 hash(Math.round(p.getX(last)*100000));hash(Math.round(p.getY(last)*100000));hash(Math.round(p.getZ(last)*100000));
 return h.toString(16).padStart(8,'0');
}
export function readClothProtection(mesh){
 const saved=mesh?.userData?.pcsClothMask;
 if(!saved)return {mask:null,count:0,hasMask:false,reason:null};
 const pos=mesh?.geometry?.getAttribute?.('position');
 if(!pos || saved.type!=='phoenix-cloth-guard-v1' || saved.vertices!==pos.count||
    saved.signature!==geometrySignature(mesh.geometry) || !Array.isArray(saved.runs))
  return {mask:null,count:0,hasMask:true,reason:'Маска одежды несовместима с геометрией. Изменение весов заблокировано.'};
 const mask=new Uint8Array(pos.count);let before=0,total=0;
 for(const item of saved.runs) {
  if(!Array.isArray(item)||item.length!==2) return {mask:null,count:0,hasMask:true,reason:'Повреждена маска одежды.'};
  const [start,length]=item;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<1||start<before||start+length>pos.count)
    return {mask:null,count:0,hasMask:true,reason:'Повреждены диапазоны маски одежды.'};
  mask.fill(1,start,start+length);before=start+length;total+=length;
 }
 return {mask,count:total,hasMask:true,reason:null};
}
