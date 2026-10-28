# Phoenix Character Forge — Rig 7.6 · Retarget · Character

This is a **separate integration branch**. Original source repositories are never modified.

## Correct Rig APK confirmed by user

The earlier integration used an older `mesh2motion-app/android-rig-animation-studio` build. That was **not** the version the user wanted.

The correct supplied binary is:
- **Filename:** `Rig-Animation-Studio-v7.6-Chest-Guard-test.apk`
- **SHA-256:** `3e36c900a2746dd3cc4b2a71e8a295d6ec72dfcee892940910e3cc1c6fbc6243`
- **Web app location inside APK:** `assets/public/`
- **Verified feature:** Woman / Chest Guard panel (`chest-guard-panel`, sliders for width, height, vertical offset, guard strength, preview and apply)
- **Original Android package:** `com.rayzen.riganimationstudio.v74test` as embedded in Capacitor config (packaging name not equivalent to feature version)

The exact supplied APK is available in the conversation but **cannot be uploaded into GitHub Releases through the connected GitHub API tool**. Once uploaded to a pinned GitHub Release as an asset, Actions fetches it by name and asset ID **automatically**, using the built-in GitHub token. No manual HTTPS URL input or third-party file host is needed. The APK is then checked against the exact SHA-256 above before any build is allowed.

## Unified APK architecture

- Rig 7.6 is the *default screen* with its unchanged core 3D workflow. Added tabs: **Rig and animation**, **Retargeting**, **Character**, **Shared GLB**.
- Character Studio web build is copied from `RayZenGreallyzzz/Character-Studio`.
- Kotlin Anim Retarget source is restored from this repository's existing payload and uses the existing BVH hotfix.
- The native offline WebView shell includes a file chooser and chunked private GLB workspace, and keeps the Rig view in memory when opening Character.
- Retargeting currently opens the native activity and uses Android files for transfer, not a shared live mesh/scene.
- Source APK files are copied out of `assets/public` without changing the bundled javascript, css, rigging algorithms, or reference models. A small navigation script is injected into `create.html` during staging.

## Build via GitHub Actions

**One-time source upload (in the repo `RayZenGreallyzzz/AnimRetargetAndroid`):**
1. Open `https://github.com/RayZenGreallyzzz/AnimRetargetAndroid/releases/new`.
2. Choose **New tag** and enter exactly `phoenix-rig-v7.6-input` (create tag against the **main** branch; this is only a release container and does not change any files in main).
3. Release title: `Phoenix Character Forge — original Rig v7.6 build input`.
4. Attach the **exact original** `Rig-Animation-Studio-v7.6-Chest-Guard-test.apk` (84,054,098 bytes; SHA-256 `3e36c900a2746dd3cc4b2a71e8a295d6ec72dfcee892940910e3cc1c6fbc6243`) **before** publishing. Do not attach the previous `PhoenixUnifiedStudio` APK or a renamed/modified copy.
5. Publish the release. The original APK is now stored in GitHub and is reusable for every new integration build.

**Build/upgrade with no file or URL repeat:**
1. After the one-time upload, simply tell the assistant **"APK uploaded to the pinned GitHub Release"**. It can update `integration/release-build-trigger.txt` on the existing integration branch using its already-connected GitHub write access. The branch's `push` workflow starts automatically; **main remains unchanged**.
2. CI looks up the fixed tag and filename using the repository GitHub API, verifies the APK's SHA-256, extracts the real v7.6 assets, bundles all four tabs, and compiles and signs the APK.
3. Download GitHub Actions artifact **`PhoenixCharacterForge-test-APK`**. The `PhoenixCharacterForge-source-refs` artifact records the source release ID and hashes.

**Manual alternative:** If the full build workflow is listed on GitHub Actions, choose it, set branch `integration/phoenix-character-suite`, and click **Run workflow**. There is no URL input. Some GitHub configurations only allow manual dispatch when workflow files already exist on the default branch. In that case, updating `integration/release-build-trigger.txt` on the integration branch is the reliable route.

The user-uploaded asset may become publicly downloadable if the repository is public; do not include any personal or secret content in the source APK. GitHub Releases is the only hosting destination used by this build.

Workflow will **never silently fall back to the older Rig**. This is intentional to avoid losing working v7.6 features.

### Files and tests
- `integration/extract_rig_v76.py`: exact SHA-256 check, secure offline asset extraction and Chest Guard verification.
- `integration/inject_shell.py`: Rig-first Android integration, original native Retarget activity preserved.
- `integration/web/studio-shell.js`: extra tabs and workspace.
- `integration/kotlin/StudioWebActivity.kt`: offline WebView + Android file save/load bridge.
- `integration/tests/`: smoke checks.

### Still to verify on Android hardware

Successful packaging **does not** prove full interoperability. Test all 3 tabs, import/export of real models, chest protection weights and animation, BVH / Mixamo retargeting, export and reimport of GLB, and memory consumption on a 4 GB tablet. Realtime shared skeleton and morph targets across tabs are **not** implemented yet.

The integrated Android launcher is named **Phoenix Character Forge** and keeps the existing experimental Android package suffix `.suite` to avoid silently losing the local workspace from earlier suite builds. The separate original apps are untouched. Changing the displayed app name does not change the installed app's private data or make the underlying editors share a live scene.


## Synchronization update (27 Oct 2026)

The early three-tab APK launched each editor, but they did not agree on a single working GLB. The integration branch now implements an **active GLB workspace record**, a monotonically increasing revision number and a source-editor marker. This record is shared by the Android host between the Rig and Character WebViews.

- On first opening an editor it automatically imports the latest published GLB (up to 140 MiB).
- Selecting a GLB file manually in Rig or Character copies that source to the shared app-private workspace.
- After exporting a new GLB from an editor, the native bridge publishes that finished file as the new revision.
- Switching back to an editor that already has a model loaded does **not silently replace unsaved edits**; it shows a new revision and a button to import with explicit confirmation.
- Large GLB reads use a local WebViewAssetLoader HTTPS endpoint to avoid assembling megabytes of Base64 chunks. The old chunked method remains as a fallback.
- For **native Retarget**, a dialog offers to save a copy of the active GLB using Android SAF before opening Retarget; the user must still select it in the Retarget import screen. This is **not** full automatic native import.
- All editor state is still owned by each independent 3D engine. Bone positions, morph targets, keyframes and animation curves become shareable **only after the editor exports a new GLB**. Realtime common scene/rig editing is NOT implemented.

### CI verification

`.github/workflows/phoenix-sync-checks.yml` runs JavaScript syntax checks, Python integration smoke tests and builds the Kotlin/native bridge with minimal placeholder HTML assets. A successful **build-only** APK from that job should not be distributed as the real v7.6 combined app. The real user-supplied Rig v7.6 APK is fetched from the fixed tagged GitHub Release by the separate full build workflow and checked against its SHA-256.

### How to verify on the device

1. Open Rig and load a small GLB.
2. Export a new GLB after fitting its skeleton. Confirm active revision increments.
3. Open Character: the latest GLB should import automatically; add an accessory and export another GLB.
4. Switch back to Rig: the new revision should be announced; use **Загрузить новую версию** and confirm.
5. Open Retarget: use **Сохранить и открыть**, pick a location using Android, then import the same GLB from that location in Retarget.
6. Verify bones, weights, facial morphs and animations after each GLB export/import. Don't claim a full sync if any component is missing.

If switching modules produces frame desynchronization **within playback** (rather than differing project files), that is a distinct timing/retargeting bug and requires a reproduction with an animation/model pair.


## App identity

The installed launcher reads **Phoenix Character Forge** (PCF). Within the app the three modules remain **Rig & Animation** (based on the user's exact v7.6 Chest Guard APK), **Retarget**, and **Character**. The title shown in the staged Rig HTML and the Character HTML is also **Phoenix Character Forge**, while the underlying working models and Rig 7.6 controls are kept unchanged. The Android application ID remains the existing integration package suffix `.suite` for compatibility with stored GLB files.


## NEW: Geometry Optimization and Bone Volume inspector (prototype)

Added as a fourth **Optimize / Оптимизация** tab in the same Phoenix Character Forge Android integration. It is a separate local **Three.js + Vite** editor bundled at \`app/src/main/assets/studio/optimize\`, opened by native WebView and connected to the existing shared GLB workspace.

**Functions implemented:**
- GLB import through Android picker or active GLB workspace; visual model orbit/zoom.
- Mesh picker with live per-mesh and total vertex/triangle counts, skin/bone counts and number of animations.
- Presets 5,000 / 10,000 / 20,000 / 40,000 / custom triangles.
- Conservative **vertex clustering simplifier**; UV protection, hard-normal and bone influence signatures; rebuilds skin joints and weights for up to 4 nonzero influences and normalizes to 1. Skips morph-target meshes and meshes with multiple material groups or unsupported vertex attributes. The target is *best effort*, **not** the same proprietary Tripo remeshing algorithm and not guaranteed to produce production-quality edge loops.
- Transparent/wireframe **bone capsules** drawn from inverse bind matrices around bone segments. Adjustable global radius. Mesh choice supports body/garment inspection separately; a selected bone's influential vertices may be highlighted in the bind pose.
- Optional user-approved **capsule-aware skin attenuation**; original weights farther from each capsule are smoothly reduced and renormalized. It does not create a new perfect autore rig, cannot repair every wrongly weighted garment and is OFF by default. Good existing Meshy weights should not be automatically replaced.
- True before/after **3D preview, Apply, Cancel preview, Restore original**, then GLB export under a NEW filename, including rigging, materials and any GLB animation clips that can be serialized.
- Node tests prove no direct mutation of the source geometry, preservation of normalized 4-weight skinning in the sample, morph-safety rejection, and guarded capsule-weight edits.

**Limitations and quality gates:**
- *Decimation* (clustering) is not true human-aware retopology; some models may not reach 20k with seam protection. Original model is preserved, user must preview and explicitly apply. Always verify clothes, UV and skeleton on the target device before game export.
- Capsules are an **editable weight-influence visual guide**, **not proof that Tripo internally uses this algorithm**; bone influences naturally overlap at joints and require blends rather than a hard cutoff.
- Initial UI processes a selected mesh at a time, not all character meshes atomically, and protects facial blendshape geometry by skipping its topology changes.
- Heavy GLBs on an Android 4GB tablet should be tested carefully; runtime performance and true synchronization between editors cannot be guaranteed from passing CI tests.
- The native build is tested by CI with **placeholder Rig and Character assets**; the real unified APK requires the one-time pinned GitHub Release asset containing exact v7.6 Chest Guard APK.

Source under \`integration/optimizer/\`, tests in \`integration/optimizer/mesh-tools.test.js\`; workflows build the optimizer and verify the native integration. Original repositories and your working Rig v7.6 APK remain untouched.


## Forge 7.7 test — selected body mesh + animation donor (28 Oct 2026)

The unified build uses Character Studio source branch `feature/forge77-anatomy-skin-and-sync-20261028`, branched from `fix/anatomical-anchors-and-skinning`, **not from the old Character 0.1 prototype**. It preserves anatomically placed Woman bones and adds:

- A selectable **anatomical body SkinnedMesh**. Clothing, shoes, hair and accessories stored in separate skinned meshes are excluded from breast-weight edits. Ambiguous meshes are not auto-selected.
- Additional torso-bone weight and left/right body-region checks for newly created breast influences, on top of existing anatomical position masks. Existing weights and animation are kept unless explicitly edited.
- A **GLB animation donor** import button: only directly compatible core skeleton names, parent relationships and local rest orientations are accepted. Different skeletons still require real retargeting; this is a compatibility gate, not a universal solution.
- Body selection and animation donors saved in editable `.pcs` project files.

The Optimizer tab still offers bind-pose capsules, a conservative skin-weight preview, and opt-in repairs. Real-time synchronized scene state remains unimplemented: GLB is the exchange format, and native Retarget still requires Android SAF import after explicit export. If body and garments are fused into **one** mesh, neither name recognition nor torso masks can guarantee separation; split geometry or paint a semantic mask before applying weights.

**Testing:** Character unit tests, web build, and Android workflow; integration smoke tests; exact v7.6 APK SHA; full APK signing/zipalign on release run. Device-only requirements: test female walking/squats, breast/shoulder deformation, skirt sleeves, switching tabs after exporting, and preserving GLB animations/morphs.
