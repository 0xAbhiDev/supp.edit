# Current state — composition and AI foundation, 25 October 2026

Continued from commit ebe3e89 in the existing repository. This session completes the nested-composition vertical slice and the requested AI Studio foundation. The full compositor and Photo milestone remains open.

## COMPLETE in this slice

- Schema v3 with nested composition definitions, per-source dimensions/rational frame rate/duration/background, reference validation, cycle/depth limits and v1/v2 migration. Native saves preserve compositions and timestamped transcripts.
- Create, instance and precompose commands; scoped Inspector/Graph Editor edits; shared undo/redo. Precompose preserves source timing and animation. Referenced sources cannot be deleted. Undoing composition creation safely returns editing to Main.
- Child-first rendering through the shared WebGL2/Canvas2D compositor with transparent reusable surfaces, per-instance media resources, mixed-rate timing and bounded expansion. Native MP4 audio recursively applies ancestor timing, gain, mute and solo. Soloing audio keeps video visible.
- AI provider, model manager, typed operations/results, immutable project-context interfaces, command plans, explicit local/cloud privacy contracts and native credential-store interface.
- Functional AI Studio: command input, context, model metadata, history, jobs, result preview, Apply and Undo. The only executor converts supplied SRT into real transcript data and caption text layers. Apply is one validated history command; stale previews are rejected.
- Shared bounded in-memory job queue used by captions and MP4 export. Real progress, cancellation and cooperative pause where supported. No inference, downloads, network transport or credential collection.

## PARTIAL

Composite has a source/layer panel with ordering, selection, visibility, lock, solo, duplicate, split, delete and precompose. Controls operate on tracks, including all clips on a shared track. The complete layer timeline remains unfinished. Null layers save and animate but have no parenting/controller behavior.

AI context has an active-composition adapter contract; the working caption path targets Main. Unsupported operations have typed contracts but no executors or Apply adapters. Job history is not crash persistent. Credential storage and cloud transport are interfaces, not implementations.

## Verification

54 TypeScript unit tests, 10 Rust tests, strict TypeScript/Vite production build and Clippy with warnings denied. All 18 Chromium integration cases passed; targeted composition/caption checks were rerun after final fixes.

The two-level real-footage sample renders 60 identical PNGs before/after reopen. Sampled GPU/Canvas RGBA MAE is 0.297–0.314/255. Native CLI H.264/AAC export is 320×180, 30 fps, 60 frames / 2 seconds; decoded RGB MAE is 2.87–3.46/255. The source AAC is silent and output silence is checked.

A 1080p ten-layer scene on headless SwiftShader averaged 3,438 ms/frame over 15 sequential renders: it is not real-time. Composition surfaces used 8.29 MB and returned to zero after rendering an empty graph; textures used 27.27 MB and the frame cache 31.10 MB. The short playback probe is inconclusive for steady-state dropped frames. Physical GPU and sustained-load certification remain pending.

Native Windows acceptance is recorded in docs/VALIDATION.md. Launcher: bin/supp-edit-foundation.exe. Sample and evidence: ../verification/foundation. Historical animation evidence is retained separately.

## NOT STARTED / exact next work

Next: parenting and Null controllers with full affine transform composition, cycle prevention and a proper composition layer timeline. Then canvas scale/rotation/anchor handles; multiple Bezier masks and animated feather/expansion/opacity/paths; alpha/luma mattes; 17 blend modes; ordered effect stacks, expanded effects, RGB curves and adjustment layers. Independent Photo documents, painting, selections and layer tools follow the compositor.

The requested COMPOSITOR_STRESS_TEST and Photo PNG acceptance samples require these missing subsystems. COMPOSITION_FOUNDATION_TEST is a smaller validated slice, not the full stress sample. AI inference, transcription, segmentation, tracking, external APIs, model installation and OS credential implementation remain deferred.

See AI_ARCHITECTURE.md, RENDER_ENGINE.md and docs/ROADMAP.md. Prior state: docs/HISTORY_ANIMATION.md.
