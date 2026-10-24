# Current state — animation foundation, 24 October 2026

Continued from commit `272c555` in the existing repository. This cycle completes the extended numeric animation and graph editor slice. The entire compositor/effects/photo milestone remains open.

## Delivered this cycle

- Shared evaluator and metadata for 17 channels: X/Y, uniform and separate X/Y scale, rotation, anchor X/Y, opacity, four crop edges, Gaussian blur, brightness, contrast and saturation. Both renderers and frame export resolve the same values.
- Hold, Linear, Ease In, Ease Out, legacy Ease In/Out, Bezier, Auto Bezier and Continuous Bezier. Cubic time inversion, monotone automatic tangents, linked continuous tangent editing, numeric domain limits and immutable sort caching.
- Composite now has a functional value/signed-speed graph editor. Multi-property display; Shift key selection; key/tangent drag; numeric edits; animation enable/disable; add/remove; previous/next; copy/paste/duplicate; zoom, middle-drag pan, snapping and fit all/selection. Edits use structural undo/redo; colliding moves/pastes reject atomically. Speed curves are inspected here; tangent editing is in Value view.
- Schema v2 migrates v1 without writing the original, with matching TypeScript/Rust validation and fixtures. Old projects remain readable. Out-of-range keys survive source edits to preserve interpolation.
- Curve generation timing is shown in the panel; evaluator/cache counters appear in diagnostics. Playhead updates change the graph cursor directly and only the small transport readout subscribes to the clock.

## Verification

Baseline: launched the prior Windows build; imported MDN’s real flower MP4, played, saved/reopened and visually inspected the browser and decoded export. Five NLE regressions and five native encodes passed with real footage. Source AAC is silent (-91 dB); output silence was explicitly checked. Headless 1080p playback dropped frames under concurrent software-rendering load.

Current checks: 39 TypeScript tests, seven Rust tests, strict TypeScript/Vite production build, and workspace Clippy with warnings denied. Browser regression coverage has 14 cases including graph interactions and repeated animation export. Animated GPU/CPU RGB MAE is 1.05–1.22/255 in three sampled frames. The real-MP4 sample includes text, animated position/axis scale/rotation/anchor, Bezier easing, ellipse mask, animated blur/color and crop. Save/reopen produces all 60 identical PNG frames. Both native H.264/AAC encodes pass dimensions, count, audio and first/middle/last decoded-frame checks (MAE 1.27–2.66/255).

Native Windows UI: real project open, playback, Composite curves, save/reopen and MP4 destination/export were exercised. The 60-frame native UI export passes sampled RGB comparisons (1.41–2.99/255). Fixed a pre-existing Rust-null/TypeScript-optional asset ID incompatibility exposed by recovery of generated layers. The latest launcher selects bin/supp-edit-animation.exe. Sample project, source footage, both repeat exports, native UI export and reports are in ../verification/animation. Historical records are linked separately below.

## Exact remaining scope from the new brief

Composition/layer/precomp models and nesting; adjustment/null layers and parenting; a composition layer timeline with ordering/precompose; bounding-box scale/rotation/anchor canvas handles; multiple Bezier masks and path animation, mask feather/expansion/opacity animation; alpha/luma mattes; 17 blend modes; ordered effect stacks, expanded effects and RGB curves/search; independent Photo documents and layer groups, brushes, selections, fills, layer masks and adjustments. The requested nested/blended MP4 and Photo PNG acceptance samples cannot exist until those features are implemented. No such controls or completed samples are claimed.

Animation-specific boundaries: scalar channels only, whole-frame timing, no spatial/path/expression animation, no marquee key selection, speed view displays signed velocity, tangent drags commit to the monitor on release. Very large curve selections have not been performance-certified. Native export still uses browser-decoded frames and FFmpeg libx264, and the general prior release limitations remain.

Previous milestone: [GPU/media history](docs/HISTORY_GPU.md). Current roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).
