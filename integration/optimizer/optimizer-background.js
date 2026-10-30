import * as THREE from 'three';
/**
 * Thread-isolated mesh processing: preserve the original WebGL geometry,
 * send COPY of typed buffers to a module Worker, transfer optimized buffers
 * back without extra copy. No permanent polygon count cap.
 */
const MIN_BYTES=32*1024*1024;
function memoryBudget(){
 const memoryGiB=Number(navigator.deviceMemory)||4;
 // Constrain transient duplicated geometry + V8 buckets on low-RAM Android.
 return Math.max(320,Math.min(850,Math.round(memoryGiB*160)))*1024*1024;
}
function geometryBytes(g){
 let n=g.index?.array?.byteLength||0;
 for(const a of Object.values(g.attributes)){
  if(a.isInterleavedBufferAttribute){
   // gltfpack packs POSITION/NORMAL into nonstandard byte strides.
   // A safe deinterleave into FLOAT32 is included in the estimate.
   if(!a.count||a.itemSize>4)return {reason:'Неизвестный формат чередующихся атрибутов.'};
   n+=a.count*a.itemSize*4;
  }else{
   if(!a.array?.byteLength)return {reason:'Неподдерживаемый буфер атрибута.'};
   n+=a.array.byteLength;
  }
 }
 const pos=g.getAttribute('position');
 const tri=(g.index?.count||pos?.count||0)/3;
 const estimated=Math.round(n*8+(pos?.count||0)*175+tri*22);
 return {sourceBytes:n,estimated};
}
function pack(g){
 const attributes={},transfers=[];
 for(const [name,a] of Object.entries(g.attributes)){
  let array,normalized=a.normalized;
  if(a.isInterleavedBufferAttribute){
   // GLTFLoader uses InterleavedBufferAttribute for gltfpack quantized
   // POSITION (VEC3 uint16 stride8) and NORMAL (VEC3 int8 stride4).
   // Getter methods return normalized values when required; copying raw
   // underlying interleaved buffer would corrupt all attribute offsets.
   if(a.itemSize<1||a.itemSize>4)throw Error('Атрибут с неподдерживаемым числом компонент: '+name);
   array=name==='skinIndex'?new Uint16Array(a.count*a.itemSize):new Float32Array(a.count*a.itemSize);
   const access=[a.getX?.bind(a),a.getY?.bind(a),a.getZ?.bind(a),a.getW?.bind(a)];
   for(let i=0;i<a.count;i++){
    for(let k=0;k<a.itemSize;k++){
     if(!access[k])throw Error('Неподдерживаемый атрибут '+name);
     array[i*a.itemSize+k]=access[k](i);
    }
   }
   normalized=false; // values were unpacked via getters into floats
  }else{
   array=a.array.slice(); // clone so the source remains renderable
  }
  attributes[name]={array,itemSize:a.itemSize,normalized};
  transfers.push(array.buffer);
 }
 const index=g.index?.array?.slice()||null;
 if(index)transfers.push(index.buffer);
 return {data:{attributes,index,groups:g.groups.map(x=>({...x}))},transfers};
}
function unpack(data){
 const g=new THREE.BufferGeometry();
 for(const [name,a] of Object.entries(data.attributes))
  g.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
 if(data.index)g.setIndex(new THREE.BufferAttribute(data.index,1));
 for(const group of data.groups||[])g.addGroup(group.start,group.count,group.materialIndex);
 g.computeBoundingBox();g.computeBoundingSphere();
 return g;
}
export function optimizeInBackground(g,target,options={},progress=()=>{}){
 if(typeof Worker==='undefined')throw Error('В этом Android WebView отсутствует поддержка Worker. Обнови Android System WebView.');
 const bytes=geometryBytes(g);
 if(bytes.reason)throw Error(bytes.reason);
 if(bytes.estimated>memoryBudget()){
  throw Error('Оценка пиковой памяти '+Math.ceil(bytes.estimated/1048576)+
    ' МБ превышает безопасный бюджет '+Math.round(memoryBudget()/1048576)+
    ' МБ. Нужно потоковое разбиение по группам — пока исходник не изменён.');
 }
 const serialized=pack(g);
 const worker=new Worker(new URL('./optimizer.worker.js',import.meta.url),{type:'module'});
 let done=false,rejectPending;
 let resolvePending;
 const promise=new Promise((resolve,reject)=>{resolvePending=resolve;rejectPending=reject});
 function cleanup(){if(done)return;done=true;worker.terminate()}
 worker.onmessage=event=>{
  if(done)return;
  const msg=event.data||{};
  if(msg.kind==='progress'){progress(msg.attempt,msg.total);return}
  if(msg.kind==='error'){cleanup();rejectPending(new Error(msg.message));return}
  if(msg.kind==='done'){
   try{
    const geometry=unpack(msg.geometry);
    cleanup();resolvePending({...msg.stats,geometry});
   }catch(error){cleanup();rejectPending(error)}
  }
 };
 worker.onerror=event=>{if(done)return;cleanup();rejectPending(new Error(event.message||'Сбой Worker'))};
 try{worker.postMessage({kind:'simplify',geometry:serialized.data,target,options},serialized.transfers)}
 catch(error){cleanup();rejectPending(error)}
 return {promise,cancel:()=>{
   if(done)return;
   cleanup();rejectPending(new Error('Расчёт отменён. Исходный GLB не изменён.'));
 }};
}

/** Bake tangent-space normals in the same isolated Worker as QEM.
 * No renderer or textures are touched until the main thread explicitly
 * receives a complete, validated RGBA image.
 */
export function bakeNormalsInBackground(high,low,options={}){
 if(typeof Worker==='undefined')
  throw Error('Фоновое запекание требует Android WebView с поддержкой Worker.');
 const highBytes=geometryBytes(high),lowBytes=geometryBytes(low);
 if(highBytes.reason||lowBytes.reason)throw Error(highBytes.reason||lowBytes.reason);
 const total=highBytes.estimated+lowBytes.estimated;
 if(total>memoryBudget())throw Error(
  'Оценка памяти запекания '+Math.ceil(total/1048576)+
  ' МБ превышает допустимые '+Math.round(memoryBudget()/1048576)+
  ' МБ. Запекание не началось; модели не изменены.'
 );
 const source=pack(high),target=pack(low);
 const worker=new Worker(new URL('./optimizer.worker.js',import.meta.url),{type:'module'});
 let done=false,resolvePending,rejectPending;
 const promise=new Promise((resolve,reject)=>{resolvePending=resolve;rejectPending=reject});
 function cleanup(){if(done)return;done=true;worker.terminate()}
 worker.onmessage=e=>{
  if(done)return;
  const m=e.data||{};
  if(m.kind==='error'){cleanup();rejectPending(new Error(m.message));return}
  if(m.kind==='normalDone'){
   try{
    const out=m.result;
    if(!out?.size||out.pixels?.length!==out.size*out.size*4)
     throw Error('Некорректная normal map из фонового потока.');
    cleanup();resolvePending(out);
   }catch(error){cleanup();rejectPending(error)}
  }
 };
 worker.onerror=e=>{if(done)return;cleanup();rejectPending(new Error(e.message||'Сбой запекания'))};
 try{worker.postMessage({kind:'bakeNormals',high:source.data,low:target.data,options},
  [...source.transfers,...target.transfers]);}
 catch(error){cleanup();rejectPending(error)}
 return {promise,cancel(){
  if(done)return;
  cleanup();rejectPending(new Error('Запекание отменено. Исходная модель не изменена.'));
 }};
}

/** Optional offline high-to-low PBR albedo/MR/AO/emissive transfer.
 * Works only with compatible UV0 atlas + single material. Input textures
 * are transferred to worker as byte copies, without touching live renderer.
 */
export function bakePbrInBackground(high,low,options={}){
 if(typeof Worker==='undefined')
  throw Error('PBR-запекание требует Android WebView с поддержкой Worker.');
 const a=geometryBytes(high),b=geometryBytes(low);
 if(a.reason||b.reason)throw Error(a.reason||b.reason);
 const maps=options.sources||[],rawBytes=maps.reduce((sum,m)=>sum+(m.pixels?.byteLength||0),0);
 if(a.estimated+b.estimated+rawBytes*3>memoryBudget())
  throw Error('Нехватка безопасного бюджета RAM для PBR: выбери меньшее разрешение карты либо облегчённую модель.');
 const source=pack(high),target=pack(low),copies=maps.map(m=>({...m,pixels:m.pixels.slice()}));
 const worker=new Worker(new URL('./optimizer.worker.js',import.meta.url),{type:'module'});
 let done=false,resolvePending,rejectPending;
 const promise=new Promise((resolve,reject)=>{resolvePending=resolve;rejectPending=reject});
 function cleanup(){if(done)return;done=true;worker.terminate()}
 worker.onmessage=e=>{
  if(done)return;
  const msg=e.data||{};
  if(msg.kind==='error'){cleanup();rejectPending(new Error(msg.message));return}
  if(msg.kind==='pbrDone'){
   try{
    const result=msg.result;
    if(!Array.isArray(result?.maps)||result.maps.length!==copies.length)
     throw Error('Повреждённые данные PBR из фонового расчёта.');
    for(const m of result.maps)if(m.pixels?.length!==m.width*m.height*4)
     throw Error('Повреждённая PBR-карта '+m.key);
    cleanup();resolvePending(result);
   }catch(error){cleanup();rejectPending(error)}
  }
 };
 worker.onerror=e=>{if(done)return;cleanup();rejectPending(new Error(e.message||'Сбой PBR Worker'))};
 try{
  worker.postMessage({kind:'bakePbr',high:source.data,low:target.data,
   options:{...options,sources:copies}},
   [...source.transfers,...target.transfers,...copies.map(m=>m.pixels.buffer)]);
 }catch(error){cleanup();rejectPending(error)}
 return {promise,cancel(){
  if(done)return;
  cleanup();rejectPending(new Error('PBR-запекание отменено, оригинал не изменён.'));
 }};
}
