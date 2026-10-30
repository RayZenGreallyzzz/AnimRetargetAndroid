#!/usr/bin/env python3
"""Patch only a staged copy of the pinned Rig 7.6 JS export (never upstream).

Rig v7.6 uses Capacitor RigFileExport on Android rather than an <a download>.
The earlier shared workspace click interceptor therefore misses Rig GLBs.
Route GLB only through PhoenixSuite.saveBlob, leaving FBX/other workflows intact.
"""
from pathlib import Path
import sys

MARKER = 'if(t.size===0)throw Error(`Экспорт создал пустой файл`);if(e.is_android()){'
PATCH = (
    'if(t.size===0)throw Error(`Экспорт создал пустой файл`);'
    'if(/\\.glb$/i.test(n)&&window.PhoenixSuite?.saveBlob){'
    'const ok=await window.PhoenixSuite.saveBlob(t,n);'
    'if(!ok)throw Error(`Phoenix: общий GLB не сохранён`);'
    'return}'
    'if(e.is_android()){'
)

def patch_rig_export(stage: Path) -> Path:
    assets = stage / 'assets'
    matched = []
    for path in assets.glob('*.js'):
        source = path.read_text(encoding='utf-8')
        if MARKER in source:
            if source.count(MARKER) != 1:
                raise RuntimeError(f'Ambiguous Rig export function in {path.name}')
            matched.append((path, source))
    if len(matched) != 1:
        raise RuntimeError(f'Expected exactly one Rig 7.6 export implementation; found {len(matched)}')
    path, source = matched[0]
    updated = source.replace(MARKER, PATCH, 1)
    path.write_text(updated, encoding='utf-8')
    return path

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: patch_rig_shared_export.py <staged-rig-folder>')
    print('Rig GLB shared workspace export patched:', patch_rig_export(Path(sys.argv[1])))
