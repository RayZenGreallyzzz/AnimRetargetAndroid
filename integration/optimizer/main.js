import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {describe,simplifyGeometry,getBindCapsules,guardSkinToCapsules} from './mesh-tools.js';
import {readClothProtection} from './cloth-mask.js';
import './style.css';

const $=id=>document.getElementById(id);
const ui=[
'<header><strong>PHOENIX CHARACTER FORGE</strong><small>Оптимизация · Капсулы влияния</small></header>',
'<div id="viewer" class="viewer"></div><aside class="panel">',
'<h3>01 / Геометрия</h3>',
'<label>Загрузить GLB<input id="opt-model-file" type="file" accept=".glb"/></label>',
'<div id="stats">Нет модели</div>',
'<label>Меш<select id="meshes"></select></label>',
'<label>Цель: треугольники<select id="presets"><option value="5000">5 000</option><option value="10000">10 000</option><option value="20000" selected>20 000</option><option value="40000">40 000</option><option value="custom">Своя</option></select></label>',
'<label>Своя цель<input id="target" type="number" value="20000" min="64" max="260000" step="100"/></label>',
'<label class="toggle"><input id="uv" type="checkbox" checked/> Защищать UV и текстуры</label>',
'<label class="toggle"><input id="joint" type="checkbox" checked/> Защищать переходы весов</label>',
'<label class="toggle"><input id="limit-textures" type="checkbox"/> Сжать текстуры до 2048 px при экспорте (снижение качества)</label>',
'<label class="toggle"><input id="wireframe" type="checkbox"/> Показывать сетку поверх модели</label>',
'<div class="buttons"><button id="simplify" class="primary">Предпросмотр удаления вершин</button><button id="undo">Отменить предпросмотр</button></div>',
'<button id="compare" disabled>Сравнить: ДО / ПОСЛЕ</button>',
'<p>Это осторожное объединение вершин, а не полная ретопология Tripo. Morph-меши и сложные материалы пропускаются. Целевой бюджет не гарантирован.</p>',
'<h3>02 / Объёмы костей и одежда</h3>',
'<label>Кость<select id="bones"></select></label>',
'<label>Радиус капсул: <span id="radius-value">1.00</span>×<input id="radius" type="range" min=".4" max="2.8" step=".1" value="1"/></label>',
'<label class="toggle"><input id="capsules" type="checkbox" checked/> Показывать капсулы вокруг костей</label>',
'<label class="toggle"><input id="weightmap" type="checkbox"/> Отмечать вершины с весом выбранной кости</label>',
'<label class="toggle"><input id="reassign" type="checkbox"/> Исправить совсем чужие кости на одежде (осторожно)</label>',
'<div class="buttons"><button id="guard">Предпросмотр защиты весов</button><button id="apply" class="primary">Применить</button></div>',
'<p>Радиусы капсул рассчитываются в BindPose. Если на меше есть маска защиты одежды из Character, отмеченные вершины никогда не меняют веса. Повреждённая маска блокирует коррекцию. Исправление чужих костей выключено по умолчанию.</p>',
'<h3>03 / Результат</h3><div id="status"></div>',
'<div class="buttons"><button id="export" class="primary">Экспорт отдельного GLB</button><button id="reset">Восстановить исходник</button></div>',
'<button id="opt-next-rig" class="primary">✅ Сохранить эту модель → Rig</button>',
'<p>Сохраняются UV, материалы, привязка и клипы. Не перезаписывай исходную модель до проверки результата.</p>',
'</aside>'];
$('app').innerHTML=ui.join('');
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.setClearColor(0x171d2a);renderer.outputColorSpace=THREE.SRGBColorSpace;
$('viewer').append(renderer.domElement);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.01,2000);
camera.position.set(2,1.5,4);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x46556a,2));
const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,6,4);scene.add(light);
const grid=new THREE.GridHelper(8,16,0x3e4858,0x3e4858);scene.add(grid);
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const exporter=new GLTFExporter();
let character=null,animations=[],meshes=[],pending=null,playing=false,mixer=null;
const originals=new Map(),capsuleGroup=new THREE.Group();
let weightDots=null,wireOverlay=null;
scene.add(capsuleGroup);
const msg=s=>{$('status').textContent=s;};
const fmt=n=>Number(n).toLocaleString('ru-RU');
function selected(){return meshes[Number($('meshes').value)]?.node||null;}
function selectedStats(){
  if(!character)return $('stats').textContent='Нет модели';
  const d=describe(character),m=selected();
  const protection=m?readClothProtection(m):null;
  $('stats').textContent='Всего: '+fmt(d.vertices)+' вершин / '+fmt(d.triangles)+' треугольников'+
    '\nМешей: '+d.meshes.length+' · анимаций: '+animations.length+
    (m?'\nВыбран: '+(m.name||'Mesh')+' · '+fmt(Math.floor((m.geometry.index?.count||m.geometry.getAttribute('position').count)/3))+
       ' треугольников · '+(m.isSkinnedMesh?m.skeleton.bones.length+' костей':'без скелета'):'')+
    (protection?.hasMask ? '\nЗащита одежды: '+(protection.reason || fmt(protection.count)+' вершин защищено') : '');
}
function clearWire(){
  if(wireOverlay){
    wireOverlay.parent?.remove(wireOverlay);
    wireOverlay.material.dispose();
    wireOverlay=null;
  }
}
function updateWire(){
  clearWire();
  const mesh=selected();
  if(!$('wireframe').checked||!mesh)return;
  mesh.updateMatrixWorld(true);
  const material=new THREE.MeshBasicMaterial({color:0xffdf9f,wireframe:true,transparent:true,opacity:.35,depthTest:false,depthWrite:false});
  wireOverlay=new THREE.Mesh(mesh.geometry,material);
  wireOverlay.matrixAutoUpdate=false;
  wireOverlay.matrix.copy(mesh.matrixWorld);
  wireOverlay.renderOrder=15;
  scene.add(wireOverlay);
}
function clearCapsules(){
  clearWire();
  for(const m of [...capsuleGroup.children]){m.geometry.dispose();m.material.dispose();}
  capsuleGroup.clear();
  if(weightDots){weightDots.parent?.remove(weightDots);weightDots.geometry.dispose();weightDots.material.dispose();weightDots=null;}
}
function setBindPose(){
  // The GLB can contain an active/warm-started walking clip. A bind-space
  // capsule must be compared with its matching undeformed body, not an
  // animated mesh in a different pose.
  playing=false;
  if(mixer)mixer.stopAllAction();
  if(character){
    character.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.pose();});
    character.updateMatrixWorld(true);
  }
}
function updateCapsules(){
  if($('capsules').checked||$('weightmap').checked)setBindPose();
  clearCapsules();
  const mesh=selected();
  updateWire();
  if(!mesh?.isSkinnedMesh)return;
  mesh.updateMatrixWorld(true);
  const bind=getBindCapsules(mesh,Number($('radius').value));
  const current=Number($('bones').value||0);
  if($('capsules').checked){
    for(const item of bind){
      if(item.length<=.00001)continue;
      const geometry=new THREE.CapsuleGeometry(item.radius,item.length,5,9);
      const material=new THREE.MeshBasicMaterial({
        color:item.index===current?0xffa042:0x65b9eb,
        opacity:item.index===current?.42:.075,transparent:true,
        depthTest:false,depthWrite:false,wireframe:true});
      const capsule=new THREE.Mesh(geometry,material);
      capsule.position.copy(item.start).add(item.end).multiplyScalar(.5);
      capsule.quaternion.setFromUnitVectors(
        new THREE.Vector3(0,1,0),item.end.clone().sub(item.start).normalize());
      capsuleGroup.add(capsule);
    }
    capsuleGroup.matrix.copy(mesh.matrixWorld);
    capsuleGroup.matrixAutoUpdate=false;
  }
  if($('weightmap').checked){
    const g=mesh.geometry,pos=g.getAttribute('position'),j=g.getAttribute('skinIndex'),
      w=g.getAttribute('skinWeight');
    if(pos&&j&&w){
      const vertices=[];
      for(let i=0;i<pos.count;i++){
        let influence=0;
        for(let slot=0;slot<4;slot++)
          if(j.getComponent(i,slot)===current)influence+=w.getComponent(i,slot);
        if(influence>=.08)vertices.push(pos.getX(i),pos.getY(i),pos.getZ(i));
      }
      if(vertices.length){
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
        weightDots=new THREE.Points(geometry,new THREE.PointsMaterial({
          color:0xff8443,size:.008,sizeAttenuation:true,depthTest:false}));
        mesh.add(weightDots);
      }
    }
  }
}
function updateBones(){
  const mesh=selected();$('bones').replaceChildren();
  if(mesh?.isSkinnedMesh){
    mesh.skeleton.bones.forEach((b,i)=>{
      const option=document.createElement('option');option.value=i;
      option.textContent=i+' · '+(b.name||'Bone');$('bones').append(option);
    });
  }
  updateCapsules();
}
function cancelPending(){
  if(!pending)return;
  if(pending.mesh.geometry===pending.geometry)pending.mesh.geometry=pending.before;
  pending.geometry.dispose();pending=null;
  $('compare').disabled=true;
  selectedStats();updateCapsules();
  msg('Предпросмотр отменён, сетка не изменена.');
}
function apply(){
  if(!pending)return msg('Сначала создай предпросмотр.');
  const {mesh,geometry,type,before}=pending;
  if(!originals.has(mesh))originals.set(mesh,before);
  else if(before!==originals.get(mesh))before.dispose();
  mesh.geometry=geometry;pending=null;mesh.geometry.computeBoundingSphere();
  $('compare').disabled=true;
  selectedStats();updateCapsules();
  msg('Изменение '+type+' применено в рабочей копии. Экспортируй GLB отдельно или восстанови оригинал.');
}
function restore(){
  cancelPending();
  for(const [mesh,original] of originals){
    if(mesh.geometry!==original)mesh.geometry.dispose();
    mesh.geometry=original;
  }
  originals.clear();selectedStats();updateCapsules();
  msg('Все изменения отменены. Исходная геометрия восстановлена.');
}
function fit(){
  const b=new THREE.Box3().setFromObject(character),center=b.getCenter(new THREE.Vector3());
  const size=b.getSize(new THREE.Vector3()),h=Math.max(size.x,size.y,size.z,.1);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(h*.9,h*.4,h*1.8));
  camera.near=Math.max(.0001,h*.0001);camera.far=h*200;camera.updateProjectionMatrix();
  grid.position.y=b.min.y-h*.01;
}
function setModel(gltf,name){
  if(character){restore();scene.remove(character);}
  clearCapsules();originals.clear();pending=null;
  character=gltf.scene;scene.add(character);character.updateMatrixWorld(true);
  animations=gltf.animations||[];
  mixer=animations.length?new THREE.AnimationMixer(character):null;
  if(mixer&&!$('capsules').checked&&!$('weightmap').checked){
    mixer.clipAction(animations[0]).play();playing=true;
  }else setBindPose();
  meshes=describe(character).meshes;
  $('meshes').replaceChildren();
  meshes.forEach((m,i)=>{
    const option=document.createElement('option');option.value=i;
    option.textContent=m.name+' · '+fmt(m.triangles)+' △';$('meshes').append(option);
  });
  $('meshes').value=0;updateBones();fit();selectedStats();
  msg('Загружено: '+name+'. Для проверки капсул показана исходная поза скелета (BindPose), анимация остановлена. Сравни с поверхностью перед коррекцией весов.');
}
$('opt-model-file').onchange=async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(file.size>140*1024*1024)return msg('GLB более 140 МБ — слишком тяжёлый для планшета.');
  try{
    msg('Открываю GLB...');
    await MeshoptDecoder.ready;
    const buffer=await file.arrayBuffer();
    loader.parse(buffer,'',gltf=>setModel(gltf,file.name),e=>msg('Ошибка GLB: '+e.message));
  }catch(e){msg('Импорт не удался: '+e.message);}
};
$('meshes').onchange=()=>{cancelPending();updateBones();selectedStats();};
$('presets').onchange=()=>{if($('presets').value!=='custom')$('target').value=$('presets').value;};
$('bones').onchange=updateCapsules;
$('radius').oninput=()=>{$('radius-value').textContent=Number($('radius').value).toFixed(2);updateCapsules();};
$('capsules').onchange=updateCapsules;
$('weightmap').onchange=updateCapsules;
$('wireframe').onchange=updateWire;
$('compare').onclick=()=>{
  if(!pending)return;
  const showingAfter=pending.mesh.geometry===pending.geometry;
  pending.mesh.geometry=showingAfter?pending.before:pending.geometry;
  $('compare').textContent=showingAfter?'Сравнение: ДО (показать ПОСЛЕ)':'Сравнение: ПОСЛЕ (показать ДО)';
  selectedStats();updateCapsules();
};
$('simplify').onclick=async()=>{
  const mesh=selected();if(!mesh)return msg('Сначала загрузи GLB.');
  const cloth=readClothProtection(mesh);
  if(cloth.hasMask)return msg('У этого меша записана маска защиты одежды. Упрощение изменит индексы вершин и уничтожит соответствие маски. Сначала сними маску в Character либо используй отдельную копию GLB.');
  cancelPending();
  const target=Number($('target').value);
  if(!Number.isInteger(target)||target<64)return msg('Задай целевое число треугольников не менее 64.');
  const existing=Math.floor((mesh.geometry.index?.count||mesh.geometry.getAttribute('position').count)/3);
  if(target>=existing)return msg('Меш уже соответствует цели: '+fmt(existing)+' ≤ '+fmt(target)+' треугольников. Уменьшать его не нужно. Если общая модель тяжелее, выбери другой меш.');
  msg('Подбираю безопасный размер кластеров...');
  await new Promise(resolve=>requestAnimationFrame(resolve));
  try{
    const result=simplifyGeometry(mesh.geometry,target,{preserveUV:$('uv').checked,protectSkin:$('joint').checked});
    if(result.reason)return msg(result.reason);
    pending={mesh,geometry:result.geometry,before:mesh.geometry,type:'упрощения'};
    mesh.geometry=result.geometry;
    $('compare').disabled=false;
    $('compare').textContent='Сравнение: ПОСЛЕ (показать ДО)';
    selectedStats();updateCapsules();
    msg('Пробная сетка: '+fmt(result.originalTriangles)+' → '+fmt(result.triangles)+
      ' треугольников, цель '+fmt(target)+'.'+
      ' · отклонение '+(result.targetErrorPercent>0?'+':'')+result.targetErrorPercent+'%; макс. сдвиг вершин '+result.maxMovementPercent+'% диагонали модели.'+
      (Math.abs(result.targetErrorPercent)>15?' ВНИМАНИЕ: точность цели плохая — проверь сетку до применения.':'')+
      ' Исходник не изменён. Нажми «Применить» или «Отменить».');
  }catch(e){msg('Ошибка оптимизации: '+e.message);}
};
$('guard').onclick=()=>{
  const mesh=selected();
  if(!mesh?.isSkinnedMesh)return msg('Выбери отдельный скинненный меш персонажа или одежды.');
  const protection=readClothProtection(mesh);
  if(protection.reason)return msg(protection.reason);
  cancelPending();playing=false;
  setBindPose();
  const result=guardSkinToCapsules(mesh.geometry,getBindCapsules(mesh,Number($('radius').value)),
    {allowReassign:$('reassign').checked,protectedVertices:protection.mask});
  if(result.reason)return msg(result.reason);
  pending={mesh,geometry:result.geometry,before:mesh.geometry,type:'защиты весов'};
  mesh.geometry=result.geometry;
  $('compare').disabled=false;
  $('compare').textContent='Сравнение: ПОСЛЕ (показать ДО)';
  selectedStats();updateCapsules();
  msg('Пробная защита: изменены веса '+fmt(result.changed)+
    ' вершин; потенциально чужие кости: '+fmt(result.outOfCapsule)+
    '; защищено маской: '+fmt(result.protectedCount)+
    '; переназначено: '+fmt(result.reassigned)+
    '; требуют ручной проверки: '+fmt(result.unresolved)+
    '. Хороший риг Meshy исправлять не нужно. Исходник сохранён.');
};
$('apply').onclick=apply;
$('undo').onclick=cancelPending;
$('reset').onclick=restore;
async function commitOptimizedToRig(){
 if(!character){msg('Сначала загрузи модель GLB.');return false}
 if(pending){msg('Сначала нажми «Применить» либо «Отменить предпросмотр».');return false}
 if(!window.PhoenixSuite?.saveBlob){msg('Общее хранилище доступно только в Android Forge.');return false}
 try{
  playing=false;
  msg('Сохраняю текущую модель, скелет, текстуры и анимации для Rig...');
  const options={binary:true,trs:true,animations,onlyVisible:false};
  if($('limit-textures').checked)options.maxTextureSize=2048;
  const output=await exporter.parseAsync(character,options);
  if(!(output instanceof ArrayBuffer))throw Error('GLB не сформирован.');
  const saved=await window.PhoenixSuite.saveBlob(new Blob([output],{type:'model/gltf-binary'}),'Forge_Optimize_To_Rig.glb');
  if(!saved)throw Error('Не удалось передать GLB');
  msg('GLB сохранён в общие файлы. Открываю Rig с этим персонажем.');
  window.PhoenixNative?.openTool('rig');
  return true;
 }catch(error){
  msg('Передача в Rig отменена: '+error.message);
  return false;
 }
}
window.PhoenixOptimizeCommit=commitOptimizedToRig;
$('opt-next-rig').onclick=commitOptimizedToRig;
$('export').onclick=async()=>{
  if(!character)return msg('Нет модели для экспорта.');
  if(pending)return msg('Сначала нажми «Применить» либо «Отменить предпросмотр».');
  try{
    playing=false;msg('Сохраняю GLB...');
    const options={binary:true,trs:true,animations,onlyVisible:false};
    if($('limit-textures').checked)options.maxTextureSize=2048;
    const output=await exporter.parseAsync(character,options);
    if(!(output instanceof ArrayBuffer))throw Error('GLB не сформирован.');
    const url=URL.createObjectURL(new Blob([output],{type:'model/gltf-binary'}));
    const a=document.createElement('a');a.href=url;a.download='PhoenixCharacterForge_Optimized.glb';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    msg('Экспорт: '+(output.byteLength/1048576).toFixed(2)+' МБ. В APK проверь вкладку «Общие GLB».');
  }catch(e){msg('Ошибка экспорта: '+e.message);}
};
function resize(){
  const w=Math.max($('viewer').clientWidth,1),h=Math.max($('viewer').clientHeight,1);
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($('viewer'));resize();
const clock=new THREE.Clock();
function render(){
  requestAnimationFrame(render);
  const dt=Math.min(.05,clock.getDelta());
  if(document.visibilityState==='hidden')return;
  if(playing&&mixer&&!$('capsules').checked&&!$('weightmap').checked)mixer.update(dt);
  controls.update();renderer.render(scene,camera);
}
window.addEventListener('phoenix:activated',resize);
render();