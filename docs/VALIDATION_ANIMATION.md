# Animation validation — 24 October 2026

- 39 TypeScript tests and seven Rust tests, including all interpolation modes, cubic time inversion, monotonic auto tangents, continuous slope linking, commands, collisions, locks, history, split continuity, domain limits and v1/v2 migration.
- TypeScript and production Vite build pass; workspace Clippy passes with warnings denied.
- 14 browser cases cover existing editing, cache behavior, graph interactions, tangent edits, multi-selection/copy/paste/duplicate/delete, numeric editing, undo/redo, save/reopen, shader parity and export. One old locator required exact matching because Gaussian blur now has an adjacent keyframe button; the behavior was unchanged.
- The graph screenshot was visually reviewed for usable controls, plotted data and monitor output. Curve generation in that sample was about 2 ms; this is an observation, not large-project certification.
- Actual [MDN flower video](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video): 960×540 H.264, 29.97 fps; silent AAC. Baseline edit exports passed before implementation.
- Animation sample: 320×180, 30 fps, 60 frames. GPU/CPU MAE 1.161, 1.048, 1.222/255. All pre/post-reopen PNG frames are byte-identical. Both H.264/AAC outputs pass decoded frame comparisons (1.27–2.66/255). Headless GPU is SwiftShader; physical GPU performance is not inferred.
- Sample deliberately contains only implemented features: real MP4, animated title/position/scales/rotation/anchor/crop, Bezier, simple mask and animated blur/color. Nested compositions/blends and the Photo sample remain pending.

## Native packaged acceptance

The embedded Windows executable launches successfully. Windows Computer Use exercised native Open, real MP4 playback, Composite layer/graph display, Save, the MP4 Save As dialog and export completion. Native save preserves all Bezier handles, and reopening that native save restores the rendered sample. The 320×180/60-frame native UI export is H.264/AAC, 2 seconds, silence RMS 0, with decoded RGB MAE 1.412/1.986/2.989 against browser reference frames. This exposed and fixed legacy null asset IDs for generated layers; native serde now omits absent IDs and the frontend accepts legacy nulls. The 16-group browser control audit also passes.

Native dialogs now have a smoke check, but cancellation, all codecs, installer/signing, long/VFR/4K playback and other platforms remain unverified. Unavailable-tool notes in the archived record apply to the previous milestone. The new scalar animation subsystem does not complete composition nesting, advanced masks, mattes/blends, ordered effects or Photo.

---

Previous milestone results: [VALIDATION_GPU.md](VALIDATION_GPU.md).
