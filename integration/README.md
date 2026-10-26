# Phoenix Unified Studio — integration branch (experimental)

**Target:** ONE installable Android APK containing three editors:
- **Rig Animation Studio**, copied and built from `RayZenGreallyzzz/mesh2motion-app`, Android branch `android-rig-animation-studio`.
- **Anim Retarget**, Kotlin source from THIS repository's `payload/AnimRetargetAndroid_sources.b64`, with existing BVH hotfix.
- **Phoenix Character Studio**, built from `RayZenGreallyzzz/Character-Studio`, branch `main`.

All three ORIGINAL repositories and their `main` branches remain untouched. This branch contains an automated integration layer, not an overwrite of a working app.

## Build on Android through GitHub Actions

1. Open Actions in `RayZenGreallyzzz/AnimRetargetAndroid`.
2. Choose **Phoenix Unified Studio (integration test)**.
3. Run on branch `integration/phoenix-character-suite` using `rig_ref=android-rig-animation-studio` and `character_ref=main`.
4. If successful, download artifact `PhoenixUnifiedStudio-test-APK`; source revisions are recorded in another artifact.

The workflow builds static Three.js/Vite assets for the two web modules, extracts the original Retarget Android Kotlin source, injects two **offline, HTTPS-origin WebViews** and a new native launcher, then compiles **one APK** using Gradle. It does NOT upload models to servers.

## Rig Animation Studio v7.5 requirement

**Important: v7.5 has NOT been conclusively mapped to an immutable SHA/tag in the source GitHub repository.** `android-rig-animation-studio` is the dedicated Android branch, not proof of being exactly v7.5. The workflow records the actual commit SHA used. Before calling this a 7.5 release, identify the confirmed v7.5 source ref and build against it. Never silently substitute an unidentified branch and claim it is 7.5.

## Known limitations / not yet promised

- First integration objective is a single APK with three selectable editors, **not** automatic transfer of a shared live skeleton or in-memory meshes between them.
- The two embedded WebViews currently allow file import through Android's file chooser; their existing exports may rely on Capacitor bridge features and may **not** work yet in the generic WebView wrapper.
- Rigging, retargeting, auto-weights, BVH, morph targets, secondary physics, and final GLB export MUST be tested on real models after an APK build. No successful integrated build has been verified at authoring time.
- Some third-party Three.js/Retarget modules may require adapted native file exchange; do not overwrite the original source while solving this.
- Source code is copied from the two GitHub repositories during each integration workflow run; only integration code and a pinned provenance record live in this integration branch.

## Files

- `.github/workflows/phoenix-unified-apk.yml`: three-source Android CI.
- `integration/inject_suite.py`: local source integration, manifest alteration, native entrypoint.
- `hotfix/retarget_math_hotfix.py`: existing BVH hotfix applied during build.

## Next stage

Implement unified file storage and a shared GLB/GLTF scene contract: Rig -> Retarget -> Character Studio. Then extend to rigged hair, face, ears, tails, wings and facial morph animation while retaining original working components.
