import * as THREE from 'three';
import {bakePbrInBackground} from './optimizer-background.js';

const FIELDS=[
 ['map','pbr-color','цвет и прозрачность'],
 ['roughnessMap','pbr-metal','шероховатость'],
 ['metalnessMap','pbr-metal','металличность'],
 ['aoMap','pbr-ao','AO'],
 ['emissiveMap','pbr-emissive','свечение']
];
const filenames={
 map:'Phoenix_BaseColor.png',roughnessMap:'Phoenix_Roughness.png',
 metalnessMap:'Phoenix_Metallic.png',aoMap:'Phoenix_AO.png',
 emissiveMap:'Phoenix_Emission.png'
};
const label={map:'Цвет',roughnessMap:'Шероховатость',metalnessMap:'Металличность',
 aoMap:'AO',emissiveMap:'Свечение'};
function getTexturePixels(texture){
 if(texture?.isCompressedTexture)
  throw Error('Сжатая GPU-текстура не поддерживается: '+(texture.name||'без имени'));
 const image=texture?.image||texture?.source?.data;
 const width=Number(image?.width||0),height=Number(image?.height||0);
 if(!width||!height||width>4096||height>4096)
  throw Error('Карта '+width+' × '+height+' превышает безопасный предел 4096 px на планшете.');
 const canvas=document.createElement('canvas');
 canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('Не удалось прочитать пиксели изображения в Android Canvas');
 try{
  if(image.data&&image.data.length===width*height*4){
   // Three DataTexture raw pixels (already top-to-bottom); no HTML decode.
   ctx.putImageData(new ImageData(Uint8ClampedArray.from(image.data),width,height),0,0);
  }else ctx.drawImage(image,0,0,width,height);
  const pixels=ctx.getImageData(0,0,width,height).data.slice();
  return {pixels,width,height};
 }catch(error){
  throw Error('Текстура '+(texture.name||'без имени')+
   ' недоступна для CPU-запекания: '+error.message);
 }
}
function textureToWorker(key,texture){
 if(!texture)return null;
 if(texture.channel!==0)
  throw Error(label[key]+' использует UV'+(texture.channel+1)+
    '. Перенос второго UV-канала пока не поддерживается — выключи этот тип карты.');
 if(texture.flipY)
  throw Error('Нужен flipY=false для '+label[key]+' (оригинальная glTF-текстура).');
 if(Math.abs(texture.rotation||0)>1e-7)
  throw Error('Поворот UV у карты '+label[key]+' пока не поддерживается.');
 const original=getTexturePixels(texture);
 const wrap=v=>v===THREE.RepeatWrapping?'repeat':
  v===THREE.MirroredRepeatWrapping?'mirror':'clamp';
 return {key,...original,repeat:[texture.repeat?.x||1,texture.repeat?.y||1],
  offset:[texture.offset?.x||0,texture.offset?.y||0],
  wrapS:wrap(texture.wrapS),wrapT:wrap(texture.wrapT),channel:0};
}
/**
 * Optional PBR reprojector; never overwrites GLB source map or current
 * material unless the user explicitly consents and projection succeeds.
 * Does not recalculate UV islands or perform full Tripo auto-retopology.
 */
export function setupPbrBaker({getMesh,getPending,getOriginal,$,notify,canStart}){
 let task=null,generation=0;
 const entries=new Map();
 const report=text=>{$('pbr-status').textContent=text;notify(text)};
 const isBusy=()=>task!==null,hasMaterial=mesh=>entries.has(mesh);
 function clear(mesh){
  const entry=entries.get(mesh);
  if(!entry)return;
  if(mesh.material===entry.baked)mesh.material=entry.original;
  for(const tex of entry.textures.values())tex.dispose();
  entry.baked.dispose();
  entries.delete(mesh);
  $('pbr-download').disabled=true;$('pbr-save-which').replaceChildren();
 }
 function clearAll(){for(const mesh of [...entries.keys()])clear(mesh)}
 function cancel(){
  generation++;
  if(task){const old=task;task=null;old.cancel()}
  $('pbr-bake').textContent='🎨 Перенести PBR-карты';
 }
 function refresh(){
  const mesh=getMesh(),preview=getPending();
  $('pbr-download').disabled=!entries.has(mesh);
  if(!mesh){$('pbr-status').textContent='Загрузи GLB.';return}
  if(entries.has(mesh))return;
  if(!preview&&!getOriginal(mesh)){
   $('pbr-status').textContent='Сначала сделай QEM-предпросмотр, затем переноси карты.';
   return;
  }
  if(!$('pbr-replace').checked)
   $('pbr-status').textContent='Исходные PBR-карты уже сохраняются при QEM. Для нового перепекания явно включи галочку замены.';
  else
   $('pbr-status').textContent='Готово к PBR-проекции. 256 px — первый тест; исходные текстуры останутся в оригинале.';
 }
 function createCanvas(map){
  const canvas=document.createElement('canvas');canvas.width=map.width;canvas.height=map.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Нет Canvas 2D для сохранения PBR');
  const image=ctx.createImageData(map.width,map.height);image.data.set(map.pixels);
  ctx.putImageData(image,0,0);return canvas;
 }
 function attach(mesh,result,reference,originalMapByKey){
  if(!result.maps.length)throw Error('Нет PBR-карт');
  const originalMaterial=entries.get(mesh)?.original||mesh.material;
  const baked=originalMaterial.clone(),textures=new Map(),canvases=new Map();
  try{
   for(const map of result.maps){
    const canvas=createCanvas(map),tex=new THREE.CanvasTexture(canvas);
    const old=originalMapByKey.get(map.key);
    tex.name='Phoenix_PBR_'+label[map.key];
    tex.colorSpace=old?.colorSpace||THREE.NoColorSpace;
    tex.flipY=false;
    // Exported texture uses the output atlas transform from the reference
    // source map: source maps with another transform were sampled using it
    // in the worker before being projected to this single UV destination.
    tex.repeat.copy(reference.repeat);tex.offset.copy(reference.offset);
    tex.wrapS=THREE.ClampToEdgeWrapping;tex.wrapT=THREE.ClampToEdgeWrapping;
    tex.needsUpdate=true;
    baked[map.key]=tex;
    textures.set(map.key,tex);canvases.set(map.key,canvas);
   }
   baked.needsUpdate=true;
   clear(mesh);
   mesh.material=baked;
   entries.set(mesh,{original:originalMaterial,baked,textures,canvases});
  }catch(error){
   for(const tex of textures.values())tex.dispose();
   baked.dispose();
   throw error;
  }
  const select=$('pbr-save-which');select.replaceChildren();
  for(const key of canvases.keys()){
   const opt=document.createElement('option');opt.value=key;opt.textContent=label[key];select.append(opt);
  }
  $('pbr-download').disabled=false;
  report('Готово: '+result.maps.length+' PBR-карт ('+result.size+'²). Совпадений '+
   result.hitCount+', промахов '+result.missCount+
   ', покрыто '+Math.round(result.coveredPixels/result.size**2*100)+'% пикселей. Сравни ДО/ПОСЛЕ перед экспортом.');
 }
 async function start(){
  if(task){cancel();report('PBR-запекание отменено. Исходник не изменён.');return}
  const mesh=getMesh(),preview=getPending();
  const high=preview?.mesh===mesh?preview.before:getOriginal(mesh);
  const low=preview?.mesh===mesh?preview.geometry:mesh?.geometry;
  if(!mesh||!high||!low||high===low)return report('Нужны тяжёлая и облегчённая сетки. Сначала QEM.');
  if(preview&&preview.mesh!==mesh)return report('Выбери меш, который оптимизируешь.');
  if(canStart?.()===false)return report('Сначала отмени новое запекание normal map или восстанови исходный материал.');
  if(Array.isArray(mesh.material)||!mesh.material)return report('PBR перенос нескольких материалов в одном меше пока не поддерживается.');
  const baseMaterial=entries.get(mesh)?.original||mesh.material;
  if(!$('pbr-replace').checked)
   return report('⚠️ QEM уже сохранил оригинальные PBR-карты. Для нового переноса поставь галочку «Создать новые PBR-карты».');
  const options=[],originalMapByKey=new Map();
  let reference=null,token=++generation;
  try{
   for(const [key,toggle] of FIELDS){
    if(!$(toggle).checked)continue;
    const tex=baseMaterial[key];
    if(!tex)continue;
    originalMapByKey.set(key,tex);
    if(!reference)reference=tex;
    const source=textureToWorker(key,tex);
    options.push(source);
    const bytes=options.reduce((sum,m)=>sum+m.pixels.byteLength,0);
    if(bytes>80*1048576)
     throw Error('В выбранных PBR-картах больше 80 МБ распакованных пикселей. Сними часть галочек, чтобы избежать вылета Android.');
   }
   if(options.length===0)return report('У выбранного меша нет отмеченных PBR-текстур.');
   const repeat=[reference.repeat?.x||1,reference.repeat?.y||1];
   const offset=[reference.offset?.x||0,reference.offset?.y||0];
   $('pbr-bake').textContent='✕ Отменить PBR';
   report('Переношу PBR из оригинальной сетки в UV облегчённой. Работаю офлайн…');
   await new Promise(resolve=>requestAnimationFrame(resolve));
   if(token!==generation)return;
   task=bakePbrInBackground(high,low,{
    sources:options,outputRepeat:repeat,outputOffset:offset,
    size:Number($('pbr-size').value),maxRayRatio:.035
   });
   const job=task,result=await job.promise;
   if(job!==task||token!==generation)return;
   task=null;
   attach(mesh,result,reference,originalMapByKey);
  }catch(error){
   if(token===generation)report('PBR не применён: '+error.message);
  }finally{
   if(token===generation){task=null;$('pbr-bake').textContent='🎨 Перенести PBR-карты'}
  }
 }
 $('pbr-replace').onchange=refresh;
 $('pbr-reset').onclick=()=>{
  const mesh=getMesh();if(!mesh)return;
  clear(mesh);report('Новые PBR-карты отключены. Исходные текстуры снова активны.');
 };
 $('pbr-bake').onclick=start;
 $('pbr-download').onclick=()=>{
  const entry=entries.get(getMesh()),key=$('pbr-save-which').value;
  const canvas=entry?.canvases.get(key);
  if(!canvas)return report('Сначала запеки и выбери карту');
  canvas.toBlob(blob=>{
   if(!blob)return report('Не удалось сохранить PBR PNG');
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download=filenames[key]||'Phoenix_PBR.png';
   document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),15000);
  },'image/png');
 };
 return {isBusy,hasMaterial,showPreview(mesh,after){
  const e=entries.get(mesh);if(e)mesh.material=after?e.baked:e.original;
 },cancel,clear,clearAll,refresh};
}
