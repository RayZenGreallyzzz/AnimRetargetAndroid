# Phoenix Forge Heavy Mesh QA5 — 30 October 2026

## User bug reproduced in source
QA4 Optimizer reported "Слишком крупный меш для безопасной обработки на планшете" when selected mesh contained **more than 260,000 triangles**. The explicit threshold was coded in `simplifyGeometry()`, and the target-input HTML also had `max=260000`.

## Fixes
- Removed both arbitrary polygon-count restrictions.
- Replaced a duplicate JavaScript `Array<number>` copy of every triangle index with the original typed index view.
- Optimizes in an isolated module Web Worker using copied/transferable buffers. The original geometry remains unmodified until the user explicitly applies the preview.
- Shows progress and supports cancellation (terminates worker without modifying original model).
- On limited-memory Android, a per-geometry estimated memory budget provides a readable failure rather than knowingly allocating an unsafe amount; **not** an unconditional polygon-count cap.
- Reduces the number of refinement passes for oversized meshes to manage CPU/memory on 4GB tablets.
- Blocks accidental model export / handoff / capsule edits while an optimization calculation is in progress.
- Explicitly distinguishes mesh-level polygon target from whole-character target.

## Tests
- Existing 198,450-triangle skinned UV synthetic mesh target 20,000.
- **New:** 273,800-triangle skinned UV mesh, previously rejected; benchmark after fix: **18,050 triangles** for target 20,000, ~4.0s on CI Node runner, maximum measured movement 0.41% model diagonal; not Android timing.
- Actual Node worker roundtrip test using transfer buffer: reconstruct geometry with position, UV, normals, skin indices and normalized weights; original source remains intact.
- Worker cancellation returns a clean error and preserves original index buffers.
- GitHub Vite build verifies worker can be bundled as an offline script.

## Remaining limitations
- Not Tripo-style semantic/quad retopology. Conservative vertex clustering may be inaccurate or lose detail of hair and fabric even if tested deformation thresholds pass.
- 20,000 is the target for a chosen mesh, **not** total entire GLB if the model has multiple body/clothing/hair mesh nodes.
- Cloth-protection masks may block topology-changing optimization; this is deliberate to preserve weight protection.
- If estimated peak memory still exceeds the tablet RAM budget, user receives an informative warning rather than an unconditional crash. Streaming chunk-by-chunk geometry processing is still not implemented.
- Need user's original GLB and Android-device visual check of face, hair, clothing and animation before claiming equivalence to cloud Tripo.
