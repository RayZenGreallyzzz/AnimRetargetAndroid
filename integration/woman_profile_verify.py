#!/usr/bin/env python3
"""Release-build quality gate for staged Woman profiles (no original edits)."""
import itertools
import struct
import sys
from pathlib import Path
from woman_rig_build import parse_glb, mul, local_matrix, identity

BASE_JOINTS=66

def verify(path):
    rig=path/'rigs'
    page=(path/'create.html').read_text('utf8')
    if page.count('id="phoenix-woman-bone-options"')!=1 or 'chest-guard-panel' not in page:
        raise RuntimeError('Missing Woman controls or original Chest Guard')
    if page.index('id="phoenix-woman-bone-options"')>=page.index('id="hand-skeleton-options"'):
        raise RuntimeError('Woman options are misplaced')
    bundles=list((path/'assets').glob('create-*.js'))
    matched=[p for p in bundles if 'rig_display_name:\x60Woman\x60' in p.read_text('utf8')]
    if len(matched)!=1:
        raise RuntimeError('Woman dropdown not registered in v7.6 main JS')
    s=matched[0].read_text('utf8')
    order=[s.index('rig_display_name:\x60'+label+'\x60') for label in ['Human','Woman','Humanoid']]
    if order!=sorted(order):raise RuntimeError('Woman must be between Human and Humanoid')
    verified=0
    for bits in itertools.product('01', repeat=4):
        flags=''.join(bits)
        file=rig/('rig-woman-'+flags+'.glb')
        if not file.is_file():raise RuntimeError('Missing optional Woman GLB '+flags)
        j,bin_data=parse_glb(file.read_bytes())
        nodes=j['nodes'];skin=j['skins'][0];names=[x.get('name') for x in nodes]
        n_extra=int(bits[0])*4+int(bits[1])*4+int(bits[2])*8+int(bits[3])*6
        if len(skin['joints'])!=BASE_JOINTS+n_extra:raise RuntimeError('Wrong joints for '+flags)
        if j['accessors'][skin['inverseBindMatrices']]['count']!=len(skin['joints']):
            raise RuntimeError('Missing inverse bind matrices for '+flags)
        for feature,heads in [
            (0,['breast_l','breast_r']), (1,['tail_01']),
            (2,['wing_01_l','wing_01_r']), (3,['ear_01_l','ear_01_r'])
        ]:
            present=all(name in names for name in heads)
            if present!=(bits[feature]=='1'):
                raise RuntimeError('Wrong optional bones '+flags+'/'+str(feature))
        # Check real mirrored world positions on the base rig, not local
        # coordinates (converted FBX root and Spine bones have rotated axes).
        parents={child:i for i,node in enumerate(nodes) for child in node.get('children',[])}
        cache={}
        def global_node(i):
            if i not in cache:
                local=local_matrix(nodes[i])
                cache[i]=mul(global_node(parents[i]),local) if i in parents else local
            return cache[i]
        def pos(name):
            m=global_node(names.index(name))
            return [m[12],m[13],m[14]]
        def dot(a,b):return sum(x*y for x,y in zip(a,b))
        def sub(a,b):return [x-y for x,y in zip(a,b)]
        left=sub(pos('upperarm_l'),pos('upperarm_r'))
        for name_l,name_r in [('breast_l','breast_r'),('wing_01_l','wing_01_r'),('ear_01_l','ear_01_r')]:
            if name_l in names and name_r in names:
                if dot(sub(pos(name_l),pos(name_r)),left)<=.001:
                    raise RuntimeError('Anatomical L/R reversed for '+name_l+'/'+flags)
                if dot(sub(pos(name_r),pos(name_l)),left)>=-.001:
                    raise RuntimeError('Anatomical R/L reversed for '+name_r+'/'+flags)
        if 'tail_01' in names:
            if pos('tail_01')[1]>=pos('pelvis')[1]:
                raise RuntimeError('Tail root should be below hips in template bind pose')
        if flags!='0000':
            expected={'breast_l':'spine_03','breast_r':'spine_03','tail_01':'pelvis',
                      'wing_01_l':'spine_03','wing_01_r':'spine_03',
                      'ear_01_l':'head','ear_01_r':'head'}
            for child,parent in expected.items():
                if child in names and names.index(child) not in nodes[names.index(parent)].get('children',[]):
                    raise RuntimeError('Wrong bone parent '+child)
        verified+=1
    print(f'PASS: {verified} selectable Woman rigs with GLB skin / correct IBM counts and hierarchy')

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: woman_profile_verify.py <staged-rig-dist>')
    verify(Path(sys.argv[1]))
