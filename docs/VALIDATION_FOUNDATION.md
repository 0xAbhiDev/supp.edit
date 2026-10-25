# Foundation validation — 25 October 2026

## Automated checks

- 54 TypeScript tests: previous animation/editing tests plus composition migration, scoped history, cycles, mixed-rate timing, audio-solo visibility, removed-scope recovery, AI result validation, stale Apply rejection, privacy consent binding and job lifecycle.
- 10 Rust tests: project validation/migration, composition/transcript roundtrip, media tests, nested audio timing/source offsets/gain and ancestor mute/solo.
- Strict TypeScript and production Vite build; workspace Clippy with warnings denied.
- All 18 Chromium integration cases passed. Four foundation cases exercise AI captions, composition commands/animation/history, nested render/reopen parity and a bounded 1080p profile. Targeted caption/composition UI tests were rerun after final edge-case fixes.
- The first targeted caption rerun timed out loading the development page before interaction while the native build was running. An isolated rerun passed in 48.7 seconds; no application error was reported. The final keyboard-scoping correction uses the active composition rate for one-second stepping and was checked by the production build.
- GPU/Canvas comparison of the two-level sample at frames 0/30/59: RGBA mean absolute error 0.2969 / 0.3136 / 0.3018 out of 255; WebGL2 without fallback. All 60 PNG frames are byte-identical after save/reopen.
- Native CLI MP4: H.264/AAC, 320×180, 30 fps, 60 frames, 2 seconds. Decoded RGB errors 2.8650 / 3.0328 / 3.4634 out of 255. Source AAC is silent; decoded output RMS is zero. Nested audible timing/gain is separately covered by native unit tests.

## Performance boundary

Headless ANGLE/SwiftShader software renderer: ten root visual layers including one nested title, real MP4, animated shapes, simple masks and existing blur/color effects at 1920×1080. Fifteen sequential renders averaged 3,438 ms/frame (range 2,851–3,993 ms). This is not real-time playback or a physical GPU benchmark.

Composition surfaces: 8,294,400 bytes; source textures: 27,266,672; frame cache: 31,104,000. Rendering an empty graph released all composition surfaces. These counters exclude driver/webview allocations. A two-second playback probe was shorter than a rendered frame, so its displayed dropped-frame value is inconclusive.

## Native packaged acceptance

The pre-final-fix foundation executable launched and rendered the nested real-footage/title/shape sample in the native monitor. Computer Use was stopped with the physical Escape key before final open/play/save/reopen/export and AI UI checks. No further UI automation was performed. The refreshed binary is built, but its complete native UI acceptance remains pending. Browser workflows and native CLI encoding do not substitute for that check. Earlier animation UI evidence remains in VALIDATION_ANIMATION.md.

## Evidence and gaps

../verification/foundation contains COMPOSITION_FOUNDATION_TEST.supp, source footage, rendered MP4, screenshots and measurement reports. It covers only implemented nesting, animation, masks and basic effects. No full COMPOSITOR_STRESS_TEST or Photo acceptance is claimed.

Physical-GPU performance, long/VFR/4K media, native export cancellation during finalization, broad codecs, installer/signing and other operating systems remain unverified. Cloud and model inference have no executor to test. Current captions run locally without network access.

Historical records: VALIDATION_ANIMATION.md and VALIDATION_GPU.md.
