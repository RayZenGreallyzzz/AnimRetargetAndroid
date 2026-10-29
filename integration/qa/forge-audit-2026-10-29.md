# Forge QA — 2026-10-29 (repeat audit)

## Artifact inspected
- Last signed unified Retarget Sync APK, GitHub Actions run 40859267731.
- Test character: Tripo_Woman_Walk_Animated.glb (7,386,332 bytes).
- Static APK ZIP and bundled JS/DEX inspection, glTF accessor-level validation, GitHub Node unit suites and Android debug build jobs.
- WebView/rendering interaction on a physical Android tablet **not performed**. Standalone Chromium is blocked by the execution environment; do not interpret successful compilation as a device-level animation test.

## Verified
- Signed APK ZIP integrity valid. Modules: Rig, Character, Optimize, native Retarget. Direct handoff string present in compiled DEX.
- GLB: 65 skin joints, 65 inverse bind matrices, 18,878 vertices, 18,324 triangles, 2 clips (66 channels each). All vertices have valid joint IDs and all weight sums within 0.001 of 1.0. No NaNs in weights.
- Character extra-bone weight editing bypasses marked cloth vertices; Optimize capsule guard uses the stored mask to skip those vertices.
- Native Retarget direct handoff uses a filename resolved inside the app-private workspace; manual SAF workflow still available.

## Bug found and changed
**High — Mask signature v1 could miss topology changes.** Existing v1 implementation sampled approximately 96 vertex coordinates and ignored triangle index values. An unsampled middle vertex could be changed without invalidating the protection mask. Also, a WeakMap cache in Character bypassed signature checks after in-place edits to the same BufferGeometry.
- Character commit 62980798 and unit tests commit 245e1fd.
- Optimize commits 9c98f3a8, 97ee1793, 17a167fa, 7f41c1ac.
- New v2 protection hashes *all* ordered vertex coordinates and triangle indices and verifies on every cloth-mask read; malformed/non-finite vertices fail closed with a readable error.
- Regression tests cover unseen middle vertex edits, index reordering, mutation of the same geometry object, old v1 rejection and malformed coordinates.

## Outstanding issues (not claimed as fixed)
1. **P0 — Rig 7.6 AutoRig ignores cloth mask.** Mask is consumed only in Character extra-bone editing and Optimize capsule repair. Core AutoRig can still repaint cloth. Requires changes to its original weight engine and integration/regression tests.
2. **P1 — v1 projects/masks are not automatically migratable to v2.** Older `.pcs` files containing a v1 mask are rejected by the new strict validator. Preserve older copies. Repaint/approve a visible mask before enabling any weight operations; do not silently reuse an unsafe signature.
3. **P1 — One continuous sewn mesh needs hand-painted semantic masking.** A topological island selector cannot identify garment vs body within one continuous surface.
4. **P1 — No proof of real Android render/retarget behavior.** CI tests parser, build and byte format. Need visual checks of shoulders, chest, clothing, root motion on the user's 4GB Android 15 device.
5. **P2 — Project handoff is file-level, not a single live 3D scene.** Exports/GLB revisions are synced; unsaved editor state does not follow the user. A fresh distinct package suffix also has separate Android private storage.
6. **P2 — Memory/performance.** Multiple WebViews and 3D contexts stay allocated while switching tabs; 4GB device may experience OOM under large GLBs. Native Retarget also parses the entire GLB byte buffer. Profiling still required.
7. **P2 — Optimizer is not equivalent to Tripo semantic retopology.** Its geometry simplification uses conservative clustering; it does not guarantee animation-friendly quad loops or an exact target triangle count.

## Recommended next regression scenarios
- Export character with v2 mask → reimport into Optimize → verify the count and full-mask hash; modify protected geometry and confirm fail-closed rejection.
- Paint dress/collar/sleeves, run aggressive capsule reassignment, compare all protected JOINTS_0/WEIGHTS_0 before and after byte-for-byte.
- Reopen a legacy v1 `.pcs` project; surface an explicit migration/error path and never silently paint/reassign cloth.
- Retarget GLB directly without SAF, then walk in place and root motion; confirm clips load and source project remains intact.
- Stress 3 WebViews at 50MB/100MB GLB and monitor memory, frame rate and orientation/renderer loss.
