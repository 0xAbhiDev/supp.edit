# Render engine — composition foundation

## Implemented slice

Schema v4 adds Composition objects with ID, name, dimensions/rational rate/sRGB settings, duration, background, ordered tracks and layers. Composition clips reference those sources. Existing media (video/image), text and shape clips are reused. Null clips render no pixels and now drive child transforms through affine parenting; selection outlines are editor-only. Main-sequence representation is retained for compatibility.

Composition commands create sources, add instances, precompose, scope ordinary edits, and prevent deletion of referenced sources. Precompose requires an unlocked contiguous visual stack and all overlapping clips on affected tracks. It preserves local key times and source offsets. Scoped commands validate the canonical graph before History commits. Cycles, missing references, duplicate IDs, duration overruns and excessive depth fail atomically.

Composite has a source/layer panel, instance insertion, precompose, visibility/lock/solo/order, duplicate/split/delete and scoped Inspector/Graph Editor. Track controls affect all clips sharing a track. Layers/Graph views now include a virtualized layer timeline with drag/trim, timing fields, key summaries, parent links and ordinary commands; multi-layer gestures remain partial. Save and final export always use the main sequence.

## Render graph and timing

React requests frames; render-graph.ts expands active dependencies with distinct per-instance resource identities. Compositor prepares media and renders children first into reusable transparent surfaces. These become ordinary image/texture sources for the parent. Each source retains its own dimensions/rate/background and fits within the parent canvas before instance transforms.

Nested source time is `(parentFrame - start + sourceIn) / parentFPS * childFPS`. Fractional times survive source sampling and numeric animation. Half-open parent intervals trim child output. Preview and final frame export use the same graph.

All scopes share one WebGL2 context. Child results are copied to canvases before reusing it for the parent, avoiding one context per composition. gpu.ts owns textures/programs/framebuffers. resources.ts owns media/frame caching. Canvas2D is the system fallback, not a guaranteed exclusively CPU implementation. Context loss falls back. Strict export fails on unreadable sources.

Native audio traversal converts frames to seconds, clips against ancestor intervals, preserves offsets across mixed rates, adds gain and honors ancestor mute/solo/visibility. Delay is expressed in 48 kHz samples. The 128-audible-segment export limit includes nested instances. Preview remains a system-media/Web Audio transport, not sample-accurate audio synchronization.

## Current and target processing order

Current executable behavior preserves the earlier renderer: source timing/nested source → animated transform → Gaussian blur → brightness/contrast/saturation → crop/basic mask → opacity → normal source-over. CPU Canvas clipping/filter edges can differ; render tests use tolerances.

The target advanced pipeline remains source → timing → transform → masks → ordered effects → matte → opacity → blend → composition. Implement explicit nodes and update both backends together. Do not introduce workspace-specific rendering or CSS substitutes.

NOT STARTED: canvas scale/rotation/anchor handles, Bezier paths and animated mask properties, alpha/luma mattes, 17 blend modes, ordered effect descriptors/stacks/presets/search, expanded effects, RGB curves and adjustment layers. Photo documents/tools follow compositor completion. Layer timeline core is implemented; multi-selection drag and inline property expansion are still partial.

## Resource bounds

Project limits: 64 composition definitions, 16 levels, 100,000 total layers. Per-frame expansion additionally caps 256 composition instances and 256 MiB estimated composition surfaces. This bounds exponential instance reuse. Decoders cap at 24. Existing frame cache is 96 MiB/96 entries, GPU source textures 128 MiB/48, generated images 32 MiB/24, and scratch targets 256 MiB. These are individual limits, not one aggregate memory cap.

Unused composition surfaces are released on the next frame and all on disposal. Resized textures are replaced with correct byte accounting. Framebuffer size changes release previous targets. Other media/texture/frame resources remain in bounded LRUs. Oversized graphs fail explicitly or require reduced preview resolution; export never silently reduces resolution. Sustained real-time performance is not claimed.

## Verification boundary

Tests exercise scoped commands/history, migration, cycle prevention, mixed-rate timing, native composition/transcript roundtrips, nested audio timing/gain/mute, child animation UI, transparent GPU/Canvas parity, all 60 identical PNGs after reopen, and native encoding. The slice fixture is COMPOSITION_FOUNDATION_TEST.supp. It does not stand in for the full requested COMPOSITOR_STRESS_TEST.supp, which requires unfinished masks/mattes/blends/adjustments. Current measurements are recorded in CURRENT_STATE and docs/VALIDATION.

## Parenting

Each clip has optional parentId and parentOffset [a,b,c,d,e,f]. World = parentWorld × parentOffset × localTransform, then translate the composition center for canvas coordinates. Reparenting can preserve world appearance at the current frame by solving the affine offset; animation at other times remains responsive to the new parent. No decomposition loses shear. Parents evaluate at composition time regardless of visibility and do not pass opacity/effects to children. Both GPU geometry and inverse-space masks use the same matrices as Canvas2D. Parent references stay within a scope, are acyclic and have at most 64 links.
