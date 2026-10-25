# Parenting and layer timeline validation — 26 October 2026

- 59 TypeScript tests and 17 Rust tests pass. Native tests exercise v1–v4 migration, affine/shear roundtrip, missing/self/cyclic/cross-scope parenting, audio rejection and the exact 64-link boundary.
- Strict TypeScript/Vite production build and workspace Clippy with warnings denied pass.
- Four browser cases passed for existing GPU transforms/masks/effects/context-loss/resolution, parenting UI, animation/undo/reopen/PNG, and 60-frame hierarchy rendering. GPU/Canvas errors at frames 0/30/59 are 0.166875, 0.163746 and 0.166875 out of 255.
- All 60 frames are byte-identical after serialization/reopening. Null outlines are editor overlays and excluded from rendered output.
- Native CLI MP4 passes: H.264/AAC, 320×180, 30 fps, 60 frames, 2 seconds, audio RMS zero. Sampled decoded RGB errors are 0.295168, 0.302095 and 0.317251 out of 255.
- Both layer timeline browser tests pass: In/Out, pointer movement, snapping toggle, track lock, ordering, split/duplicate, undo/reopen, graph navigation and a thousand-layer viewport. The first run exposed a React scroll event lifetime error; the handler now captures values before the deferred update.
- The earlier 1080p SwiftShader profile averaged 3.44 seconds/frame; this checkpoint does not establish real-time performance. Affine rendering was tested at 320×180.

Native Windows validation passed on the refreshed compositor executable: launched, opened the v4 parenting project through the native file picker, rendered the sheared hierarchy, opened the layer timeline, selected the Root controller and displayed its editor outline, then sought to frame 30 and observed the animated child and controller move. Native export validation uses the CLI above; this does not claim an export-dialog acceptance test.

Evidence: ../verification/parenting. Historical results: VALIDATION_FOUNDATION.md, VALIDATION_ANIMATION.md and VALIDATION_GPU.md. Full advanced compositor/Photo samples, physical-GPU/long-media/cross-platform testing and production release certification remain open.
