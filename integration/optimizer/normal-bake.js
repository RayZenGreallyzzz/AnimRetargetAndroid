import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';

/**
 * Offline high-poly to low-poly tangent-space normal bake.
 * Input geometries share one mesh local coordinate system and UV/material.
 * The map captures high-poly normals; it does not recreate hidden geometry
 * or reproject albedo. No changes to source or destination mesh are made.
 */
export function bakeNormalPixels(high,low,{size=256,repeat=[1,1],offset=[0,0],maxRayRatio=.035}={}){
 if(!Number.isInteger(size)||size<32||size>1024)throw Error('Размер карты должен быть 32–1024 px.');
 const hp=high?.getAttribute('position'),lp=low?.getAttribute('position'),uv=low?.getAttribute('uv');
 if(!hp||!lp||!uv)throw Error('Нужны исходная и облегчённая геометрия с UV.');
 if((high.index?.count||hp.count)%3||(low.index?.count||lp.count)%3)
  throw Error('Некорректный буфер треугольников.');
 if((high.index?.count||hp.count)/3>1300000)
  throw Error('Слишком много граней для одного запекания на планшете. Нужна обработка по частям.');
 const [ru,rv]=repeat,[ou,ov]=offset;
 if(![ru,rv,ou,ov].every(Number.isFinite)||ru<=0||rv<=0)
  throw Error('Неподдерживаемые параметры UV-текстуры.');
 const textureU=i=>uv.getX(i)*ru+ou,textureV=i=>uv.getY(i)*rv+ov;
 const color=new Uint8ClampedArray(size*size*4);
 // Default tangent normal (0,0,1) for empty pixels.
 for(let k=0;k<color.length;k+=4){color[k]=128;color[k+1]=128;color[k+2]=255;color[k+3]=255}
 const occupied=new Uint8Array(size*size),pixelsCovered=new Uint8Array(size*size);
 high.computeBoundingBox();
 const bounds=high.boundingBox.getSize(new THREE.Vector3());
 const diag=Math.max(1e-7,bounds.length()),maxDist=diag*Math.max(.001,Math.min(.15,maxRayRatio));
 const bvh=new MeshBVH(high,{maxLeafSize:12,verbose:false});
 const hn=high.getAttribute('normal'),ln=low.getAttribute('normal');
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),
   ab=new THREE.Vector3(),ac=new THREE.Vector3(),n=new THREE.Vector3(),
   surf=new THREE.Vector3(),lowNormal=new THREE.Vector3(),highNormal=new THREE.Vector3(),
   tangent=new THREE.Vector3(),bitangent=new THREE.Vector3(),scratch=new THREE.Vector3(),
   ray=new THREE.Ray(),seed=new THREE.Vector3(),pA=new THREE.Vector3(),
   pB=new THREE.Vector3(),pC=new THREE.Vector3(),bc=new THREE.Vector3();
 const triangles=low.index?.count||lp.count;
 const hiIdx=high.index;
 let hitCount=0,missCount=0,degenerateUV=0,unmapped=0;
 function sampleNormal(faceIndex,point,out){
  const ia=hiIdx?hiIdx.getX(faceIndex*3):faceIndex*3,
    ib=hiIdx?hiIdx.getX(faceIndex*3+1):faceIndex*3+1,
    ic=hiIdx?hiIdx.getX(faceIndex*3+2):faceIndex*3+2;
  pA.fromBufferAttribute(hp,ia);pB.fromBufferAttribute(hp,ib);pC.fromBufferAttribute(hp,ic);
  if(!hn)return out.subVectors(pB,pA).cross(scratch.subVectors(pC,pA)).normalize();
  THREE.Triangle.getBarycoord(point,pA,pB,pC,bc);
  if(!Number.isFinite(bc.x))return out.subVectors(pB,pA).cross(scratch.subVectors(pC,pA)).normalize();
  return out.set(
   hn.getX(ia)*bc.x+hn.getX(ib)*bc.y+hn.getX(ic)*bc.z,
   hn.getY(ia)*bc.x+hn.getY(ib)*bc.y+hn.getY(ic)*bc.z,
   hn.getZ(ia)*bc.x+hn.getZ(ib)*bc.y+hn.getZ(ic)*bc.z
  ).normalize();
 }
 for(let t=0;t<triangles;t+=3){
  const i0=low.index?low.index.getX(t):t,
    i1=low.index?low.index.getX(t+1):t+1,
    i2=low.index?low.index.getX(t+2):t+2;
  a.fromBufferAttribute(lp,i0);b.fromBufferAttribute(lp,i1);c.fromBufferAttribute(lp,i2);
  const u0=textureU(i0),v0=textureV(i0),
    u1=textureU(i1),v1=textureV(i1),u2=textureU(i2),v2=textureV(i2);
  if(![u0,v0,u1,v1,u2,v2].every(Number.isFinite))throw Error('Нечисловая UV-развёртка.');
  // Do not silently clip a wrapping/rotated texture atlas.
  const minUV=Math.min(u0,v0,u1,v1,u2,v2),maxUV=Math.max(u0,v0,u1,v1,u2,v2);
  if(minUV<-.0001||maxUV>1.0001)
   throw Error('UV выходят за 0–1 после масштабирования текстуры. Для повторяющегося атласа сначала нужна нормализация/перепаковка UV.');
  const dx1=u1-u0,dy1=v1-v0,dx2=u2-u0,dy2=v2-v0,det=dx1*dy2-dx2*dy1;
  if(Math.abs(det)<1e-12){degenerateUV++;continue}
  ab.subVectors(b,a);ac.subVectors(c,a);
  n.crossVectors(ab,ac).normalize();
  tangent.copy(ab).multiplyScalar(dy2).addScaledVector(ac,-dy1).multiplyScalar(1/det);
  tangent.addScaledVector(n,-n.dot(tangent)).normalize();
  const sign=det<0?-1:1;
  if(tangent.lengthSq()<.5){degenerateUV++;continue}
  bitangent.crossVectors(n,tangent).multiplyScalar(sign);
  // Raster coords refer to glTF/Canvas top-left with flipY=false.
  const x0=u0*size,y0=v0*size,x1=u1*size,y1=v1*size,x2=u2*size,y2=v2*size;
  const minX=Math.max(0,Math.floor(Math.min(x0,x1,x2))-1),
    maxX=Math.min(size-1,Math.ceil(Math.max(x0,x1,x2))+1),
    minY=Math.max(0,Math.floor(Math.min(y0,y1,y2))-1),
    maxY=Math.min(size-1,Math.ceil(Math.max(y0,y1,y2))+1);
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   const px=(x+.5)/size,py=(y+.5)/size;
   const w1=((px-u0)*(v2-v0)-(py-v0)*(u2-u0))/det,
     w2=((py-v0)*(u1-u0)-(px-u0)*(v1-v0))/det,w0=1-w1-w2;
   if(w0<-.00001||w1<-.00001||w2<-.00001)continue;
   const slot=y*size+x;
   if(occupied[slot])continue;
   occupied[slot]=1;
   surf.copy(a).multiplyScalar(w0).addScaledVector(b,w1).addScaledVector(c,w2);
   if(ln){
    lowNormal.set(
     ln.getX(i0)*w0+ln.getX(i1)*w1+ln.getX(i2)*w2,
     ln.getY(i0)*w0+ln.getY(i1)*w1+ln.getY(i2)*w2,
     ln.getZ(i0)*w0+ln.getZ(i1)*w1+ln.getZ(i2)*w2
    ).normalize();
   }else lowNormal.copy(n);
   // Tangent frame must be orthonormal with interpolated shading normal.
   tangent.addScaledVector(lowNormal,-lowNormal.dot(tangent)).normalize();
   bitangent.crossVectors(lowNormal,tangent).multiplyScalar(sign).normalize();
   let hit=null;
   seed.copy(surf).addScaledVector(lowNormal,maxDist);
   ray.set(seed,lowNormal.clone().negate());
   hit=bvh.raycastFirst(ray,THREE.DoubleSide,0,maxDist*2);
   if(!hit){
    seed.copy(surf).addScaledVector(lowNormal,-maxDist);
    ray.set(seed,lowNormal);
    hit=bvh.raycastFirst(ray,THREE.DoubleSide,0,maxDist*2);
   }
   // Keep neutral normal if no trustworthy high-poly surface matched.
   if(!hit){missCount++;continue}
   hitCount++;
   sampleNormal(hit.faceIndex,hit.point,highNormal);
   if(highNormal.dot(lowNormal)<0)highNormal.negate(); // double-sided meshes
   const xT=highNormal.dot(tangent),yT=highNormal.dot(bitangent),zT=highNormal.dot(lowNormal);
   const norm=Math.hypot(xT,yT,zT)||1,ofs=slot*4;
   color[ofs]=Math.round(127.5+127.5*xT/norm);
   color[ofs+1]=Math.round(127.5+127.5*yT/norm);
   color[ofs+2]=Math.round(127.5+127.5*zT/norm);
   pixelsCovered[slot]=1;
  }
 }
 // Extend colours beyond island silhouettes to avoid edge bleed on mipmaps.
 // Only fill empty texels, never smear a pixel from one UV island over another.
 for(let pass=0;pass<3;pass++){
  const next=color.slice(),valid=pixelsCovered.slice();
  for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
   const id=y*size+x;if(pixelsCovered[id])continue;
   const neighbours=[id-1,id+1,id-size,id+size];
   for(const j of neighbours){if(!pixelsCovered[j])continue;
    next.set(color.subarray(j*4,j*4+4),id*4);valid[id]=1;break;
   }
  }
  color.set(next);pixelsCovered.set(valid);
 }
 return {pixels:color,size,hitCount,missCount,degenerateUV,pixelsFilled:pixelsCovered.reduce((sum,v)=>sum+v,0)};
}
