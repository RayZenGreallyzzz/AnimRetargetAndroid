/* Phoenix Forge ONE: bounded GLB metadata validation before leaving Rig.
 * Reads ONLY the GLB header and JSON metadata from Android's private file
 * bridge. The geometry payload stays on disk. No network and no WebGL GPU
 * allocations. This prevents a skeleton-only or unrigged GLB being silently
 * sent to Character.
 */
(function(root){
  'use strict';
  const MAGIC=0x46546c67,JSON_MAGIC=0x4e4f534a;
  const MAX_JSON_BYTES=32*1024*1024;
  function bytesFromBase64(s){
    if(!s)throw Error('Не удалось прочитать GLB из общего хранилища.');
    const raw=atob(s),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  }
  function chunk(native,name,offset,length){
    const bytes=bytesFromBase64(native.readFileChunk(name,offset,length));
    if(bytes.byteLength!==length)throw Error('Неполные данные GLB: '+name);
    return bytes;
  }
  function describe(json){
    const nodes=Array.isArray(json.nodes)?json.nodes:[];
    const skins=Array.isArray(json.skins)?json.skins:[];
    const meshes=Array.isArray(json.meshes)?json.meshes:[];
    let skinnedMeshes=0,meshesWithPosition=0;
    for(const m of meshes){
      if(m?.primitives?.some(p=>p?.attributes?.POSITION!==undefined))meshesWithPosition++;
    }
    for(const node of nodes){
      if(!Number.isInteger(node?.mesh)||!Number.isInteger(node.skin)||
          node.mesh<0||node.mesh>=meshes.length||node.skin<0||node.skin>=skins.length)
        continue;
      const skin=skins[node.skin],mesh=meshes[node.mesh];
      if(!Array.isArray(skin?.joints)||skin.joints.length===0)continue;
      if(mesh?.primitives?.some(p=>p?.attributes?.POSITION!==undefined &&
        p.attributes.JOINTS_0!==undefined && p.attributes.WEIGHTS_0!==undefined))
        skinnedMeshes++;
    }
    return {hasMesh:meshesWithPosition>0,hasRig:skinnedMeshes>0,
      meshes:meshesWithPosition,skinnedMeshes,skins:skins.length,
      animations:Array.isArray(json.animations)?json.animations.length:0};
  }
  async function inspectActive(native,active){
    if(!active?.name || !/\.glb$/i.test(active.name))
      throw Error('Сначала сохрани общий GLB-персонаж.');
    if(!Number.isSafeInteger(active.size)||active.size<20)
      throw Error('Пустой или некорректный общий GLB.');
    if(typeof native?.readFileChunk!=='function')
      throw Error('Не удалось проверить GLB: Android-хранилище недоступно.');
    const head=chunk(native,active.name,0,20);
    const view=new DataView(head.buffer,head.byteOffset,head.byteLength);
    if(view.getUint32(0,true)!==MAGIC||view.getUint32(4,true)!==2)
      throw Error('Файл не является корректным GLB версии 2.');
    if(view.getUint32(8,true)!==active.size)
      throw Error('GLB записан неполностью: размер файла не совпадает.');
    const jsonSize=view.getUint32(12,true),kind=view.getUint32(16,true);
    if(kind!==JSON_MAGIC||jsonSize<=0||jsonSize>MAX_JSON_BYTES||
       jsonSize+20>active.size)
      throw Error('У GLB отсутствуют корректные метаданные модели.');
    const body=new Uint8Array(jsonSize);
    for(let offset=0;offset<jsonSize;offset+=65536){
      const n=Math.min(65536,jsonSize-offset);
      body.set(chunk(native,active.name,offset+20,n),offset);
      if(offset%(1024*1024)===0)
        await Promise.resolve(); // Let cancel/status events run during big JSON.
    }
    let json;
    try{json=JSON.parse(new TextDecoder('utf-8').decode(body))}
    catch{throw Error('Метаданные GLB повреждены (JSON).')}
    return {name:active.name,revision:active.revision,...describe(json)};
  }
  async function requireCharacterReady(native,active){
    const result=await inspectActive(native,active);
    if(!result.hasMesh)
      throw Error('GLB не содержит 3D-модель. Экспортируй полную модель, а не только скелет.');
    if(!result.hasRig)
      throw Error('GLB не содержит привязанный к модели скелет и веса костей. Заверши Rig и экспортируй полную GLB-модель перед переходом в Character.');
    return result;
  }
  root.PhoenixGlbGuard=Object.freeze({inspectActive,requireCharacterReady});
  if(typeof module==='object' && module.exports)
    module.exports={inspectActive,requireCharacterReady};
})(typeof window!=='undefined'?window:globalThis);
