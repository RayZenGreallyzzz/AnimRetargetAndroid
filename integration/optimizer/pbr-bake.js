import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const CHANNELS=new Set(['map','roughnessMap','metalnessMap','aoMap','emissiveMap']);
function wrapPixel(coord,length,kind){
 let v;
 if(kind==='repeat')v=((coord%1)+1)%1;
 else if(kind==='mirror'){const p=((coord%2)+2)%2;v=p>1?2-p:p;}
 else if(kind==='clamp')v=Math.min(1,Math.max(0,coord));
 else throw Error('Неизвестный режим повторения текстуры');
 // Bilinear sampling in source texture data. Retain original byte colour
 // space: sRGB and packed metallic/roughness data must not be mixed.
 return v*length-.5;
}
export function samplePbrTexture(src,u,v,out,offset=0){
 const w=src.width,h=src.height,p=src.pixels;
 const tx=u*src.repeat[0]+src.offset[0],ty=v*src.repeat[1]+src.offset[1];
 const x=wrapPixel(tx,w,src.wrapS||'clamp'),
   y=wrapPixel(ty,h,src.wrapT||'clamp');
 const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 function wrapIndex(i,size,kind){
  if(kind==='repeat')return ((i%size)+size)%size;
  if(kind==='mirror'){const period=size*2,p=((i%period)+period)%period;return p<size?p:period-1-p}
  return Math.min(size-1,Math.max(0,i));
 }
 const x1=x0+1,y1=y0+1,xx0=wrapIndex(x0,w,src.wrapS||'clamp'),
   xx1=wrapIndex(x1,w,src.wrapS||'clamp'),
   yy0=wrapIndex(y0,h,src.wrapT||'clamp'),
   yy1=wrapIndex(y1,h,src.wrapT||'clamp');
 const a=(yy0*w+xx0)*4,b=(yy0*w+xx1)*4,c=(yy1*w+xx0)*4,d=(yy1*w+xx1)*4;
 for(let k=0;k<4;k++)
  out[offset+k]=Math.round((p[a+k]*(1-fx)+p[b+k]*fx)*(1-fy)+
    (p[c+k]*(1-fx)+p[d+k]*fx)*fy);
}
function validateInput(high,low,sources,size,outputRepeat,outputOffset){
 if(!Number.isInteger(size)||size<32||size>512)
  throw Error('На Android PBR-запекание разрешено при 32–512 px.');
 if(!high?.getAttribute?.('position')||!high?.getAttribute?.('uv')||
    !low?.getAttribute?.('position')||!low?.getAttribute?.('uv'))
  throw Error('Исходной и облегчённой сетке нужны POSITION и UV.');
 if(high.groups.length>1||low.groups.length>1)
  throw Error('Для PBR-запекания нужен один материал на меш.');
 if(!Array.isArray(sources)||sources.length<1||sources.length>5)
  throw Error('Выбери от одной до пяти карт PBR.');
 if(![...outputRepeat,...outputOffset].every(Number.isFinite))
  throw Error('Неверный UV-трансформ целевого атласа.');
 if(outputRepeat.some(x=>x<=0))throw Error('Для PBR нужен положительный UV repeat.');
 const triCount=(high.index?.count||high.getAttribute('position').count)/3;
 if(triCount>1400000)throw Error('Для PBR-запекания понад 1,4 млн граней необходимо разбиение меша.');
 const seen=new Set();
 for(const src of sources){
  if(!CHANNELS.has(src.key)||seen.has(src.key))throw Error('Повторённая или неизвестная PBR-карта: '+src.key);
  seen.add(src.key);
  if(!Number.isInteger(src.width)||!Number.isInteger(src.height)||
     src.width<1||src.height<1||src.width>8192||src.height>8192||
     !src.pixels||src.pixels.length!==src.width*src.height*4)
   throw Error('Повреждённые RGBA-пиксели PBR-карты '+src.key);
  if(!Array.isArray(src.repeat)||!Array.isArray(src.offset)||
     ![...src.repeat,...src.offset].every(Number.isFinite))
   throw Error('Неверный исходный UV-трансформ '+src.key);
  if(src.channel!==0)throw Error('PBR-карта '+src.key+' использует UV канал '+src.channel+
   '. Перенос отдельного UV1 пока не поддерживается.');
 }
}
export function bakePbrPixels(high,low,{
 size=256,sources=[],outputRepeat=[1,1],outputOffset=[0,0],maxRayRatio=.035
}={}){
 validateInput(high,low,sources,size,outputRepeat,outputOffset);
 const hp=high.getAttribute('position'),lp=low.getAttribute('position'),
   huv=high.getAttribute('uv'),luv=low.getAttribute('uv');
 const indexedLow=low.index,indexedHigh=high.index;
 const output=sources.map(src=>({key:src.key,width:size,height:size,
  pixels:new Uint8ClampedArray(size*size*4)}));
 const occupied=new Uint8Array(size*size),matched=new Uint8Array(size*size);
 const bvh=new MeshBVH(high,{maxLeafSize:12,verbose:false});
 high.computeBoundingBox();
 const diagonal=Math.max(1e-7,high.boundingBox.getSize(new THREE.Vector3()).length());
 const maxDistance=diagonal*Math.max(.001,Math.min(.12,Number(maxRayRatio)||.035));
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),
  n=new THREE.Vector3(),pa=new THREE.Vector3(),pb=new THREE.Vector3(),pc=new THREE.Vector3(),
  point=new THREE.Vector3(),tmp=new THREE.Vector3(),bary=new THREE.Vector3(),
  ray=new THREE.Ray(),lowNormal=new THREE.Vector3(),seed=new THREE.Vector3();
 const normals=low.getAttribute('normal');
 let hitCount=0,missCount=0,overlapCount=0,degenerateUV=0;
 for(let t=0;t<(indexedLow?.count||lp.count);t+=3){
  const i0=indexedLow?indexedLow.getX(t):t,
    i1=indexedLow?indexedLow.getX(t+1):t+1,
    i2=indexedLow?indexedLow.getX(t+2):t+2;
  a.fromBufferAttribute(lp,i0);b.fromBufferAttribute(lp,i1);c.fromBufferAttribute(lp,i2);
  const u0=luv.getX(i0)*outputRepeat[0]+outputOffset[0],
   u1=luv.getX(i1)*outputRepeat[0]+outputOffset[0],
   u2=luv.getX(i2)*outputRepeat[0]+outputOffset[0],
   v0=luv.getY(i0)*outputRepeat[1]+outputOffset[1],
   v1=luv.getY(i1)*outputRepeat[1]+outputOffset[1],
   v2=luv.getY(i2)*outputRepeat[1]+outputOffset[1];
  if(![u0,u1,u2,v0,v1,v2].every(Number.isFinite)||
     Math.min(u0,u1,u2,v0,v1,v2)<-.00001||
     Math.max(u0,u1,u2,v0,v1,v2)>1.00001)
   throw Error('UV целевого атласа выходят за 0–1. Перепаковка UV ещё не поддерживается.');
  const det=(u1-u0)*(v2-v0)-(u2-u0)*(v1-v0);
  if(Math.abs(det)<1e-14){degenerateUV++;continue}
  n.subVectors(b,a).cross(tmp.subVectors(c,a)).normalize();
  const minX=Math.max(0,Math.floor(size*Math.min(u0,u1,u2))-1),
   maxX=Math.min(size-1,Math.ceil(size*Math.max(u0,u1,u2))+1),
   minY=Math.max(0,Math.floor(size*Math.min(v0,v1,v2))-1),
   maxY=Math.min(size-1,Math.ceil(size*Math.max(v0,v1,v2))+1);
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const u=(x+.5)/size,v=(y+.5)/size;
   const w1=((u-u0)*(v2-v0)-(v-v0)*(u2-u0))/det,
    w2=((v-v0)*(u1-u0)-(u-u0)*(v1-v0))/det,w0=1-w1-w2;
   if(w0<-.0000001||w1<-.0000001||w2<-.0000001)continue;
   const slot=y*size+x;
   if(occupied[slot]){overlapCount++;continue}
   occupied[slot]=1;
   point.copy(a).multiplyScalar(w0).addScaledVector(b,w1).addScaledVector(c,w2);
   if(normals)lowNormal.set(
    normals.getX(i0)*w0+normals.getX(i1)*w1+normals.getX(i2)*w2,
    normals.getY(i0)*w0+normals.getY(i1)*w1+normals.getY(i2)*w2,
    normals.getZ(i0)*w0+normals.getZ(i1)*w1+normals.getZ(i2)*w2).normalize();
   else lowNormal.copy(n);
   seed.copy(point).addScaledVector(lowNormal,maxDistance);
   ray.origin.copy(seed);ray.direction.copy(lowNormal).negate();
   let hit=bvh.raycastFirst(ray,THREE.DoubleSide,0,maxDistance*2);
   if(!hit){
    seed.copy(point).addScaledVector(lowNormal,-maxDistance);
    ray.origin.copy(seed);ray.direction.copy(lowNormal);
    hit=bvh.raycastFirst(ray,THREE.DoubleSide,0,maxDistance*2);
   }
   if(!hit){missCount++;continue}
   const f=hit.faceIndex,k=f*3,
    hi0=indexedHigh?indexedHigh.getX(k):k,
    hi1=indexedHigh?indexedHigh.getX(k+1):k+1,
    hi2=indexedHigh?indexedHigh.getX(k+2):k+2;
   pa.fromBufferAttribute(hp,hi0);pb.fromBufferAttribute(hp,hi1);pc.fromBufferAttribute(hp,hi2);
   THREE.Triangle.getBarycoord(hit.point,pa,pb,pc,bary);
   if(!Number.isFinite(bary.x)){missCount++;continue}
   const hu=huv.getX(hi0)*bary.x+huv.getX(hi1)*bary.y+huv.getX(hi2)*bary.z,
    hv=huv.getY(hi0)*bary.x+huv.getY(hi1)*bary.y+huv.getY(hi2)*bary.z;
   for(let j=0;j<sources.length;j++)samplePbrTexture(sources[j],hu,hv,output[j].pixels,slot*4);
   matched[slot]=1;hitCount++;
  }
 }
 const matchRate=hitCount/Math.max(1,hitCount+missCount);
 if(matchRate<.95)throw Error('Запекание отменено: '+Math.round(matchRate*100)+
   '% соответствий, риск потерять цвет лица или одежды. Уменьши отклонение сетки.');
 // Small padding along UV island borders to prevent mipmap edge bleed.
 for(const m of output){
  let last=matched;
  for(let pass=0;pass<3;pass++){
   const copy=m.pixels.slice(),next=last.slice();
   for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
    const i=y*size+x;if(last[i])continue;
    for(const other of [i-1,i+1,i-size,i+size]){
     if(!last[other])continue;
     copy.set(m.pixels.subarray(other*4,other*4+4),i*4);
     next[i]=1;break;
    }
   }
   m.pixels.set(copy);last=next;
  }
 }
 return {maps:output,size,hitCount,missCount,overlapCount,degenerateUV,
  coveredPixels:matched.reduce((sum,x)=>sum+x,0)};
}
