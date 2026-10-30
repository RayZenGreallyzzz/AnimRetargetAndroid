import * as THREE from 'three';
import {MeshoptSimplifier} from 'meshoptimizer';

/**
 * Offline edge-collapse/QEM geometry simplification.
 * 
 * Only changes index topology; kept vertices/UV/normals/weights are COPIED
 * exactly (no vertex clustering or texture-baking).
 * The material and animation hierarchy remain with the original Mesh.
 * Output contains compacted vertex streams, making GLB truly smaller.
 */
export async function simplifyQEM(g,target,options={}){
 if(!g?.getAttribute?.('position'))return {reason:'Нет POSITION.'};
 if(Object.values(g.morphAttributes||{}).some(v=>v?.length))
  return {reason:'Морфы лица: режим QEM пока не изменяет их топологию.'};
 if(g.groups.length>1)return {reason:'Несколько material groups: используй отдельный меш для каждой поверхности.'};
 const attrs=g.attributes;
 if(Object.keys(attrs).some(k=>!new Set(['position','normal','uv','uv1','uv2','color','skinIndex','skinWeight','tangent']).has(k)))
  return {reason:'Дополнительные нестандартные атрибуты: изменение топологии не разрешено.'};
 const pos=attrs.position,count=pos.count,triCount=Math.floor((g.index?.count||count)/3);
 if(!Number.isInteger(target)||target<64||target>=triCount)
  return {reason:'Цель должна быть в пределах 64..'+(triCount-1)+' треугольников.'};
 if(!!attrs.skinIndex!==!!attrs.skinWeight)return {reason:'У меша некорректная пара JOINTS/WEIGHTS.'};
 if(g.index?.count%3)return {reason:'Некорректный индексный буфер (неполные треугольники).'};
 const positions=new Float32Array(count*3);
 for(let i=0;i<count;i++){
  for(let k=0;k<3;k++){
   const v=pos.getComponent(i,k);
   if(!Number.isFinite(v))return {reason:'Нечисловые координаты вершин.'};
   positions[i*3+k]=v;
  }
 }
 const indices=g.index?new Uint32Array(g.index.array):Uint32Array.from({length:count},(_,i)=>i);
 await MeshoptSimplifier.ready;
 const error=Math.max(.0001,Math.min(.3,Number(options.qemError)||.025));
 // QEM follows triangle topology; never recomputes UVs, normals or weights.
 const [reduced,metric]=MeshoptSimplifier.simplify(
  indices,positions,3,Math.floor(target)*3,error,options.qemRegularize===false?[]:['Regularize']
 );
 if(reduced.length===0)return {reason:'QEM не смог сохранить корректные треугольники.'};
 if(reduced.length>=indices.length)return {reason:'QEM не смог сократить этот меш без повреждения швов или границ. Исходник сохранён.'};
 const map=new Int32Array(count);map.fill(-1);
 const old=[];const newIndex=new (count<=65535?Uint16Array:Uint32Array)(reduced.length);
 for(let k=0;k<reduced.length;k++){
  const id=reduced[k];
  if(id>=count)throw Error('QEM created invalid vertex index');
  if(map[id]===-1){map[id]=old.length;old.push(id)}
  newIndex[k]=map[id];
 }
 const geometry=new THREE.BufferGeometry();
 for(const [name,attr] of Object.entries(attrs)){
  const ar=name==='skinIndex'?new Uint16Array(old.length*attr.itemSize):
   new Float32Array(old.length*attr.itemSize);
  for(let i=0;i<old.length;i++)for(let j=0;j<attr.itemSize;j++){
   const value=attr.getComponent(old[i],j);
   ar[i*attr.itemSize+j]=value;
  }
  geometry.setAttribute(name,new THREE.BufferAttribute(ar,attr.itemSize,false));
 }
 geometry.setIndex(new THREE.BufferAttribute(
  old.length<=65535?Uint16Array.from(newIndex):Uint32Array.from(newIndex),1));
 if(g.groups.length===1)geometry.addGroup(0,newIndex.length,g.groups[0].materialIndex);
 geometry.computeBoundingBox();geometry.computeBoundingSphere();
 return {geometry,vertices:old.length,triangles:reduced.length/3,
  originalTriangles:triCount,target,targetErrorPercent:Math.round(10000*((reduced.length/3)-target)/target)/100,
  qemError:metric,attempts:1,maxUvMovementTexels:0,maxMovementPercent:0,
  method:'Meshoptimizer QEM edge collapse (UV and skin values unchanged)'};
}
