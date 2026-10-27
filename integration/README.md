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

The binary provided in chat is **not published in this GitHub repository**, so the CI cannot download it automatically. To rebuild reproducibly, upload the exact APK to a GitHub Release as an asset (or another HTTPS-accessible location) and provide its URL when manually starting the workflow. The script verifies its SHA-256 and refuses any other file.

## Unified APK architecture

- Rig 7.6 is the *default screen* with its unchanged core 3D workflow. Added tabs: **Rig and animation**, **Retargeting**, **Character**, **Shared GLB**.
- Character Studio web build is copied from `RayZenGreallyzzz/Character-Studio`.
- Kotlin Anim Retarget source is restored from this repository's existing payload and uses the existing BVH hotfix.
- The native offline WebView shell includes a file chooser and chunked private GLB workspace, and keeps the Rig view in memory when opening Character.
- Retargeting currently opens the native activity and uses Android files for transfer, not a shared live mesh/scene.
- Source APK files are copied out of `assets/public` without changing the bundled javascript, css, rigging algorithms, or reference models. A small navigation script is injected into `create.html` during staging.

## Build via GitHub Actions

1. Upload the exact **Rig-Animation-Studio-v7.6-Chest-Guard-test.apk** to a GitHub release.
2. Open this repo's **Actions** → **Phoenix Character Forge — Rig Studio 7.6 APK**.
3. Select branch `integration/phoenix-character-suite`, choose **Run workflow**, and paste the APK HTTPS asset download link as `rig_apk_url`.
4. Download the `PhoenixUnifiedStudio-test-APK` artifact after successful Gradle compilation.

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

`.github/workflows/phoenix-sync-checks.yml` runs JavaScript syntax checks, Python integration smoke tests and builds the Kotlin/native bridge with minimal placeholder HTML assets. A successful **build-only** APK from that job should not be distributed as the real v7.6 combined app. The real user-supplied Rig v7.6 APK is required by the separate release build workflow and is checked against its SHA-256.

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
