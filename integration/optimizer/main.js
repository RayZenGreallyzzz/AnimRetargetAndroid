import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {describe,simplifyGeometry,getBindCapsules,guardSkinToCapsules} from './mesh-tools.js';
import {readClothProtection} from './cloth-mask.js';
import {paintDetailSphere,countLocked} from './detail-locks.js';
import {optimizeInBackground} from './optimizer-background.js';
import {setupNormalBaker} from './normal-bake-ui.js';
import {setupPbrBaker} from './pbr-bake-ui.js';
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
'<label>Своя цель<input id="target" type="number" value="20000" min="64" step="100"/></label>',
'<label>Способ упрощения<select id="method"><option value="qem">QEM — качественное упрощение (рекомендуется)</option><option value="cluster">Кластеризация — экспериментальная</option></select></label>',
'<label>Точность QEM<select id="qem-quality"><option value="0.01">Максимальная защита формы</option><option value="0.025" selected>Сбалансированная</option><option value="0.075">Более сильное упрощение</option></select></label>',
'<label class="toggle"><input id="qem-attributes" type="checkbox" checked/> Учитывать UV атлас и нормали при выборе граней</label>',
'<h4>🛡️ Защитить лицо, волосы и мелкие детали</h4>',
'<p>Включи кисть и коснись лица, волос, ремней или украшений. Выбранные вершины не удаляются при QEM. Сфера захватывает соседние слои.</p>',
'<label>Радиус защиты: <span id="detail-radius-value">4%</span> высоты меша<input id="detail-radius" type="range" min=".005" max=".20" step=".005" value=".04"/></label>',
'<label>Действие<select id="detail-mode"><option value="protect">Защитить вершины</option><option value="erase">Стереть защиту</option></select></label>',
'<div class="buttons"><button id="detail-brush">🖌 Включить защиту</button><button id="detail-clear">Сбросить защиту</button></div>',
'<p id="detail-status">Защищено 0 вершин. Маска работает только для текущего шага оптимизации.</p>',
'<p>Цель действует на выбранный меш, не на весь GLB. Волосы, одежда и тело могут быть разными мешами. Общее число треугольников смотри в статистике.</p>',
'<label class="toggle"><input id="uv" type="checkbox" checked/> Защищать UV и текстуры</label>',
'<label class="toggle"><input id="joint" type="checkbox" checked/> Защищать переходы весов</label>',
'<label class="toggle"><input id="limit-textures" type="checkbox"/> Сжать текстуры до 2048 px при экспорте (снижение качества)</label>',
'<label class="toggle"><input id="wireframe" type="checkbox"/> Показывать сетку поверх модели</label>',
'<div class="buttons"><button id="simplify" class="primary">Предпросмотр удаления вершин</button><button id="undo">Отменить предпросмотр</button></div>',
'<button id="compare" disabled>Сравнить: ДО / ПОСЛЕ</button>',
'<p>Проверка UV учитывает размер текстуры и KHR_texture_transform. Цель 20 000 для сложного атласа может быть недостижима без перепекания текстур. Это кластеризация, а не полноценная ретопология Tripo.</p>',
'<h3>02 / Запекание normal map (с тяжёлой модели на лёгкую)</h3>',
'<p>После QEM-предпросмотра перенеси рельеф тяжёлой сетки в normal map. Работает офлайн, оригинальный GLB не меняется. Это не запекание цвета.</p>',
'<label>Разрешение карты<select id="bake-size"><option value="128">128 px — быстро</option><option value="256" selected>256 px</option><option value="512">512 px — детальнее</option></select></label>',
'<label>Глубина поиска поверхности<select id="bake-depth"><option value=".012">1,2% диагонали</option><option value=".035" selected>3,5% диагонали</option><option value=".08">8% диагонали</option></select></label>',
'<label class="toggle"><input id="bake-overwrite" type="checkbox"/> Заменить существующую normal map (исходная останется в оригинале)</label>',
'<div class="buttons"><button id="bake-normal" class="primary">🧩 Запечь normal map</button><button id="bake-download" disabled>PNG карты</button></div>',
'<p id="bake-status">Нужны исходный и облегчённый меш с UV. Начни с 256 px.</p>',
'<h3>03 / Перенос PBR-карт — экспериментально</h3>',
'<p>QEM уже сохраняет оригинальные UV и PBR-карты, поэтому обычной модели перепекание НЕ требуется. Включай перенос только для сравнения. Поддерживается один материал и UV0, а не автоматическая перепаковка атласов.</p>',
'<label class="toggle"><input id="pbr-replace" type="checkbox"/> Создать новые PBR-карты (не перезаписывает исходный GLB)</label>',
'<label class="toggle"><input id="pbr-color" type="checkbox" checked/> Цвет и прозрачность</label>',
'<label class="toggle"><input id="pbr-metal" type="checkbox" checked/> Металличность и шероховатость</label>',
'<label class="toggle"><input id="pbr-ao" type="checkbox" checked/> Ambient Occlusion (AO)</label>',
'<label class="toggle"><input id="pbr-emissive" type="checkbox" checked/> Свечение (Emissive)</label>',
'<label>Размер новых PBR-карт<select id="pbr-size"><option value="128">128 px — пробный</option><option value="256" selected>256 px</option><option value="512">512 px — детальнее</option></select></label>',
'<button id="pbr-bake" class="primary">🎨 Перенести PBR-карты</button>',
'<button id="pbr-reset">Вернуть исходные PBR-текстуры</button>',
'<label>Скачать отдельную карту<select id="pbr-save-which"></select></label>',
'<button id="pbr-download" disabled>Сохранить PNG карты</button>',
'<p id="pbr-status">Сначала оптимизируй меш. Исходные текстуры останутся без изменений.</p>',
'<h3>04 / Объёмы костей и одежда</h3>',
'<label>Кость<select id="bones"></select></label>',
'<label>Радиус капсул: <span id="radius-value">1.00</span>×<input id="radius" type="range" min=".4" max="2.8" step=".1" value="1"/></label>',
'<label class="toggle"><input id="capsules" type="checkbox" checked/> Показывать капсулы вокруг костей</label>',
'<label class="toggle"><input id="weightmap" type="checkbox"/> Отмечать вершины с весом выбранной кости</label>',
'<label class="toggle"><input id="reassign" type="checkbox"/> Исправить совсем чужие кости на одежде (осторожно)</label>',
'<div class="buttons"><button id="guard">Предпросмотр защиты весов</button><button id="apply" class="primary">Применить</button></div>',
'<p>Радиусы капсул рассчитываются в BindPose. Если на меше есть маска защиты одежды из Character, отмеченные вершины никогда не меняют веса. Повреждённая маска блокирует коррекцию. Исправление чужих костей выключено по умолчанию.</p>',
'<h3>05 / Результат</h3><div id="status"></div>',
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
let activeOptimization=null;
const originals=new Map(),capsuleGroup=new THREE.Group();
let weightDots=null,wireOverlay=null;
const detailMasks=new WeakMap();let detailPainting=false,detailOverlay=null;
scene.add(capsuleGroup);
const msg=s=>{$('status').textContent=s;};
const fmt=n=>Number(n).toLocaleString('ru-RU');
function selected(){return meshes[Number($('meshes').value)]?.node||null;}
const detailRaycaster=new THREE.Raycaster(),detailPointer=new THREE.Vector2();
function currentDetailMask(mesh=selected()){
 if(!mesh)return null;
 let mask=detailMasks.get(mesh);
 const size=mesh.geometry.getAttribute('position')?.count||0;
 if(!mask||mask.length!==size){mask=new Uint8Array(size);detailMasks.set(mesh,mask);}
 return mask;
}
function clearDetailOverlay(){
 if(!detailOverlay)return;
 detailOverlay.parent?.remove(detailOverlay);
 detailOverlay.geometry.dispose();detailOverlay.material.dispose();detailOverlay=null;
}
function updateDetailOverlay(){
 clearDetailOverlay();
 const mesh=selected();if(!mesh)return;
 const mask=currentDetailMask(mesh),total=countLocked(mask);
 $('detail-status').textContent='Защищено '+fmt(total)+' из '+fmt(mask.length)+
  ' вершин. Защита применяется к следующему QEM; после применения сетки её нужно нарисовать заново.';
 if(!total)return;
 const p=mesh.geometry.getAttribute('position'),verts=[],tmp=new THREE.Vector3();
 mesh.updateMatrixWorld(true);
 const step=Math.max(1,Math.ceil(total/3500));let used=0;
 for(let i=0;i<mask.length;i++){
  if(!mask[i]||used++%step)continue;
  tmp.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
  verts.push(tmp.x,tmp.y,tmp.z);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
 const worldSize=new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).length();
 detailOverlay=new THREE.Points(g,new THREE.PointsMaterial({
  color:0xffab44,size:Math.max(.001,worldSize*.004),sizeAttenuation:true,
  depthTest:false,depthWrite:false
 }));
 detailOverlay.renderOrder=120;scene.add(detailOverlay);
}
function disableDetailPainting(){
 detailPainting=false;controls.enabled=true;renderer.domElement.style.cursor='';
 $('detail-brush').textContent='🖌 Включить защиту';
}
function detailTouch(event){
 if(!detailPainting||event.button!==0)return;
 event.preventDefault();event.stopPropagation();
 const mesh=selected();if(!mesh||pending||activeOptimization)return;
 const rect=renderer.domElement.getBoundingClientRect();
 detailPointer.set(2*(event.clientX-rect.left)/rect.width-1,
  1-2*(event.clientY-rect.top)/rect.height);
 detailRaycaster.setFromCamera(detailPointer,camera);
 const hit=detailRaycaster.intersectObject(mesh,false)[0];
 if(!hit)return msg('Коснись самой модели, а не фона.');
 const center=mesh.worldToLocal(hit.point.clone()),g=mesh.geometry;
 g.computeBoundingBox();
 const radius=g.boundingBox.getSize(new THREE.Vector3()).length()*Number($('detail-radius').value);
 try{
  const changed=paintDetailSphere(g,currentDetailMask(mesh),center,radius,$('detail-mode').value==='protect');
  updateDetailOverlay();
  msg('Защита деталей: изменено '+fmt(changed)+' вершин. Оранжевые точки не экспортируются.');
 }catch(error){msg('Ошибка защитной кисти: '+error.message)}
}
renderer.domElement.addEventListener('pointerdown',detailTouch,true);
$('detail-radius').oninput=()=>{$('detail-radius-value').textContent=(Number($('detail-radius').value)*100).toFixed(1)+'%';};
$('detail-brush').onclick=()=>{
 if(!selected())return msg('Сначала загрузи модель GLB.');
 if(pending||activeOptimization)return msg('Сначала заверши текущую обработку.');
 if($('method').value!=='qem')return msg('Защитная кисть работает только в режиме QEM.');
 if(detailPainting){disableDetailPainting();return}
 detailPainting=true;controls.enabled=false;renderer.domElement.style.cursor='crosshair';
 $('detail-brush').textContent='✓ Выключить кисть (вращать камеру)';
 msg('Коснись нужной детали модели. Камера временно заблокирована.');
};
$('detail-clear').onclick=()=>{
 if(!selected())return;
 if(!confirm('Очистить всю маску защиты деталей?'))return;
 detailMasks.delete(selected());updateDetailOverlay();
 msg('Защита деталей очищена.');
};

function textureSafety(mesh){
 // Use effective texture resolution AFTER KHR_texture_transform repeat.
 // The user's gltfpack WebP atlas has UV 0..1/16 and texture.repeat≈16.
 let textureSize=2048,uvRepeat=1;
 const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
 for(const material of materials){
  if(!material)continue;
  for(const name of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap']){
   const texture=material[name];
   if(!texture)continue;
   const src=texture.image||texture.source?.data;
   const longest=Math.max(Number(src?.width)||0,Number(src?.height)||0);
   if(longest>0)textureSize=Math.max(textureSize,longest);
   uvRepeat=Math.max(uvRepeat,
    Math.abs(Number(texture.repeat?.x)||1),Math.abs(Number(texture.repeat?.y)||1));
  }
 }
 return {textureSize,uvRepeat,maxUvTexels:4};
}

function selectedStats(){
  if(!character)return $('stats').textContent='Нет модели';
  // Geometry/triangle counts change in preview, compare and apply.
  // Keeping the initial count in the mesh selector misleads users into
  // thinking a 744k-face mesh was not optimized after a 45k preview.
  for(let i=0;i<meshes.length;i++){
    const node=meshes[i].node,option=$('meshes').options[i];
    if(!node?.geometry||!option)continue;
    const geometry=node.geometry,faceCount=Math.floor(
      (geometry.index?.count||geometry.getAttribute('position')?.count||0)/3);
    const inPreview=pending?.mesh===node;
    const stage=inPreview
      ?(geometry===pending.geometry?' · ПОСЛЕ (предпросмотр)':' · ДО (предпросмотр)')
      :originals.has(node)?' · ИЗМЕНЁН':'';
    option.textContent=meshes[i].name+' · '+fmt(faceCount)+' △'+stage;
  }
  const d=describe(character),m=selected();
  const protection=m?readClothProtection(m):null;
  $('stats').textContent='Всего: '+fmt(d.vertices)+' вершин / '+fmt(d.triangles)+' треугольников'+
    '\nМешей: '+d.meshes.length+' · анимаций: '+animations.length+
    (m?'\nВыбран: '+(m.name||'Mesh')+' · '+fmt(Math.floor((m.geometry.index?.count||m.geometry.getAttribute('position').count)/3))+
       ' треугольников · '+(m.isSkinnedMesh?m.skeleton.bones.length+' костей':'без скелета'):'')+
    (protection?.hasMask ? '\nЗащита одежды: '+(protection.reason || fmt(protection.count)+' вершин защищено') : '');
  normalBaker.refresh();
  pbrBaker.refresh();
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
let pbrBaker=null;
const normalBaker=setupNormalBaker({
 getMesh:selected,getPending:()=>pending,getOriginal:mesh=>originals.get(mesh),
 $,notify:msg,canStart:()=>!pbrBaker?.hasMaterial(selected())
});
pbrBaker=setupPbrBaker({
 getMesh:selected,getPending:()=>pending,getOriginal:mesh=>originals.get(mesh),
 $,notify:msg,canStart:()=>!normalBaker.hasMaterial(selected())
});
function cancelPending(){
  pbrBaker.cancel();
  normalBaker.cancel();
  if(activeOptimization){
    const task=activeOptimization;
    activeOptimization=null;task.cancel();
    $('simplify').textContent='Предпросмотр удаления вершин';
    $('simplify').disabled=false;
  }
  if(!pending)return;
  pbrBaker.clear(pending.mesh);
  normalBaker.clear(pending.mesh);
  if(pending.mesh.geometry===pending.geometry)pending.mesh.geometry=pending.before;
  pending.geometry.dispose();pending=null;
  $('compare').disabled=true;
  selectedStats();updateCapsules();
  msg('Предпросмотр отменён, сетка не изменена.');
}
function apply(){
  if(activeOptimization||normalBaker.isBusy()||pbrBaker.isBusy())return msg('Сначала заверши расчёт геометрии или карт PBR.');
  if(!pending)return msg('Сначала создай предпросмотр.');
  const {mesh,geometry,type,before}=pending;
  if(!originals.has(mesh))originals.set(mesh,before);
  else if(before!==originals.get(mesh))before.dispose();
  mesh.geometry=geometry;pending=null;mesh.geometry.computeBoundingSphere();
  detailMasks.delete(mesh);disableDetailPainting();updateDetailOverlay();
  $('compare').disabled=true;
  selectedStats();updateCapsules();
  msg('Изменение '+type+' применено в рабочей копии. Экспортируй GLB отдельно или восстанови оригинал.');
}
function restore(){
  cancelPending();pbrBaker.clearAll();normalBaker.clearAll();
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
  disableDetailPainting();clearDetailOverlay();
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
  $('meshes').value=0;updateBones();fit();selectedStats();updateDetailOverlay();
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
$('meshes').onchange=()=>{disableDetailPainting();cancelPending();updateBones();selectedStats();updateDetailOverlay();};
$('presets').onchange=()=>{
  if($('presets').value!=='custom')$('target').value=$('presets').value;
};
$('target').oninput=()=>{
  // Always make the visible preset agree with the numeric target the worker
  // actually uses. "Своя" is the only honest label for nonpreset values.
  const value=String(Number($('target').value));
  const option=[...$('presets').options].find(o=>o.value===value);
  $('presets').value=option?option.value:'custom';
};
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
  if(normalBaker.isBusy()||pbrBaker.isBusy())return msg('Сначала закончи или отмени запекание текстур.');
  if(activeOptimization){
    const task=activeOptimization;activeOptimization=null;task.cancel();
    $('simplify').textContent='Предпросмотр удаления вершин';
    msg('Расчёт отменён. Исходная геометрия сохранена.');return;
  }
  const mesh=selected();if(!mesh)return msg('Сначала загрузи GLB.');
  const cloth=readClothProtection(mesh);
  if(cloth.hasMask)return msg('У этого меша есть защита одежды. Упрощение изменит номера вершин. Сначала создай отдельную копию без маски в Character.');
  if($('method').value!=='qem'&&countLocked(currentDetailMask(mesh))>0)
    return msg('Есть защищённые вершины: используй QEM либо очисти маску перед кластеризацией.');
  disableDetailPainting();clearDetailOverlay();
  cancelPending();
  const target=Number($('target').value);
  if(!Number.isInteger(target)||target<64)return msg('Задай целевое число треугольников не менее 64.');
  const existing=Math.floor((mesh.geometry.index?.count||mesh.geometry.getAttribute('position').count)/3);
  if(target>=existing)return msg('Выбранный меш уже соответствует цели: '+fmt(existing)+' ≤ '+fmt(target)+'. Если весь персонаж тяжелее, выбери другой меш в списке выше.');
  if(target<existing*.08)msg('Очень сильное упрощение: цель меньше 8% исходных граней. Проверь лицо, волосы, ремни и одежду.');
  else msg('Обработка большого меша в отдельном потоке… Исходная модель не изменяется.');
  $('simplify').textContent='✕ Отменить расчёт';
  await new Promise(resolve=>requestAnimationFrame(resolve));
  let job=null;
  try{
    job=optimizeInBackground(mesh.geometry,target,{
      preserveUV:$('uv').checked,protectSkin:$('joint').checked,
      method:$('method').value,qemError:Number($('qem-quality').value),
      attributeAware:$('qem-attributes').checked,
      protectedVertices:$('method').value==='qem'?currentDetailMask(mesh):null,
      ...textureSafety(mesh)
    },(attempt,total)=>{
      msg('Оптимизация меша: проход '+attempt+' из примерно '+total+
        ' · '+fmt(existing)+' △ · цель '+fmt(target)+' △. Можно отменить.');
    });
    activeOptimization=job;
    const result=await job.promise;
    if(activeOptimization!==job){result.geometry?.dispose();return}
    activeOptimization=null;
    if(result.reason)return msg(result.reason);
    pending={mesh,geometry:result.geometry,before:mesh.geometry,type:'упрощения'};
    mesh.geometry=result.geometry;
    $('compare').disabled=false;
    $('compare').textContent='Сравнение: ПОСЛЕ (показать ДО)';
    selectedStats();updateCapsules();
    msg((result.method?.includes('Meshoptimizer')?'QEM: ':'Кластеризация: ')+'Пробная сетка: '+fmt(result.originalTriangles)+' → '+fmt(result.triangles)+
      ' треугольников, цель '+fmt(target)+'.'+
      ' · отклонение '+(result.targetErrorPercent>0?'+':'')+result.targetErrorPercent+
      '%; макс. сдвиг вершин '+result.maxMovementPercent+'% диагонали, UV до '+
      result.maxUvMovementTexels+' пикселей.'+
      (Math.abs(result.targetErrorPercent)>15?' ВНИМАНИЕ: цель достигнута неточно, проверь результат.':'')+
      ' Исходник сохранён; нажми «Применить» или «Отменить».');
  }catch(e){
    if(job&&activeOptimization!==job)return;
    msg('Ошибка оптимизации: '+e.message);
  }finally{
    if(activeOptimization===job)activeOptimization=null;
    if(!activeOptimization)$('simplify').textContent='Предпросмотр удаления вершин';
  }
};
$('guard').onclick=()=>{
  if(activeOptimization||normalBaker.isBusy()||pbrBaker.isBusy())return msg('Сначала закончи оптимизацию или запекание.');
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
 if(normalBaker.isBusy()||pbrBaker.isBusy())return false;
 if(activeOptimization){msg('Сначала закончи или отмени расчёт оптимизации.');return false}
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
  if(activeOptimization||normalBaker.isBusy()||pbrBaker.isBusy())return msg('Дождись завершения расчёта или нажми отмену.');
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