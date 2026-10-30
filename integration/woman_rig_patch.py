#!/usr/bin/env python3
"""Add a REAL Woman rig option to the STAGED v7.6 frontend (not source APK).

The original Woman chest-guard controls and all other 7.6 functionality stay.
The unique skeleton type delegates to the existing Human rig/animation pipeline,
but selects one of 16 Woman GLBs with optional additional bone chains.
"""
import re
import sys
from pathlib import Path

HUMANOID = '},{skeleton_type:vt.MobileFemale,'
PREFIX = 'e.MobileFemale=\x60human-mobile-female\x60,e.Bird'
HUMAN_CHECK = 'function Ho(e){return e===vt.Human||e===vt.MobileFemale}'
CONFIG = '''},{skeleton_type:vt.Woman,model_file:\x60models/model-human.glb\x60,rig_file:\x60rigs/rig-woman-1000.glb\x60,rig_display_name:\x60Woman\x60,animation_files:[\x60../animations/human-base-animations.glb\x60,\x60../animations/human-addon-animations.glb\x60,\x60../animations/human-mocap-animations.glb\x60],animation_preview_folder:\x60human\x60,position_tracking_bone_name:\x60pelvis\x60,skeleton_template_image_url:\x60rigs/reference/human.png\x60'''

def replace_once(text,old,new):
    count=text.count(old)
    if count!=1:
        raise RuntimeError(f'Unknown pinned Rig 7.6 bundle layout: expected 1 occurrence, saw {count}, for {old[:100]!r}')
    return text.replace(old,new,1)

def patch_bundle(path):
    s=path.read_text(encoding='utf8')
    s=replace_once(s,PREFIX,'e.MobileFemale=\x60human-mobile-female\x60,e.Woman=\x60woman\x60,e.Bird')
    s=replace_once(s,HUMANOID,CONFIG+HUMANOID)
    s=replace_once(s,HUMAN_CHECK,
        'function Ho(e){return e===vt.Human||e===vt.MobileFemale||e===vt.Woman}')
    s=replace_once(s,'this.skeleton_file_path()===vt.Human?',
        'Ho(this.skeleton_file_path())?')
    s=replace_once(s,'static supported_skeleton_types=[vt.Human,vt.MobileFemale,vt.Kaiju]',
        'static supported_skeleton_types=[vt.Human,vt.Woman,vt.MobileFemale,vt.Kaiju]')
    s=replace_once(s,'static by_key(e){return this.all.find(t=>t.skeleton_type===e)}',
        'static by_key(e){let t=this.all.find(t=>t.skeleton_type===e);return e===vt.Woman&&t?{...t,rig_file:window.PhoenixWomanRig?.file||t.rig_file}:t}')
    s=replace_once(s,'static by_skeleton_type(e){return this.all.find(t=>t.skeleton_type===e)}',
        'static by_skeleton_type(e){let t=this.all.find(t=>t.skeleton_type===e);return e===vt.Woman&&t?{...t,rig_file:window.PhoenixWomanRig?.file||t.rig_file}:t}')
    path.write_text(s,encoding='utf8')

WOMAN_PANEL = '''<section id="phoenix-woman-bone-options" class="alternate-background-section" style="display:none;flex-direction:column;gap:.55rem;padding:10px;border:1px solid #bb7950;border-radius:9px">
  <strong>Woman · Дополнительные кости</strong>
  <small>Скелет Human + отдельные цепочки. Включайте кости только для реально существующих частей тела.</small>
  <label><input type="checkbox" id="phoenix-woman-breast" checked> Левая и правая грудь (2 цепочки)</label>
  <label><input type="checkbox" id="phoenix-woman-tail"> Хвост (4 кости)</label>
  <label><input type="checkbox" id="phoenix-woman-wings"> Крылья (левая и правая цепочки)</label>
  <label><input type="checkbox" id="phoenix-woman-ears"> Уши (левая и правая цепочки)</label>
  <small id="phoenix-woman-current-bones" aria-live="polite">Woman: грудь · 4 добавочные кости</small>
  <small>После изменения набора загрузите скелет заново. Кости входят в GLB и могут редактироваться; для новых частей тела нужно проверить/поправить skin weights и анимации перед экспортом.</small>
</section>'''

def patch_page(path):
    s=path.read_text('utf8')
    marker='<!-- Hand skeleton options for human skeleton -->'
    s=replace_once(s,marker,WOMAN_PANEL+'\n'+marker)
    s=replace_once(s,'</head>','<script src="./phoenix-woman-rig-transform.js"></script>\n<script src="./phoenix-woman-ui.js"></script>\n</head>')
    path.write_text(s,'utf8')

def apply(staged_rig):
    pages=sorted((staged_rig/'assets').glob('create-*.js'),key=lambda p:p.stat().st_size,reverse=True)
    if not pages or pages[0].stat().st_size<100000:
        raise RuntimeError('Pinned 7.6 create bundle missing')
    patch_bundle(pages[0])
    patch_page(staged_rig/'create.html')
    source=Path(__file__).with_name('web')/'phoenix-woman-ui.js'
    (staged_rig/'phoenix-woman-ui.js').write_bytes(source.read_bytes())
    (staged_rig/'phoenix-woman-rig-transform.js').write_bytes((source.parent/'phoenix-woman-rig-transform.js').read_bytes())
    from woman_rig_build import build
    count=build(staged_rig/'rigs')
    print(f'Woman profile: patched {pages[0].name}, built {count} selectable rig variants')

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: woman_rig_patch.py <staged-rig-dist>')
    apply(Path(sys.argv[1]))
