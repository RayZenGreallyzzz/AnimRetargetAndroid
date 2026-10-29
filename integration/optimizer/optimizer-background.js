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
