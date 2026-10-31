#!/usr/bin/env python3
"""Patch only the temporary Character Studio source copy inside unified APK CI.

Expose an awaited import hook: a synthetic input.change event returns before
Character's async GLB load completes and used to falsely mark success.
Original Character-Studio repository is never modified.
"""
from pathlib import Path
import sys

ANCHOR = """$('base-file').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{await loadBase(new Uint8Array(await f.arrayBuffer()),f.name);}catch(e){err(e);}e.target.value='';});"""

REPLACEMENT = """// Integrated Forge MUST await the actual GLB parse, skeleton check and scene mount.
window.PhoenixCharacterImport=async file=>{
 if(!file || !/\\.glb$/i.test(file.name))throw Error('Character: нужен GLB персонажа');
 const bytes=new Uint8Array(await file.arrayBuffer());
 await loadBase(bytes,file.name);
 const bones=state.root?getBones(state.root):[];
 if(!state.root || state.demo || !bones.length)
  throw Error('Character: модель не появилась после импорта. Проверь Rig и скелет.');
 return {name:state.baseName,bones:bones.length,animations:state.baseAnimations.length};
};
window.dispatchEvent(new Event('phoenix:character-import-ready'));
$('base-file').addEventListener('change',async e=>{
 const f=e.target.files[0];if(!f)return;
 try{await window.PhoenixCharacterImport(f)}catch(error){err(error)}
 e.target.value='';
});"""

def patch_source(text: str) -> str:
    if text.count(ANCHOR) != 1:
        raise ValueError('Unexpected Character importer; cannot safely patch')
    return text.replace(ANCHOR, REPLACEMENT, 1)

def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit('Usage: patch_character_handoff.py <Character Studio clone>')
    file = Path(sys.argv[1]) / 'src/main.js'
    source = file.read_text(encoding='utf-8')
    file.write_text(patch_source(source), encoding='utf-8')
    print('Character imported-GLB acknowledgement enabled in temporary clone')

if __name__ == '__main__':
    main()
