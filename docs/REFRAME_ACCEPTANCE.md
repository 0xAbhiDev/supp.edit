# Native editable portrait acceptance

Passed 2 November 2026 on Windows, embedded Tauri/WebView2 application. Scope: supported seven-shot gym sequence, normal layer transforms and local installed detector. This is not general identity tracking certification.

## Native flow

1. Open the existing twice-revised 600-frame sequence in a 1920×1080 test project.
2. Request “Make this vertical and keep me centered.” Smooth mode. Actual native dense sampling completes all seven source ranges.
3. Play the proposed 1080×1920 portrait through frame 599. Apply a separate portrait copy, Undo, Redo, save the resulting graph.
4. In normal Edit workspace select the first deadlift shot. Inspector shows generated Position X/Y and Scale key diamonds. Change first Position X from 189.08830378666667 to 249.088. The athlete visibly shifts right. Base transform stays intact; the animation key is the override.
5. Save, fully exit the app, relaunch, reopen and inspect the same key. Resave and compare all compositions deeply: exact equality. Only that first X key differs from the generated graph.
6. Native Deliver exports the reopened sequence as `test-results/reframe/NATIVE_MANUAL.mp4` in approximately 131 seconds.

## Decoded evidence

- 1080×1920, H.264 video, AAC audio, 20 seconds, 600 expected and decoded frames.
- FFmpeg error-strict decoding succeeds. Zero entirely black frames; minimum downsampled RGB frame mean 0.22296408. Audio RMS 0.02189297.
- Frame 0 mean absolute RGB error: 1.53405/255 against the manually edited compositor reference, 19.65046/255 against the original framing.
- Frame 10: edited error 1.48538, unedited 13.45676. At the unchanged next key (frame 21) both references agree, error 1.47310. Middle/end edited-reference error 1.44338/1.23433.
- Beginning, middle, end and both sides of several cuts were visually inspected. Athletes remain visible; portrait conversion retains letterboxing where a full-height crop would exclude wide poses. Existing source-edge cropping cannot be recovered by a transform.

Reports: `test-results/reframe/native-manual-verification.json`, `all-frames-verification.json`, `verification.json`. Saved files: `NATIVE_BEFORE_MANUAL.supp`, `NATIVE_LANDSCAPE.supp` (after manual save), `NATIVE_MANUAL.supp`, `NATIVE_MANUAL_REOPENED.supp`. Contact sheet: `contact-sheet.png`; decoded native first frame: `native-manual-first.png`. Local scripts: `scripts/reframe-references.mjs`, `scripts/verify-native-portrait.mjs`.

## Automated coverage and limits

Sixteen focused tests cover strict evidence bounds/order, genuine native gym detections, source/range staleness, dependency rejection, separate-copy IDs, exact Undo/Redo/save parsing, ordinary manual keys, reduction tolerance, controlled pixel translations, duplicated two-person footage, occlusion, edges, low confidence, brief misses, stationary jitter, rapid ambiguous displacement and NaN/Infinity rejection. Actual stress-case paths retain >94% of associated person-box width/height and <54 px single-frame horizontal movement at 1080 width. Missing/ambiguous subjects hold their last position instead of randomly selecting a distant bystander.

The two-person fixture duplicates licensed real footage under controlled transforms. Natural independent subjects crossing, prolonged occlusion and re-identification are not certified. White-shirt selection is a disclosed bright-neutral torso pixel heuristic. Rotation/crop/parent/matte dependencies and other visual overlays during canvas resizing reject until explicitly supported.

Browser acceptance separately passes real cached evidence → Preview → Apply → Undo/Redo → manual Inspector key change → Save → close page → reopen → exact graph equality. Long frame export is separate from UI acceptance and disables Vite HMR; it no longer couples a hot-reload navigation to the UI test result.

Existing native rough-cut and two-revision acceptance remain valid. Aesthetic finishing, actual editable time remapping, new grain/grade/audio controls and the exact 25-second aesthetic prompt are the next milestone, not claims of this checkpoint.
