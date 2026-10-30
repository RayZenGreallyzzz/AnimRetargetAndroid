/* Pure GLB Woman breast-bone rest-pose adjustment.
 * Generates adjusted GLB bytes in the browser, including matching inverse
 * bind matrices, without changing or unzipping the original Rig v7.6 bundle.
 */
(function(scope){
  'use strict';
  const str=new TextDecoder(),enc=new TextEncoder(),P=new DataView(new ArrayBuffer(8));
  function vec(x,y,z){return [x,y,z]}
  const sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b)=>a.map((x,i)=>x+b[i]);
  const scale=(a,v)=>a.map(x=>x*v);
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const norm=a=>{const d=Math.sqrt(dot(a,a));if(d<1e-8)throw Error('Invalid skeleton axis');return scale(a,1/d)};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function mul(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];o[c*4+r]=v}return o}
  function inverse(m){
    const rows=Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>m[c*4+r]).concat(Array.from({length:4},(_,c)=>c===r?1:0)));
    for(let i=0;i<4;i++){
      let at=i;for(let r=i+1;r<4;r++)if(Math.abs(rows[r][i])>Math.abs(rows[at][i]))at=r;
      if(Math.abs(rows[at][i])<1e-10)throw Error('Singular inverse bind');
      [rows[i],rows[at]]=[rows[at],rows[i]];
      const d=rows[i][i];for(let c=0;c<8;c++)rows[i][c]/=d;
      for(let r=0;r<4;r++)if(r!==i){const k=rows[r][i];for(let c=0;c<8;c++)rows[r][c]-=rows[i][c]*k}
    }
    return Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]);
  }
  function local(n){
    if(n.matrix)return n.matrix.slice();
    const [x,y,z,w]=n.rotation||[0,0,0,1], [sx,sy,sz]=n.scale||[1,1,1], [tx,ty,tz]=n.translation||[0,0,0];
    return [
      (1-2*(y*y+z*z))*sx,(2*(x*y+z*w))*sx,(2*(x*z-y*w))*sx,0,
      (2*(x*y-z*w))*sy,(1-2*(x*x+z*z))*sy,(2*(y*z+x*w))*sy,0,
      (2*(x*z+y*w))*sz,(2*(y*z-x*w))*sz,(1-2*(x*x+y*y))*sz,0,
      tx,ty,tz,1
    ];
  }
  function at(m,v){return [
    m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],
    m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],
    m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]
  ]}
  function parse(bytes){
    const raw=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    const d=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
    if(raw.length<28||d.getUint32(0,true)!==0x46546c67||d.getUint32(4,true)!==2||d.getUint32(8,true)!==raw.length)throw Error('Not GLB 2');
    let offset=12,json=null,bin=null;
    while(offset+8<=raw.length){
      const length=d.getUint32(offset,true),kind=d.getUint32(offset+4,true);
      offset+=8;
      if(offset+length>raw.length)throw Error('Bad GLB chunk length');
      const part=raw.slice(offset,offset+length);offset+=length;
      if(kind===0x4e4f534a)json=JSON.parse(str.decode(part));
      if(kind===0x004e4942)bin=part;
    }
    if(!json||!bin)throw Error('Missing GLB JSON or BIN');
    return {json,bin};
  }
  function repack(json,bin){
    const jsonBytes=enc.encode(JSON.stringify(json));
    const n=(jsonBytes.length+3)&~3,b=(bin.length+3)&~3;
    const output=new Uint8Array(12+8+n+8+b);
    const d=new DataView(output.buffer);
    d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,output.length,true);
    d.setUint32(12,n,true);d.setUint32(16,0x4e4f534a,true);
    output.fill(32,20,20+n);output.set(jsonBytes,20);
    d.setUint32(20+n,b,true);d.setUint32(24+n,0x004e4942,true);output.set(bin,28+n);
    json.buffers[0].byteLength=bin.length; // no modification of original glTF buffers
    return output.buffer;
  }
  function adjust(bytes,offsets={}){
    const {json,bin}=parse(bytes),nodes=json.nodes||[],skin=json.skins?.[0];
    if(!skin||!nodes.some(n=>n.name==='breast_l'))return bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const ids=new Map(nodes.map((n,i)=>[n.name,i]));
    for(const name of ['breast_l','breast_r','pelvis','head','upperarm_l','upperarm_r'])
      if(!ids.has(name))throw Error('Woman bone missing '+name);
    const parents=new Map();
    nodes.forEach((n,i)=>(n.children||[]).forEach(j=>parents.set(j,i)));
    let cache=new Map();
    const world=i=>{
      if(cache.has(i))return cache.get(i);
      const m=parents.has(i)?mul(world(parents.get(i)),local(nodes[i])):local(nodes[i]);
      cache.set(i,m);return m;
    };
    const pos=n=>{const m=world(ids.get(n));return [m[12],m[13],m[14]]};
    const left=norm(sub(pos('upperarm_l'),pos('upperarm_r')));
    const up=norm(sub(pos('head'),pos('pelvis')));
    const front=norm(cross(scale(left,-1),up));
    const height=Math.max(-.13,Math.min(.13,Number(offsets.height)||0));
    const depth=Math.max(-.13,Math.min(.13,Number(offsets.depth)||0));
    const width=Math.max(-.09,Math.min(.09,Number(offsets.width)||0));
    for(const [side,sign] of [['l',1],['r',-1]]){
      const id=ids.get('breast_'+side),parent=parents.get(id);
      if(parent===undefined)throw Error('Detached Woman breast bone');
      const node=nodes[id],p=pos('breast_'+side);
      const delta=add(add(scale(up,height),scale(front,depth)),scale(left,width*sign));
      const inv=inverse(world(parent));
      const newLocal=at(inv,add(p,delta)),prevLocal=at(inv,p);
      const original=node.translation||[0,0,0];
      node.translation=original.map((v,i)=>v+newLocal[i]-prevLocal[i]);
    }
    cache=new Map(); // recompute moved children
    const accessor=json.accessors[skin.inverseBindMatrices],view=json.bufferViews[accessor.bufferView];
    if(accessor.type!=='MAT4'||accessor.componentType!==5126||view.byteStride)throw Error('Unsupported Woman bind accessor');
    const start=(view.byteOffset||0)+(accessor.byteOffset||0),d=new DataView(bin.buffer,bin.byteOffset,bin.byteLength);
    for(const bone of ['breast_l','breast_tip_l','breast_r','breast_tip_r']){
      const nodeId=ids.get(bone);if(nodeId===undefined)throw Error('Missing bone '+bone);
      const index=skin.joints.indexOf(nodeId);if(index<0)throw Error('Missing joint '+bone);
      const inv=inverse(world(nodeId));
      if(start+index*64+64>bin.length)throw Error('Invalid bind buffer offset');
      for(let j=0;j<16;j++)d.setFloat32(start+index*64+j*4,inv[j],true);
    }
    json.extras??={};
    json.extras.phoenixWomanChestOffsets={height,depth,width};
    return repack(json,bin);
  }
  const api={adjust};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  scope.PhoenixWomanRigTransform=api;
})(typeof window!=='undefined'?window:globalThis);
