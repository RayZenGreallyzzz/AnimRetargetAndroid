#!/usr/bin/env python3
"""Create real selectable Woman skeleton GLBs based on original v7.6 Human rig.

All original 66 skin joints and inverse bind matrices are retained; independent
optional bone chains are appended to GLB scene, skin.joints and inverseBindMatrices.
No original APK resource is modified. 16 combinations: breast/tail/wings/ears.
"""
import json
import struct
import sys
from pathlib import Path

def mul(a,b):
    return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]

def identity():
    return [1.0 if r==c else 0.0 for c in range(4) for r in range(4)]

def local_matrix(node):
    if 'matrix' in node:
        return [float(x) for x in node['matrix']]
    x,y,z,w=node.get('rotation',[0,0,0,1])
    sx,sy,sz=node.get('scale',[1,1,1])
    tx,ty,tz=node.get('translation',[0,0,0])
    return [
        (1-2*(y*y+z*z))*sx,(2*(x*y+z*w))*sx,(2*(x*z-y*w))*sx,0,
        (2*(x*y-z*w))*sy,(1-2*(x*x+z*z))*sy,(2*(y*z+x*w))*sy,0,
        (2*(x*z+y*w))*sz,(2*(y*z-x*w))*sz,(1-2*(x*x+y*y))*sz,0,
        tx,ty,tz,1
    ]

def inverse(m):
    # General Gauss-Jordan inverse; glTF stores matrices column-major.
    a=[[float(m[c*4+r]) for c in range(4)]+[float(r==c) for c in range(4)] for r in range(4)]
    for i in range(4):
        pivot=max(range(i,4),key=lambda r:abs(a[r][i]))
        if abs(a[pivot][i])<1e-10:
            raise ValueError('Non-invertible Woman skeleton bind matrix')
        a[i],a[pivot]=a[pivot],a[i]
        t=a[i][i];a[i]=[v/t for v in a[i]]
        for r in range(4):
            if r!=i:
                q=a[r][i];a[r]=[x-q*y for x,y in zip(a[r],a[i])]
    return [a[r][c+4] for c in range(4) for r in range(4)]

def parse_glb(raw):
    if len(raw)<20 or raw[:4]!=b'glTF':
        raise ValueError('Not a GLB')
    _,version,total=struct.unpack_from('<III',raw)
    if version!=2 or total!=len(raw):
        raise ValueError('Invalid GLB header')
    off=12;obj=None;binary=None
    while off<total:
        length,kind=struct.unpack_from('<II',raw,off)
        off+=8
        chunk=raw[off:off+length];off+=length
        if kind==0x4E4F534A:obj=json.loads(chunk)
        elif kind==0x004E4942:binary=chunk
    if obj is None or binary is None:
        raise ValueError('Expected GLB JSON and BIN chunks')
    return obj,binary

def assemble_glb(obj,binary):
    j=json.dumps(obj,separators=(',',':'),ensure_ascii=False).encode('utf8')
    j+=b' ' * ((-len(j))%4)
    binary+=b'\0' * ((-len(binary))%4)
    size=12+8+len(j)+8+len(binary)
    return (struct.pack('<III',0x46546c67,2,size)+
            struct.pack('<II',len(j),0x4e4f534a)+j+
            struct.pack('<II',len(binary),0x004e4942)+binary)

def new_woman(original,flags):
    obj,source=parse_glb(original)
    nodes=obj['nodes'];skin=obj['skins'][0]
    names={n.get('name'):i for i,n in enumerate(nodes)}
    if not {'spine_03','spine_02','head','pelvis'}.issubset(names):
        raise ValueError('Wrong source skeleton for Woman bones')
    parents={}
    for i,n in enumerate(nodes):
        for child in n.get('children',[]):parents[child]=i
    globals_cache={}
    def global_at(i):
        if i not in globals_cache:
            local=local_matrix(nodes[i])
            globals_cache[i]=mul(global_at(parents[i]),local) if i in parents else local
        return globals_cache[i]
    for i in range(len(nodes)):
        global_at(i)

    def p3(matrix):
        return [float(matrix[12]),float(matrix[13]),float(matrix[14])]
    def add(a,b):
        return [x+y for x,y in zip(a,b)]
    def sub(a,b):
        return [x-y for x,y in zip(a,b)]
    def scale(a,k):
        return [v*k for v in a]
    def dot(a,b):
        return sum(x*y for x,y in zip(a,b))
    def norm(a):
        import math
        length=math.sqrt(dot(a,a))
        if length<1e-8:raise ValueError('Cannot calculate original bone orientation')
        return [v/length for v in a]
    def cross(a,b):
        return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
    def apply(matrix,p):
        return [sum(matrix[col*4+row]*p[col] for col in range(3))+matrix[12+row] for row in range(3)]
    def wp(name):
        return p3(global_at(names[name]))
    # Infer anatomical axes from the actual 66-bone rest skeleton, NOT its
    # local rotations. The base Human source is an FBX-converted Z-up rig:
    # hand-written "x,y,z" local translations can point backwards or sideways.
    hip,spine,head=wp('pelvis'),wp('spine_03'),wp('head')
    upperleft,upperright=wp('upperarm_l'),wp('upperarm_r')
    up=norm(sub(head,hip))
    left=norm(sub(upperleft,upperright))
    right=scale(left,-1)
    front=norm(cross(right,up))
    def target(base,side=0,left_dist=0,up_dist=0,front_dist=0):
        out=add(base,scale(left,side*left_dist))
        out=add(out,scale(up,up_dist))
        return add(out,scale(front,front_dist))
    def chain(parent_name,items):
        parent=names[parent_name]
        for name,world_position in items:
            if name in names:raise ValueError('Duplicate Woman bone '+name)
            # Compute the local translation from the current parent's full
            # inverse world matrix. This survives rotations in the FBX rig.
            local_pos=apply(inverse(global_at(parent)),world_position)
            i=len(nodes)
            nodes.append({'name':name,'translation':local_pos})
            nodes[parent].setdefault('children',[]).append(i)
            parents[i]=parent
            names[name]=i
            globals_cache[i]=mul(global_at(parent),local_matrix(nodes[i]))
            parent=i
            skin['joints'].append(i)
            added_bind_matrices.extend(inverse(globals_cache[i]))

    added_bind_matrices=[]
    if flags[0]=='1':
        for side,sign in [('l',1),('r',-1)]:
            p=target(spine,sign,.135,-.047,.11)
            q=target(p,sign,.012,-.011,.065)
            chain('spine_03',[('breast_'+side,p),('breast_tip_'+side,q)])
    if flags[1]=='1':
        p=target(hip,0,0,-.045,-.115)
        q=target(p,0,0,-.05,-.14)
        r=target(q,0,0,-.055,-.145)
        t=target(r,0,0,-.045,-.12)
        chain('pelvis',[('tail_01',p),('tail_02',q),('tail_03',r),('tail_tip',t)])
    if flags[2]=='1':
        for side,sign in [('l',1),('r',-1)]:
            p=target(spine,sign,.19,.095,-.09)
            q=target(p,sign,.17,.095,-.09)
            r=target(q,sign,.18,.015,-.075)
            t=target(r,sign,.14,-.11,-.08)
            chain('spine_03',[
                ('wing_01_'+side,p),('wing_02_'+side,q),
                ('wing_03_'+side,r),('wing_tip_'+side,t)])
    if flags[3]=='1':
        for side,sign in [('l',1),('r',-1)]:
            p=target(head,sign,.085,.103,0)
            q=target(p,sign,.028,.08,0)
            t=target(q,sign,.008,.05,0)
            chain('head',[('ear_01_'+side,p),('ear_02_'+side,q),('ear_tip_'+side,t)])
    if not added_bind_matrices: return original
    binary=bytearray(source)
    while len(binary)%4:binary.append(0)
    original_ibm=obj['accessors'][skin['inverseBindMatrices']]
    if original_ibm.get('type')!='MAT4' or original_ibm.get('componentType')!=5126:
        raise ValueError('Expected FLOAT MAT4 inverse bind accessor')
    view=obj['bufferViews'][original_ibm['bufferView']]
    old_off=view.get('byteOffset',0)+original_ibm.get('byteOffset',0)
    old_count=original_ibm['count']
    old_matrices=source[old_off:old_off+old_count*64]
    if len(old_matrices)!=old_count*64 or old_count!=len(skin['joints'])-len(added_bind_matrices)//16:
        raise ValueError('Original skin joints/inverse bind matrices mismatch')
    new_matrices=old_matrices+struct.pack('<%df'%len(added_bind_matrices),*added_bind_matrices)
    offset=len(binary);binary+=new_matrices
    obj['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(new_matrices)})
    obj['accessors'].append({'bufferView':len(obj['bufferViews'])-1,
        'componentType':5126,'count':len(skin['joints']),'type':'MAT4'})
    skin['inverseBindMatrices']=len(obj['accessors'])-1
    obj['buffers'][0]['byteLength']=len(binary)
    obj.setdefault('extras',{})['phoenixWomanBones']={
        'breast':flags[0]=='1','tail':flags[1]=='1','wings':flags[2]=='1','ears':flags[3]=='1'
    }
    return assemble_glb(obj,bytes(binary))

def build(rig_directory):
    original_path=rig_directory/'rig-human.glb'
    original=original_path.read_bytes()
    count=0
    for n in range(16):
        flags=''.join('1' if (n>>shift)&1 else '0' for shift in range(4))
        output=new_woman(original,flags)
        (rig_directory/('rig-woman-'+flags+'.glb')).write_bytes(output)
        verify, _=parse_glb(output)
        if len(verify['skins'][0]['joints']) != verify['accessors'][verify['skins'][0]['inverseBindMatrices']]['count']:
            raise RuntimeError('Woman GLB skin corrupted for '+flags)
        count+=1
    return count

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('Usage: woman_rig_build.py <staged-rig-dir>')
    print('Built',build(Path(sys.argv[1])),'configurable Woman bone profiles')
