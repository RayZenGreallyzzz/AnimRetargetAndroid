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

def patch_rig_export(stage: Path) -> list[Path]:
    assets = stage / 'assets'
    matched = []
    for path in assets.glob('*.js'):
        source = path.read_text(encoding='utf-8')
        if MARKER in source:
            if source.count(MARKER) != 1:
                raise RuntimeError(f'Ambiguous Rig export function in {path.name}')
            matched.append((path, source))
    # The pinned Rig 7.6 APK bundles TWO legitimate copies of the
    # underlying exporter. Both must be patched, not just the first one.
    if not matched:
        raise RuntimeError('Could not find the original Rig 7.6 GLB exporter')
    for path, source in matched:
        path.write_text(source.replace(MARKER, PATCH, 1), encoding='utf-8')
    return [path for path, _ in matched]

if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: patch_rig_shared_export.py <staged-rig-folder>')
    print('Rig GLB shared workspace exporters patched:',
          ', '.join(str(path) for path in patch_rig_export(Path(sys.argv[1]))))
