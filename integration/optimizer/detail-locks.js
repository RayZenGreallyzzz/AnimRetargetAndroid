/**
 * A simple deliberate protective region for unrigged high-poly characters.
 * Locks vertices in a 3D sphere centered at the surface touched by the user.
 * The region covers nearby geometry on both sides (e.g. face and hair).
 * No topology modification or material changes.
 */
export function paintDetailSphere(geometry,mask,center,radius,locked=true){
 const p=geometry?.getAttribute?.('position');
 if(!p||mask?.length!==p.count)throw Error('Защитная область не совпадает с мешем');
 if(![center?.x,center?.y,center?.z,radius].every(Number.isFinite)||radius<=0)
  throw Error('Некорректный радиус/центр защиты');
 const squared=radius*radius,target=locked?1:0;
 let changed=0;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i)-center.x,y=p.getY(i)-center.y,z=p.getZ(i)-center.z;
  if(x*x+y*y+z*z>squared||mask[i]===target)continue;
  mask[i]=target;changed++;
 }
 return changed;
}
export function countLocked(mask){
 let count=0;for(let i=0;i<(mask?.length||0);i++)count+=mask[i]?1:0;
 return count;
}
