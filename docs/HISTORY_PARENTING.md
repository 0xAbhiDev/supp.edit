# Current state — parenting and layer timeline, 26 October 2026

Continuous implementation from 041a19f. This is a recovery checkpoint, not completion of the full product. Advanced masks are the active next subsystem.

## COMPLETE in this checkpoint

- Schema v4, reading versions 1–4 without rewriting originals. Same-scope visual parenting, missing/self/cycle checks and a 64-parent limit in TypeScript and Rust. Affine parent offsets preserve shear and current-frame appearance on reparent/unparent; no lossy transform decomposition.
- Shared animated parent transforms in GPU, Canvas2D, nested sources and export. Parents evaluate at composition time even outside visible intervals. Child opacity, visibility and effects stay independent. Nulls now act as controllers and show editor-only outlines/links.
- Inspector parent selection, keep-appearance option, child movement converted through the parent's coordinate basis, ordinary history/undo/redo. Every history boundary prevents dangling parent links. Controller deletion requires unparenting children; precompose requires a closed parent hierarchy.
- Composite Layers/Graph views. Layer rows, source offset, In/Out editing, draggable move/trim, seek/playhead/zoom/snap, track visibility/lock, parent navigation, reorder, duplicate/split/delete and keyframe summaries linking to graphs. Separate rows for clips sharing tracks; shared-track controls explicitly indicate their scope. Horizontal bar/key culling and vertical row virtualization.

## Validation

59 TypeScript tests; 17 Rust tests; strict TypeScript/Vite and Clippy with warnings denied. Parenting UI, GPU regression, every-frame reopen parity, controller animation and PNG export passed. Layer timeline regression covers timing/drag/locks/order/split/duplicate/reopen and a thousand-layer virtual viewport.

The 320×180 parent-chain sample has two controllers, rotated non-uniform scale, shear, animation, crop, ellipse mask and color. All 60 PNG frames match after reopen. GPU/Canvas RGBA error: 0.164–0.167/255. Native H.264/AAC encode: 60 frames, 30 fps, two seconds, silent audio, decoded RGB error 0.295–0.317/255.

Native packaged acceptance and exact run results are in docs/VALIDATION.md. Existing composition/AI foundation remains intact. Current launcher prefers bin/supp-edit-compositor.exe once built. Evidence is in ../verification/parenting.

## PARTIAL and active work

Layer timeline core is implemented; multi-layer drag/marquee selection and expanded inline property lanes are not yet implemented. Track switches remain shared on clips using one track. Reordering a shared-track clip extracts it above/below that track. Canvas controls currently support translation and controller overlays; scale/rotation/anchor handles are still to be added.

Active next subsystem: multiple Bezier masks, editable path points/tangents, feather/expansion/opacity and animation in the shared render pipeline, including commands, native persistence, preview/undo/export tests. Then mattes, blends, ordered effects and adjustment layers, followed by Photo and the remaining full product specification.

AI Studio currently executes local SRT captions with Preview/Apply/Undo. Providers, model registry, structured operations, jobs, safe context and privacy contracts exist. Inference, remote transport, model installation and OS credentials remain unimplemented; those follow mature edit/render foundations per the priority list.

No complete product, full COMPOSITOR_STRESS_TEST, real-time performance certification, or Photo acceptance is claimed. Prior foundation behavior and measurements are recorded in docs/HISTORY_FOUNDATION.md.
