# Phoenix Forge Normal Bake QA9 — 30 October 2026

## What is implemented
- First offline **high-poly to low-poly tangent-space normal-map bake**.
- Original heavy geometry from QEM preview/undo history is sampled via `three-mesh-bvh` raycasting against the low-poly UV surface.
- CPU bake runs in the existing cancellable geometry Web Worker; returns RGBA to main thread.
- Low-resolution defaults (256 px; 128 or 512 selectable) for Android RAM safety.
- PNG save, temporary material preview, optional export of new `normalTexture` in GLB.
- Source geometry and source material remain immutable; cancel/restore resets the preview material. UV outside 0–1 after texture transform fail closed.
- Tests cover flat neutral normals, curved detailed normals, ×16 gltfpack atlas, invalid UV, cancellable worker with transferable buffers.

## Critical real-model finding
The real red-haired gltfpack model `красноволосаямалышка.glb` **already contains a baked normalTexture**, alongside base color and roughness textures. Both high and reduced 300k GLBs retain this normal map. The original glTF material uses `KHR_texture_transform` with ~16× repeat and a small offset.
**Never replace this existing normal map by default.** The UI now explicitly requires an extra checkbox to replace it for comparison. Its high-frequency details are likely better than the prototype 256px re-bake.

## Current limitations
- This feature bakes tangent-space normals, **not** the base-color/albedo, roughness, AO or metallic textures.
- It is not Tripo-style semantic retopology, UV unwrapping or texture atlas re-baking. Current QEM preserves existing UV exactly, so original base-color textures can be reused unchanged.
- Rotated UV transforms, UV outside 0..1 after texture scaling, multiple materials in one SkinnedMesh, and high-poly meshes beyond 1.3M triangles are intentionally unsupported for this stage.
- Low-ray intersection matching can miss thin hair, overlapping layers, cavities or highly displaced triangles; the UI reports misses. Thin shells may need cage-based projection in a subsequent version.
- Three.js WebGL CanvasTexture normal export is validated by build/worker tests, but visual quality on the user's physical Android tablet is not verified.
- The existing per-mesh GLB input workflow remains the same; for multi-mesh characters, bake separately on each selected mesh.

## Dependencies and licensing
- `three-mesh-bvh` 0.9.16, MIT, copyright Garrett Johnson and contributors (https://github.com/gkjohnson/three-mesh-bvh).
- `meshoptimizer` 1.3.0, MIT, Arseny Kapoulkine (https://github.com/zeux/meshoptimizer).
