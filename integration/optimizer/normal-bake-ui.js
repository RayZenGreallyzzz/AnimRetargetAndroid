import * as THREE from 'three';
import {bakeNormalsInBackground} from './optimizer-background.js';

/** Independent UI controller. Only attach a material after a complete bake.
 * A cancelled/error bake cannot mutate the original material or geometry.
 */
export function setupNormalBaker({getMesh,getPending,getOriginal,$,notify}){
 let task=null,generation=0;
 const entries=new Map();
 function isBusy(){return task!==null}
 function clear(mesh){
  const item=entries.get(mesh);
  if(!item)return;
  if(mesh.material===item.baked)mesh.material=item.original;
  item.texture.dispose();item.baked.dispose();entries.delete(mesh);
  $('bake-download').disabled=true;
 }
 function clearAll(){for(const mesh of [...entries.keys()])clear(mesh)}
 function cancel(){
  generation++;
  if(task){const previous=task;task=null;previous.cancel()}
  $('bake-normal').textContent='🧩 Запечь normal map';
 }
 function attach(mesh,result,map){
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=result.size;
  const context=canvas.getContext('2d');
  if(!context)throw Error('Нет 2D Canvas для создания normal map.');
  const image=context.createImageData(result.size,result.size);
  image.data.set(result.pixels);context.putImageData(image,0,0);
  clear(mesh);
  const original=mesh.material,baked=original.clone();
  const texture=new THREE.CanvasTexture(canvas);
  texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;
  texture.name='Phoenix_Baked_NormalMap';
  if(map){
   texture.offset.copy(map.offset);texture.repeat.copy(map.repeat);
   texture.wrapS=map.wrapS;texture.wrapT=map.wrapT;
  }
  baked.normalMap=texture;baked.needsUpdate=true;mesh.material=baked;
  entries.set(mesh,{original,baked,texture,canvas});
  $('bake-download').disabled=false;
  $('bake-status').textContent='Готово '+result.size+' × '+result.size+
   '. Совпадений '+result.hitCount+', промахов '+result.missCount+
   ', покрытие '+Math.round(result.pixelsFilled/(result.size*result.size)*100)+
   '%. Карта включена в материал и войдёт в экспорт GLB.';
 }
 async function start(){
  if(task){cancel();notify('Запекание отменено. Исходник сохранён.');return}
  const mesh=getMesh(),preview=getPending(),high=preview?.mesh===mesh?preview.before:getOriginal(mesh);
  const low=preview?.mesh===mesh?preview.geometry:mesh?.geometry;
  if(!mesh||!high||!low||high===low)return notify('Сначала выполни QEM-оптимизацию. Нужны исходная тяжёлая и новая лёгкая сетка.');
  if(preview&&preview.mesh!==mesh)return notify('Выбери меш с текущим предпросмотром.');
  if(Array.isArray(mesh.material)||!low.getAttribute('uv'))
   return notify('Запекание пока поддерживает один материал и UV.');
  const map=mesh.material?.map||null;
  if(Math.abs(map?.rotation||0)>1e-7)
   return notify('Запекание повёрнутого атласа пока не поддерживается.');
  if(map?.flipY===true)
   return notify('Требуется glTF-текстура с flipY=false, чтобы не перевернуть normal map.');
  const repeat=[map?.repeat?.x||1,map?.repeat?.y||1],
    offset=[map?.offset?.x||0,map?.offset?.y||0],token=++generation;
  try{
   notify('Создаю BVH и переношу нормали с тяжёлой сетки. Работаю офлайн...');
   $('bake-normal').textContent='✕ Отменить запекание';
   await new Promise(resolve=>requestAnimationFrame(resolve));
   if(token!==generation)return;
   task=bakeNormalsInBackground(high,low,{size:Number($('bake-size').value),
     maxRayRatio:Number($('bake-depth').value),repeat,offset});
   const current=task,result=await task.promise;
   if(task!==current||token!==generation)return;
   task=null;attach(mesh,result,map);
   notify('Normal map готова. Проверь предпросмотр и сохрани новый GLB.');
  }catch(error){
   if(token===generation){
    $('bake-status').textContent='Не удалось запечь: '+error.message;
    notify('Ошибка запекания: '+error.message);
   }
  }finally{
   if(token===generation){task=null;$('bake-normal').textContent='🧩 Запечь normal map'}
  }
 }
 $('bake-normal').onclick=start;
 $('bake-download').onclick=()=>{
  const entry=entries.get(getMesh());if(!entry)return notify('Сначала запеки normal map.');
  entry.canvas.toBlob(blob=>{
   if(!blob)return notify('Не удалось создать PNG.');
   const url=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=url;a.download='Phoenix_HighToLow_Normal.png';
   document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),15000);
  },'image/png');
 };
 return {isBusy,cancel,clear,clearAll};
}
