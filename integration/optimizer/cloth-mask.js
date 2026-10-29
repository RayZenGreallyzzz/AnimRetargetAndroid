/**
 * Read the exact cloth-protection metadata written by Phoenix Character Studio.
 * Never infer a mask from nearest bones or accept a mask after topology changes.
 * Signature and compact ranges intentionally mirror Character Studio.
 */
export function geometrySignature(geo){
 const p=geo?.getAttribute?.('position'),idx=geo?.getIndex?.();
 if(!p||p.count<1)return '';
 let a=2166136261>>>0,b=0x9e3779b9>>>0;
 const mix=n=>{
  const v=n>>>0;
  a=Math.imul(a^v,16777619)>>>0;
  b=Math.imul((b+(v^0x85ebca6b))>>>0,0x27d4eb2d)>>>0;
 };
 const bytes=new DataView(new ArrayBuffer(8));
 const addFloat=n=>{
  if(!Number.isFinite(n))throw Error('Неверные координаты вершин');
  bytes.setFloat64(0,n,true);
  mix(bytes.getUint32(0,true));mix(bytes.getUint32(4,true));
 };
 mix(p.count);mix(p.itemSize);mix(idx?.count||0);
 for(let i=0;i<p.count;i++){
  addFloat(p.getX(i));addFloat(p.getY(i));addFloat(p.getZ(i));
 }
 if(idx)for(let i=0;i<idx.count;i++)mix(idx.getX(i));
 return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}
export function readClothProtection(mesh){
 const saved=mesh?.userData?.pcsClothMask;
 if(!saved)return {mask:null,count:0,hasMask:false,reason:null};
 const pos=mesh?.geometry?.getAttribute?.('position');
 if(!pos || saved.type!=='phoenix-cloth-guard-v2' || saved.vertices!==pos.count||
    saved.signature!==geometrySignature(mesh.geometry) || !Array.isArray(saved.runs))
  return {mask:null,count:0,hasMask:true,reason:'Маска одежды устарела или несовместима с геометрией. Проверь и заново нарисуй защиту в Character. Изменение весов заблокировано.'};
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
