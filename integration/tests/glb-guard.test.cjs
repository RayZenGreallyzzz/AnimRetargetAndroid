const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspectActive,requireCharacterReady}=require('../web/glb-guard.js');

function glb(json){
 const text=Buffer.from(JSON.stringify(json),'utf8');
 const padded=Buffer.alloc(Math.ceil(text.length/4)*4,0x20);
 text.copy(padded);
 const buf=Buffer.alloc(20+padded.length);
 buf.writeUInt32LE(0x46546c67,0);
 buf.writeUInt32LE(2,4);
 buf.writeUInt32LE(buf.length,8);
 buf.writeUInt32LE(padded.length,12);
 buf.writeUInt32LE(0x4e4f534a,16);
 padded.copy(buf,20);
 return buf;
}
const base={
 asset:{version:'2.0'},
 meshes:[{primitives:[{attributes:{POSITION:0,JOINTS_0:1,WEIGHTS_0:2},indices:3}]}],
 nodes:[{mesh:0,skin:0},{name:'root_joint'}],
 skins:[{joints:[1]}],
 scenes:[{nodes:[0]}],scene:0
};
function nativeBuffer(buf){
 let reads=0,bytes=0;
 return {
  readFileChunk(name,offset,length){
   reads++;bytes+=length;
   if(name!=='model.glb')return '';
   return buf.subarray(offset,offset+length).toString('base64');
  },
  get reads(){return reads},
  get bytes(){return bytes}
 };
}
const active=buf=>({name:'model.glb',size:buf.length,revision:7});

test('valid rigged GLB is accepted and only reads header+JSON',async()=>{
 const json={...base,animations:[{name:'walk'}]};
 const buf=glb(json),native=nativeBuffer(buf);
 const result=await requireCharacterReady(native,active(buf));
 assert.equal(result.hasRig,true);
 assert.equal(result.skinnedMeshes,1);
 assert.equal(result.animations,1);
 assert.equal(native.bytes,buf.length);
});
test('unrigged GLB is rejected even if geometry is present',async()=>{
 const json={...base,nodes:[{mesh:0},{name:'root_joint'}]};
 const buf=glb(json);
 const result=await inspectActive(nativeBuffer(buf),active(buf));
 assert.equal(result.hasMesh,true);assert.equal(result.hasRig,false);
 await assert.rejects(requireCharacterReady(nativeBuffer(buf),active(buf)),/скелет и веса/);
});
test('skeleton-only GLB is rejected before Character navigation',async()=>{
 const json={...base,meshes:[],nodes:[{name:'root_joint'}]};
 const buf=glb(json);
 await assert.rejects(requireCharacterReady(nativeBuffer(buf),active(buf)),/не содержит 3D-модель/);
});
test('skin plus mesh is not enough without JOINTS and WEIGHTS',async()=>{
 const json={...base,meshes:[{primitives:[{attributes:{POSITION:0}}]}]};
 const buf=glb(json);
 await assert.rejects(requireCharacterReady(nativeBuffer(buf),active(buf)),/скелет и веса/);
});
test('truncated or fake GLB is rejected before marking transfer ready',async()=>{
 const buf=Buffer.from('glTF-test-content');
 await assert.rejects(inspectActive(nativeBuffer(buf),active(buf)),/корректным GLB/);
 const good=glb(base);good.writeUInt32LE(good.length+5,8);
 await assert.rejects(inspectActive(nativeBuffer(good),active(good)),/неполностью/);
});
test('broken JSON cannot pass rig handoff',async()=>{
 const good=glb(base);good.fill(0x7e,20);
 await assert.rejects(inspectActive(nativeBuffer(good),active(good)),/JSON/);
});
test('bounded streaming reads only metadata, not a 90 MB geometry payload',async()=>{
 const buf=glb(base),huge=Buffer.alloc(buf.length+90*1024*1024);
 buf.copy(huge);huge.writeUInt32LE(huge.length,8);
 const native=nativeBuffer(huge);
 const result=await requireCharacterReady(native,active(huge));
 assert.equal(result.hasRig,true);
 assert.ok(native.bytes<1024*1024);
});
