# Rig quality reference: Meshy vs Tripo (27 Oct 2026)

Sources: user-provided `Orc_Meshy_skeleton_weights_reference(1).zip` (derived from an Orc FBX running example), `темнокожая женщина хотьба(1).glb` (rigged female), `tripo_retarget_dbf45189-c6f8-403d-9c0b-a50e22df27ea (3)(1).glb` (walk animation donor), and accompanying Tripo analysis HTML. These are **reference metrics**, not distributed assets in GitHub.

## User quality priorities

- **Meshy running example is visibly excellent** on their device: no perceptible limb stretching, joint breaks or loss of volume. Do not mislabel its shoulder influence or tiny Spine2 weight as bugs merely because of unusual values. Treat this as a positive **animation deformation reference**.
- **Tripo** is useful for its modular workflow, multiple skeleton types, rigging, mesh optimization, animation search/preview, and independent rig/animation export. Its deformation quality in the user's experience is a little worse than Meshy.
- Goal for **Phoenix Character Forge**: keep working Rig Animation Studio v7.6 Chest Guard; achieve Meshy-like stable deformation while offering Tripo-like choices and tools. Neither proprietary algorithm has been reverse-engineered.

## Quantitative reference

| Observation | Meshy Orc FBX (from archive report) | Tripo female GLB (independently inspected) |
|---|---:|---:|
| Control/mesh vertices | 15,071 FBX control points | 18,878 glTF vertex entries |
| Triangles | Not supplied in reference data | 18,324 |
| Humanoid skin joints | 66 | 65 |
| Joints with nonzero skin influence | 52 | 52 |
| Unweighted terminal joints | 14 | 13 |
| Vertices with **1** nonzero weight | 296 (1.96%) | 3,441 (18.23%) |
| Vertices with **2** nonzero weights | 6,105 (40.51%) | 8,412 (44.56%) |
| Vertices with **3** nonzero weights | 2,802 (18.59%) | 2,859 (15.14%) |
| Vertices with **4** nonzero weights | 5,868 (38.94%) | 4,166 (22.07%) |
| Sum-to-one deviation | <=1.32e-7 | <=2.22e-16 |
| Skeleton naming | `mixamorig:Hips` (FBX) | `mixamorigHips` (female GLB) |
| Example motion | Running, ~0.63333 s, embedded FBX | Walk, ~2.33333 s, **in separate GLB** |
| Images | Not included in reference archive | 3 images / 1 material |

**Critical caveat:** the 15,071 Meshy vertices are FBX control points; the 18,878 Tripo entries are glTF vertices that can be split at UV/normal seams. The character bodies are also quite different. These ratios alone do **not** prove which weighting algorithm is better: the user's actual visual running result is the deformation-quality benchmark.

- Meshy 3–4 weights: **8,670 / 15,071 = 57.53%**.
- Tripo 3–4 weights: **7,025 / 18,878 = 37.21%**.
- Both share **65 standard humanoid bone names** after removing the optional `mixamorig` prefix and colon. Meshy has one extra zero-weight helper `headfront`; do not delete helper/end joints referenced by any animation.
- Meshy shoulder weights influence many vertices (LeftShoulder 2,912, RightShoulder 2,992). **User reports no visible joint stretching or volume loss.** Do not use a simplistic shoulder vertex-count threshold as a quality rejection.
- Tripo's fully skinned female has **no animation clips**; the separate 120,232-byte animation GLB has 65 bones, one `walk` clip, 66 channels (65 rotations + Hips translation), 71 keys/channel, 0–2.333333 s.
- Tripo's female mesh and walk donor have almost identical local bone rest transformations for **all bones except Hips**: maximum local translation discrepancy for non-Hips bones ~8.1e-8 units, quaternion angle discrepancy below 1e-5 degrees. The donor's `Hips` root translation differs by ~0.1924 units (including offset along vertical axis), and model mesh has a separate `Armature` parent. Retarget should solve root space and origin, not blindly copy local Hips translation.
- Original Tripo workflow in the HTML: remeshing reportedly reduced **197,852 triangles to 18,324** (90.74% reduction). This is a video observation; we have only the final simplified mesh, not its original topology or Tripo's proprietary method.

## Integration design (do not break v7.6)

1. **Rig quality analyzer**: normalize joint names (`mixamorig:Hips` / `mixamorigHips`), identify root/Armature, compare bind matrices and rest-pose hierarchy. Report orientation and scale mismatches *before* applying clips.
2. **Skin profile modes**: `MeshyQuality` for deformable joints with protected volumes and soft blended weights; `TripoCompatible` for importing existing rigs; `Mobile4` exports four highest nonzero weights normalized. These are **desired future engine behaviors**; don't just copy source skeleton weights to another topology.
3. **Quality acceptance**: compare forearm, knee, shoulder, thigh and pelvis volume in several poses and running cycles, and compare continuity across seams. Normalize weights, restrict opposite-limb influence as anatomically warranted, preserve inverse-bind matrices, and test bind/rest before anything else.
4. **Female torso/Woman**: separate left/right breast bones or morph corrections are optional and must coexist with thoracic shoulder skinning. The strong performance of a Meshy Orc DOES NOT mean its exact weight map fits a female body.
5. **Tripo tool layout**: add multiple human, woman, humanoid and animal rigs, scalable Mixamo presets, previewing of motion packs, root-motion vs in-place and a separate mesh optimization tab.
6. **Topology tool**: first target stable mobile-friendly simplification with UV/material/skin protection, new GLB export and rollback; then separately tackle high-quality edge-loop rebuilding around deformable joints.
7. **Shared Forge project**: Rig → Character → Retarget should pass a scene manifest (model URI, skin, rest pose, clips, attachments, active revision), not simply open three independent editors. Sync should never replace unsaved rig weights; persist before transitions.

## Suggested regression scenarios

- Meshy Orc with `Running` FBX as gold-standard visual motion (actual FBX is not inside the reference ZIP: user must provide it again for automated motion testing).
- Tripo female GLB + separate `walk` animation GLB: verify armature/Hips offset correction; export a single GLB with correct textures, weights, and animation; re-import and inspect pose.
- Large-chested Woman sample: raise arms, twist spine, jog, and verify chest guards + no pulling on shoulder skin.
- Animal and wing-tail auxiliary-bone profiles: ensure extra joints survive skinning, saved clips and export.

**Verification status:** numbers and file structures above are from the user-provided analyses plus direct parsing of two GLB files. No animation playback render or APK runtime test was performed. **This document does not claim that any new skinning algorithm is already implemented.**
