# Animated Bezier mask validation — 26 October 2026

- 65 TypeScript tests pass: persistence/migration, cubic subdivision, topology/range rejection, linear/hold paths, scalar easing/clamping, atomic history, locking, mask ordering, split/trim sample preservation.
- 19 Rust tests pass, including v5 mask serialization/file reopen, v4 defaults, invalid geometry/topology/keys and nonvisual mask rejection.
- Eight browser cases pass: two new mask cases and six GPU/parenting/layer timeline regressions. Real UI exercises presets, pen, tangent dragging, auto-keyed path/feather, undo/redo, project reopen and PNG export.
- GPU/Canvas combination pixels match exactly. Animated transformed masks at frames 0/30/59 have RGBA MAE 0.000273438 / 0.000247396 / 0.000338542 out of 255. All 60 rendered PNGs are byte-identical after reopening. Coverage resources in this sample use 2,570,400 bytes and release to zero at disposal.
- Native CLI H.264/AAC encode passes: 320×180, 30 fps, 60 frames, two seconds, audio RMS zero. Decoded RGB MAE at frames 0/30/59 is 0.144462 / 0.148490 / 0.191389.
- Production TypeScript/Vite build and workspace Clippy pass. Vite reports a >500 kB bundle warning; no build error.

Refreshed Windows binary/native UI smoke passed: launched the embedded build, opened BEZIER_MASK_TEST.supp through the native picker, observed transformed feathered coverage and the subtractive hole, selected the mask layer to show editable paths/tangents, sought to frame 30 and observed changed geometry/expansion, then saved through native persistence. The saved file retains schema v5, two masks, two path keys and two expansion keys. Prior native parenting acceptance remains recorded in VALIDATION_PARENTING.md.

Evidence: ../verification/masks. Tests are Chromium/SwiftShader plus the stated native checks; physical-GPU, long-media, 4K/large-feather and cross-platform release certification remain open.
