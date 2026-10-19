# Validation record — 19 October 2026

This records observed checks, not a claim of production certification.

## Passed

- Strict TypeScript, including unused-local/parameter checks, and production Vite frontend build.
- 16 TypeScript unit tests: project round-trips, native/TS contract fixture, unknown versions, graph references, duplicate IDs, source bounds, rational-rate timecode, split/trim/move/delete rules, locked tracks, ripple behavior, undo/redo, animation interpolation, and continuity across edits.
- 4 Rust unit tests: invalid media extensions, unknown project versions, atomic file replacement, save/read and backup recovery.
- `cargo check --workspace` and `cargo clippy --workspace --all-targets -- -D warnings`.
- Windows native build with Rust 1.90 / Tauri 2. The delivery executable embeds the production frontend using `tauri/custom-protocol`.
- Windows startup smoke check: the embedded executable launched without a Vite dependency, created a window titled `supp.edit`, and remained responsive. This is process/window health evidence, not a complete native interaction test.
- Three Chromium/Playwright integrations: real media import and timeline editing; title/effects/keyframes/masks; project download/reopen and IndexedDB recovery; pixel-level compositing; mixed video/image/title/audio frame generation after graph serialization.
- Native FFprobe ingestion of a 3-second 640×360 H.264/AAC MP4, a PNG image, and a 48 kHz PCM WAV. Real dimensions, frame rate, duration and stream flags were returned.
- Native FFmpeg encoding of actual frontend-generated frames. The mixed-media test includes trimmed video, image overlay, ellipse mask, color adjustments, blur, animated text, and audio gain/delay.
- The final probe and encoding checks used FFmpeg / FFprobe **9.0.2 essentials**. The Windows setup downloaded the publisher's GitHub mirror and verified the ZIP against the publisher SHA-256: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.
- npm dependency audit after upgrading Vitest: **0 known vulnerabilities** across the resolved production/development dependency graph at audit time.

## Observed mixed-media output

| Check                                                      | Result                |
| ---------------------------------------------------------- | --------------------- |
| Encoded frames                                             | 60 / 60               |
| Dimensions                                                 | 320 × 180             |
| Duration                                                   | 2.000 seconds         |
| Video / audio                                              | H.264 / AAC           |
| Mean absolute decoded RGB error vs source compositor frame | 3.606 / 255           |
| Decoded mixed audio RMS                                    | 0.023921 (non-silent) |

The source media is synthetic FFmpeg test footage and tones, not a user project. No sample media is preloaded into the application.

## Remaining validation gaps

- Native Windows file-dialog interactions were not automated: the computer-use runtime was unavailable. The Rust path and processing modules were exercised directly, and the shared UI was exercised in Chromium. Native WebView2 codec/CSP/IPC behavior still needs a complete human desktop acceptance pass.
- macOS/Linux build and runtime verification, installer testing, signing/notarization, updates, security review, a full RustSec/transitive license audit, accessibility audit and long-duration/large-project performance testing remain release gates.
- GPU acceleration, proxies, sample-accurate audio sync, HDR/OCIO, RAW, full photo tools, AI execution, 3D, plugins, and collaboration are not implemented and were not counted as tested features.

The first browser run timed out while an unconstrained initial native compilation exhausted available memory. Build concurrency is now capped at two. Subsequent isolated browser runs passed. Test fixtures read saved project files instead of relying on hot-reloaded module singleton state.
