# Phoenix Forge PBR QA11 — 30 October 2026

## Implemented this iteration
- Optional offline high-poly-to-low-poly **PBR texture reprojection** in the optimizer.
- Geometry transfer uses `three-mesh-bvh` in an isolated Web Worker and barycentric UV sampling of the original high-poly mesh.
- Supports source **base color and alpha**, **packed roughness/metalness**, **ambient occlusion** (UV0 only), and **emissive** maps if present on a single material.
- Samples the original individual texture transforms and wraps (repeat/clamp/mirror), and writes the target atlas in a single common UV space. Retains original factor values on the cloned material.
- Re-baked maps can be previewed, saved individually as PNG and optionally exported as a GLB with the modified material.
- Preview ДО/ПОСЛЕ toggles original geometry **and** material, avoiding a false comparison.
- Explicit user opt-in: original texture maps from Tripo/Meshy are reused by QEM automatically and are usually the best quality choice; PBR map transfer is *not needed* when QEM preserves UV.
- Separate reset of PBR materials; original GLB and high-resolution textures remain intact.
- Fail closed when UV target coordinates exceed 0–1 after atlas transform, overlapping UV islands are excessive, too many projected texels miss, textures use UV1, a mesh has multiple material groups, or PBR memory estimate is excessive.
- CPU decoded source image limits 4096 px and 80 MiB across selected maps. Output 128/256/512px defaults to 256 for 4GB Android. Cancels operation cleanly.
- Native Android suite tabs and original Rig v7.6 were not changed.

## Limitations and next stage
- This is **experimental high-to-low PBR projection**, not Tripo semantic retopology, a new automatic UV unwrap, atlas packing, normal/AO-from-geometry baking, displacement or PBR inference.
- AO maps using TEXCOORD_1 are unsupported until separate UV1 reprojection is added; user may disable AO in the panel.
- Mixed material groups, rotated texture transforms and overlap-heavy UV shells are intentionally rejected rather than corrupting face/clothing colors.
- The source material's AO and normal maps are not regenerated from physically simulated lighting; PBR transfer samples existing pixels only.
- CPU pixel extraction through Canvas 2D may fail for unreadable/compressed image sources; the application will report this.
- 256px new maps can be less detailed than an existing 2048px Tripo atlas. Recommend retaining original maps unless low-poly UV was changed.
- A passing CI build and worker unit tests are not equivalent to an actual Android render / successful Tripo-looking result; review the user's 3D model on the tablet.
