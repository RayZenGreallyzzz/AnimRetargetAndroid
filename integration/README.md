# Phoenix Unified Studio — Rig v7.6 / Retarget / Character

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
2. Open this repo's **Actions** → **Phoenix Unified Studio — exact Rig Studio 7.6 APK**.
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

The locally produced first Rig 7.6 replacement APK uses a separate experimental application ID to avoid overwriting the earlier test suite. Android runtime tests are not yet available.
