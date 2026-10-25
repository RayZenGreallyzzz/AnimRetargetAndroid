#!/usr/bin/env python3
"""Apply 1.1.2 test hotfix to sources extracted from the original package."""
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'AnimRetargetAndroid')
base = root / 'app/src/main/java/com/animretarget/app'
p = base / 'Math3d.kt'
s = p.read_text(encoding='utf-8')
fixes = {
    '(m[5] - m[7]) / s': '(m[7] - m[5]) / s',
    '(m[6] - m[2]) / s': '(m[2] - m[6]) / s',
    '(m[1] - m[3]) / s': '(m[3] - m[1]) / s',
}
for before, after in fixes.items():
    count = s.count(before)
    if count not in (0, 2):
        raise ValueError(f'Unexpected Math3d.kt for {before}: {count} occurrences')
    s = s.replace(before, after)
p.write_text(s, encoding='utf-8')

p = base / 'Pipeline.kt'
s = p.read_text(encoding='utf-8')
needle = """                else -> emptyArray()
            }
            for (axisIdx in 0 until 3) {
"""
replacement = """                else -> emptyArray()
            }
            // Euler angles equivalent modulo 360; prevent FBX interpolation
            // from taking the long way around the +/-180-degree wrap.
            if (role == 'R') {
                for (frame in 1 until eul.size) {
                    for (axisIdx in 0 until 3) {
                        var angle = eul[frame][axisIdx]
                        val previous = eul[frame - 1][axisIdx]
                        while (angle - previous > 180f) angle -= 360f
                        while (angle - previous < -180f) angle += 360f
                        eul[frame][axisIdx] = angle
                    }
                }
            }
            for (axisIdx in 0 until 3) {
"""
if needle in s:
    s = s.replace(needle, replacement, 1)
elif 'Euler angles equivalent modulo 360' not in s:
    raise ValueError('Pipeline.kt expected insertion point not found')
p.write_text(s, encoding='utf-8')
print('Applied quaternion conversion and FBX Euler continuity hotfix')
