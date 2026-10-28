# Current state — animated Bezier masks, 26 October 2026

Continuous implementation from parenting checkpoint ced8c81. This is a subsystem checkpoint; the complete creative suite remains under development.

## Delivered

- Schema v5 reads v1–v5 and adds up to 32 ordered Bezier masks per visual layer. Closed paths use stable vertex IDs, normalized coordinates and relative cubic tangents. TypeScript and Rust validate ranges, topology, duplicate keys and nonvisual targets.
- Add/subtract/intersect/difference combinations, inversion, opacity, feather and positive/negative expansion. Shared Canvas path coverage uploads directly to GPU; Canvas fallback uses the same coverage. Nested scenes and affine transforms use the containing composition's coordinates.
- Inspector presets and pen paths; Composite vertex/tangent dragging; numeric points/handles; exact De Casteljau insertion, corner/smooth conversion, deletion and mask order. Pointer gestures commit once through ordinary history, with cancellation on context changes.
- Animated mask paths use linear/hold interpolation with matching topology. Feather/expansion/opacity use the existing eight-mode scalar evaluator. UI can add/remove keys, change path easing and clear path animation while preserving the displayed shape. Editing animated values auto-keys. Split and trim preserve original samples.
- Bounded coverage cache (64 MiB, eight entries), working-surface checks before allocation, explicit errors for oversized masks. Export never silently downsamples. Editor outlines are absent from exported frames.

## Validation

65 TypeScript tests, 19 Rust tests, eight focused browser cases, production TypeScript/Vite build and Clippy with warnings denied pass. Browser coverage includes real pen/handle editing, animation, undo/redo, save/reopen, PNG export, combinations, inversion, feather, expansion, prior GPU/context-loss behavior, parenting and the thousand-layer timeline.

The animated mask sample renders 60 identical PNGs before/after reopening. Untransformed combination GPU/Canvas differences are zero; animated transformed RGBA MAE is 0.000247–0.000339 out of 255. Native H.264/AAC encode: 320×180, 30 fps, 60 frames, two seconds, silent audio, sampled decoded RGB MAE 0.144462–0.191389. Native UI smoke status is recorded in docs/VALIDATION.md.

## Active work and limits

Next active subsystem is alpha/luma track mattes and blend modes, followed by ordered effect stacks and adjustment layers. Current render ordering retains effects before masks; the ordered-effect subsystem must make the target ordering explicit. No full COMPOSITOR_STRESS_TEST or real-time/4K certification is claimed.

Mask paths are closed, with one contour per mask. Multiple masks provide holes/combinations. Path topology changes require clearing path animation. Per-vertex feather, tracking/roto propagation and arbitrary open strokes are not implemented. Scalar mask keys use the existing evaluator but are not yet exposed as editable graph lanes. Live dragging previews the path outline; image coverage updates at gesture commit.

Layer timeline core and affine parenting/Null controllers are delivered; multi-layer gestures, expanded property lanes and canvas scale/rotation/anchor handles remain partial. Photo and the broader color/audio/RAW/3D/plugin/release specification continue after compositor foundations.

AI Studio remains a real local SRT-to-caption workflow and provider/model/operation/job/privacy architecture. Inference, remote transport, installation and secure OS credentials are not yet implemented. No fake AI execution, automatic model download or silent media upload exists.

Current launcher: bin/supp-edit-compositor.exe. Evidence: ../verification/masks and ../verification/parenting. Earlier checkpoints: docs/HISTORY_PARENTING.md and docs/HISTORY_FOUNDATION.md.
