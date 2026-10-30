const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {adjust}=require('../web/phoenix-woman-rig-transform.js');
const dirname=process.env.PHOENIX_RIG_DIR;
if(!dirname)throw Error('Set PHOENIX_RIG_DIR to generated Woman rig folder');
const bytes=fs.readFileSync(dirname+'/rig-woman-1000.glb');
function parse(bytes){
 const raw=Buffer.from(bytes),jlen=raw.readUInt32LE(12),j=JSON.parse(raw.subarray(20,20+jlen).toString('utf8'));
 const boff=20+jlen+8,blen=raw.readUInt32LE(20+jlen);
 return {j,binary:raw.subarray(boff,boff+blen)};
}
function mul(a,b){const o=[];for(let c=0;c<4;c++)for(let r=0;r<4;r++){let x=0;for(let k=0;k<4;k++)x+=a[k*4+r]*b[c*4+k];o[c*4+r]=x}return o}
function local(n){
 if(n.matrix)return n.matrix;
 const [x,y,z,w]=n.rotation||[0,0,0,1],[sx,sy,sz]=n.scale||[1,1,1],[tx,ty,tz]=n.translation||[0,0,0];
 return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0,
 2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0,
 2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0,tx,ty,tz,1];
}
function world(j,name){
 const ids=new Map(j.nodes.map((n,i)=>[n.name,i]));
 const parent=new Map();
 j.nodes.forEach((n,i)=>(n.children||[]).forEach(child=>parent.set(child,i)));
 const cache=new Map();
 function get(i){
  if(cache.has(i))return cache.get(i);
  const m=parent.has(i)?mul(get(parent.get(i)),local(j.nodes[i])):local(j.nodes[i]);
  cache.set(i,m);return m;
 }
 return get(ids.get(name));
}
const xyz=m=>m.slice(12,15);
const diff=(a,b)=>a.map((n,i)=>n-b[i]);
function ibm(j,bin,name){
 const skin=j.skins[0],node=j.nodes.findIndex(n=>n.name===name),joint=skin.joints.indexOf(node);
 assert.ok(joint>=0,'not included in skin joints: '+name);
 const accessor=j.accessors[skin.inverseBindMatrices],view=j.bufferViews[accessor.bufferView];
 const offset=(view.byteOffset||0)+(accessor.byteOffset||0)+joint*64;
 return Array.from({length:16},(_,i)=>bin.readFloatLE(offset+i*4));
}
test('Woman real bone heights and spacing shift symmetrically; bind matrices follow each move',()=>{
 const base=parse(bytes);
 const moved=parse(adjust(bytes,{height:-.045,depth:.025,width:.035}));
 assert.equal(moved.j.skins[0].joints.length,base.j.skins[0].joints.length);
 for(const n of ['breast_l','breast_r','breast_tip_l','breast_tip_r']){
  const delta=diff(xyz(world(moved.j,n)),xyz(world(base.j,n)));
  assert.ok(Math.hypot(...delta)>.02,'position moves: '+n);
  const product=mul(world(moved.j,n),ibm(moved.j,moved.binary,n));
  for(let i=0;i<16;i++)assert.ok(Math.abs(product[i]-(i%5===0?1:0))<.00015,'IBM inverse of moved world for '+n+' idx '+i);
 }
 const l=diff(xyz(world(moved.j,'breast_l')),xyz(world(base.j,'breast_l')));
 const r=diff(xyz(world(moved.j,'breast_r')),xyz(world(base.j,'breast_r')));
 assert.ok(Math.hypot(...diff(l,r))>.04,'symmetric spread');
 assert.equal(moved.j.extras.phoenixWomanChestOffsets.height,-.045);
});
test('normal Woman rigs without extra breasts pass through without edits',()=>{
 const b=fs.readFileSync(dirname+'/rig-woman-0000.glb');
 const result=adjust(b,{height:.05});
 assert.deepEqual(Buffer.from(result),b);
});

test('Woman Rig 7.6 browser fetch hook serves adjusted GLB (not just a changed slider label)',async()=>{
 const {runInNewContext}=require('node:vm');
 const controller=fs.readFileSync(__dirname+'/../web/phoenix-woman-ui.js','utf8');
 const appWindow={
  PhoenixWomanRigTransform:{adjust},
  localStorage:{getItem:()=>JSON.stringify({height:-.065,depth:.025,width:.02})},
  fetch:async()=>new Response(bytes,{status:200,headers:{'content-type':'model/gltf-binary'}})
 };
 runInNewContext(controller,{
  window:appWindow,
  document:{readyState:'loading',addEventListener(){}},
  Response,Headers,console,JSON,Math,Number
 },{filename:'phoenix-woman-ui.js'});
 const response=await appWindow.fetch('https://appassets.androidplatform.net/assets/studio/rig/rigs/rig-woman-1000.glb?phoenixChest=0');
 assert.equal(response.status,200);
 const altered=parse(await response.arrayBuffer());
 const base=parse(bytes);
 const before=xyz(world(base.j,'breast_l')),after=xyz(world(altered.j,'breast_l'));
 assert.ok(Math.hypot(...diff(after,before))>.04,'woman GLB bone really shifted in intercepted loader');
 const ordinary=await appWindow.fetch('https://appassets.androidplatform.net/assets/studio/rig/animations/other.glb');
 assert.equal(ordinary.status,200);
});
