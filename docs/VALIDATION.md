# Validation record — 20 October 2026

Observed checks for the GPU/media and source-editing milestone. This is an unsigned Windows development build, not production certification.

## Passed

- Strict TypeScript and the production Vite frontend build, including the waveform worker bundle.
- 30 TypeScript tests: project/schema contracts, source bounds, structural commands, undo/redo, interpolation continuity, all six new NLE commands, LRU ownership/budgets, overlapping interval queries, 100,000-clip indexing, and saved-history identity.
- Six Rust tests: extension/version validation, atomic writes/backups, source cache fingerprint changes and protection of unrelated files during pruning.
- `cargo clippy --workspace --all-targets -- -D warnings` and the embedded Windows build using `tauri/custom-protocol`.
- 12 Chromium/Playwright integrations: imports, editing, masks/effects/keyframes, save/reopen/recovery, GPU/CPU pixels and context loss, full-resolution export despite reduced preview, video cache repeat seeks, actual-media relink/undo/reopen, direct ripple/roll/slip/slide dragging, source In/Out and insert/overwrite, and edit navigation.
- A separate 16-group browser control audit, with no page errors, covering typography, shapes, track controls, markers, zoom/snap, library controls, source preview, workspaces, preferences, fullscreen, PNG and palette actions. Reproduce with `node scripts/audit-ui.mjs` while a Vite server runs.
- Native FFprobe inspection and asynchronous thumbnail/waveform processing using FFmpeg 9.0.2. One cold combined thumbnail/waveform run measured 5,214 ms; a waveform cache hit measured 19 ms. It produced 400 nonzero bins (peak 0.1563). These are development-load observations, not guarantees.
- Real H.264/AAC encoding of six frontend-generated frame sets. Each graph was serialized before rendering. Verification decodes the first, middle, and final frames, checks dimensions/count, and checks decoded audio energy.

## Pixel and encoded output evidence

WebGL2 vs Canvas2D shape/effect mean RGB differences: transform 0.240, color 0.229, ellipse mask 0.175, rectangle mask 0.213, blur 0.196 on a 0–255 scale. Context loss selected Canvas2D with an explicit reason. Real video frame parity and returning to a cached source timestamp also pass. Headless Chromium used **SwiftShader software rendering**; these results verify shader behavior, not physical GPU speed or WebView2 performance.

| Encoded scenario                         | Frames | Duration | First-frame RGB MAE / 255 | Audio RMS |
| ---------------------------------------- | -----: | -------: | ------------------------: | --------: |
| Mixed video/image/title/mask/grade/audio |     60 |  2.000 s |                     3.572 |  0.023921 |
| Ripple trim                              |    100 |  3.333 s |                     3.328 |  0.092929 |
| Roll                                     |     90 |  3.000 s |                     3.328 |  0.092893 |
| Slip                                     |     90 |  3.000 s |                     3.329 |  0.092815 |
| Slide                                    |     90 |  3.000 s |                     3.328 |  0.092964 |
| Source insert/overwrite                  |    102 |  3.400 s |                     3.595 |  0.092994 |

All outputs are 320×180 H.264/AAC. Three sampled decoded frames per output remain below the verification threshold of 12/255. Test media is synthesized locally; it is never preloaded into a user's project.

## Native hardware evidence

DXGI reported Intel Iris Xe (128 MiB dedicated, approximately 7.9 GiB shared graphics memory) and a Microsoft software adapter. RAM: 15.8 GiB; logical CPUs: eight. Three-frame H.264 smoke probes passed for QSV encoding, QSV decoding and D3D11 decoding; NVENC, CUDA and AMF probes failed with missing-runtime diagnostics. The exporter still uses **libx264**, and system-webview hardware decoding is not exposed to the application. Advertised FFmpeg support and available hardware are shown separately.

## Remaining validation gates

Native Windows file-picker, save-dialog, IPC/export cancellation and WebView2 codec/CSP acceptance are not automated: the required Computer Use runtime is unavailable. Browser tests and direct Rust examples do not establish complete desktop interaction coverage. Startup process/window checks are reported separately below.

Installer/signing, macOS/Linux, sustained 4K/VFR/long-timeline performance, low-memory/corrupt-media stress, a full security/license audit and accessibility audit remain outstanding. No claim is made for native zero-copy GPU decode, proxies, sample-accurate audio, photo/RAW tools, graph editing, AI execution, 3D or plugins.

Earlier test runs exposed a Vite harness issue: direct imports created a separate editor-state singleton. New integration cases now read projects through the Save UI and reopen through the Open input, rather than relying on that singleton. The resulting 12-test suite passes.

## Current embedded Windows startup

The final `bin/supp-edit-gpu.exe` was launched through `npm run launch` after the production build. Process 7036 created a window titled `supp.edit` and reported `Responding = true`. The launch helper selected the updated executable and media-tool environment. A second process-health check also passed. This is a startup smoke check, not native dialog or IPC interaction certification. The final production frontend's source-monitor and diagnostics screenshots were inspected in Chromium.
