# Reference fidelity investigation — 16 November 2026

This is a verified engineering increment, **not acceptance of autonomous reference recreation**. The user's assessment of less than 30% similarity remains the baseline feedback. No calibrated overall similarity score has been established.

## Evidence and failure diagnosis

Local artifacts are under `test-results/fidelity-breakthrough`. The supplied WhatsApp videos ending in `54 AM.mp4` and `55 AM.mp4` are the references. Independent source assets are `work/vision/squat.webm` and `work/gym/{bench,deadlift,incline,row}.webm`; `music.wav` is the separately supplied music. The finished references remain in the media library for comparison and are excluded from exported graphs.

`scripts/inspect-reference-events.mjs` decodes each timeline at its sequence rate, maps each generated frame to its matched reference interval, and records reference times, active observations, authored text, masks, shots and color pulses. It samples each state change before/during/after, shot centers and quarter-second intervals even when OCR reports nothing. Contact sheets place reference on the left of each pair. `frames.json` identifies every sampled cell. This is a diagnostic, not a perceptual similarity score.

The initial diagnosis used 506 aligned frames / 214 sheet pairs for reference 54, 392 / 125 for reference 55, and 528 / 91 for the previously exported coastal case. These existing exports were inspected before changing the geometry and recognition paths.

| Visible baseline defect | Responsible stage | Evidence and corrective work |
| --- | --- | --- |
| Ref 54: YOU floats over the blurred margin while the reference positions it beside the athlete; lettering is too small | Planning and command execution | `54/before/events-108.jpg`. Reference coordinates were applied to the entire 9:16 canvas. Character-count fitting subtracted preset padding from an already measured box. Close Match now maps to the visible foreground picture and sizes the selected font's measured ink. |
| Ref 54: large WERE and other words absent; duplicate HERE appears in different positions | Analysis | Same sheet and the following text interval. Unrecognized or fragmented OCR cannot be restored by rendering changes. Missing words and duplicate observations remain unresolved. |
| Ref 55: large pink YOU / CANNOT / REASON absent | Analysis | `55/before/events-0.jpg` and `events-12.jpg`. Cast-aware complementary ink separation at two scales now corroborates these three exact words. No reference-specific words or timestamps are in the implementation. |
| Ref 55: script Tiger and partially occluded HONORABLE absent | Analysis | `55/before/events-12.jpg` and later sheets. Partial HON / RABLE observations are not accepted as a complete word. Ornate recognition remains a failure. |
| Intermediate REASON is hidden by the athlete although it is in front in the reference | Planning | `55/title-preview.jpg` and intermediate export. Forced behind-people mode put every title under a foreground copy. The new reference-depth option measures observed ink inside and outside a synchronized person contour; unresolved cases stay in front. It classifies REASON as front on this fixture. |
| Tiny foreground picture within a large blur field | Framing policy and source selection | Visible across both gym sheets. Preserving the complete wide source protects equipment but does not match reference composition. Subject-and-equipment-aware crop selection remains necessary. |
| Warm, bright source looks unlike the cool/green reference | Analysis and available treatment | Current luma/contrast/saturation/temperature matching lacks a green–magenta axis, selective tone curves and local lighting reconstruction. This remains approximate. |
| Reference has an aerial coastal viewpoint, output uses ground-level beach views | Source matching / available footage | `coastal/before/events-36.jpg`. Scene timing works; viewpoint and movement do not match. These old exports are fresh diagnostic evidence, not new acceptance of arbitrary travel styles. |
| Text appears correctly in a project but might disappear in MP4 | Rendering verification | New `--verify-titles` compares decoded output with the production compositor with/without each title at its midpoint. It checks only changed ink pixels; a whole-frame average cannot conceal an absent small word. |

## Implemented in this increment

Windows OCR retains up to 128 time-stamped normalized ink boxes and 32×16 observed glyph rows per text run. Completed word-build phrases update their own full box rather than inheriting the prefix's width. Dominant-cast separation complements brightness, grayscale and hue passes. The text cache is versioned `reference-text-v8`; old caches are not silently interpreted as new measurements.

Local font matching measures candidate installed fonts; its match score is a shape fit, not a probability of identifying the exact font. Measured ink dimensions/centers convert the reference boxes into ordinary text size, position and independent scale keys. Static measured text has no arbitrary preset fade/pop. Temporal measurements interpolate linearly; hidden original motion curves are not recovered. Captured builds can use corroborating vocal word timing. Manual wording revisions remeasure the chosen font before updating the preview.

The foreground picture transform includes contain-fit, aperture crop, parents and animated layer transforms. Lettering in Close Match follows that picture, with conservative portrait safe bounds. This fixes words positioned in blur margins. It does not solve the overly conservative wide-footage framing policy.

Reference-depth estimation requires repeated evidence: enough expected glyph ink on both sides of a synchronized person contour, retained ink outside, and substantial missing ink inside. Bounding-box overlap alone does not imply occlusion. The optional manual behind-people mode still uses editable foreground copies and masks. Auto depth produced no confident behind-subject title in these final gym plans; it must not be advertised as successful automatic reconstruction of the hidden ornate words.

All additions use the normal preview/history command boundary and schema-10 editable layers. Dense-mask batches validate their complete atomic result once. Model installation remains explicit, pinned by size/digest, and local. No media upload or external credentials were introduced.

## Reproducible checks

Use the saved projects `54/final/Three-modes.supp` and `55/final/Three-modes.supp`. Each contains all three modes. The `final` directory name identifies this iteration's evidence, not visual acceptance.

1. Native OCR: `target/debug/examples/reference_text.exe VIDEO`, with media environment from `scripts/runtime.mjs`.
2. Planning: `node scripts/plan-reference-fixture.mjs INVENTORY OUT --vertical --reference-depth --measure-fonts --text=CAPTURE.json`. It invokes actual font metrics, production planning, Apply/Undo/Redo, JSON validation and raw-asset checks.
3. Open the generated project in `bin/supp-edit.exe`, choose the desired sequence, inspect and export through Deliver.
4. Validate an existing native export: `node scripts/render-reference-sequence.mjs PROJECT OUT "Recreation · Close Match" --verify-existing`. This saves/loads through the native project parser, renders three comparison frames and decodes H.264/AAC.
5. Check each exported title: same command with `--verify-titles`.
6. Music alignment: `node scripts/compare-reference-edit.mjs OUT INVENTORY PLAN_DIR`. Checks correlation and lag near the beginning, middle and end.
7. Source/cut/frame scan: `node scripts/compare-reference-style.mjs PLAN_DIR PROJECT MOVIE "Close Match"` with the captured asset inventory in PLAN_DIR.
8. Aligned visual sheets: `node scripts/inspect-reference-events.mjs INVENTORY PLAN_DIR MOVIE EVIDENCE_DIR`.

Regression results for the implementation: 174 TypeScript tests, the browser three-mode Preview/Apply/title-revision/Undo/Redo/save/reopen acceptance, 41 native unit tests (4 export, 13 media, 24 project), frontend production build and Windows embedded-frontend build passed. Native builds were retried after a running OCR example temporarily locked its executable; no tests were disabled.

## Current fidelity assessment

| Attribute | Status |
| --- | --- |
| Independent raw footage; editable timeline; valid encoding | Verified on these fixtures |
| Shot boundaries in Close Match | Matches within frame quantization; eight detected intervals in 54, four in 55 |
| Source music timing | Zero measured lag in three correlation windows in the inspected Close Match exports; different source music does not recreate the reference soundtrack |
| Baked black borders / seams | Aperture fix and blur overscan implemented; full-frame scan required per output |
| Simple text geometry | Improved in Close Match; titles sit within footage and retain measured proportions |
| Words and complete lyrics | Partial; 54 has 16 accepted intervals, 55 has three; missing and duplicate observations remain |
| Font/ink appearance | Approximate installed-font match; texture, gradients, outlines and ornamental details are not reconstructed |
| Text event timing | Coarse 8 Hz OCR observations; visible onset/offset errors remain |
| Animation | Sampled positions/scales and some word builds; original easing, rotation, perspective and motion blur remain incomplete |
| Text behind subject | Manual editable masks work; automatic evidence is conservative and has not passed the difficult hidden-word case |
| Segmentation | Low-resolution outer contour; limbs/equipment/holes and fast motion remain unreliable |
| Framing and shot composition | Significant mismatch; wide source is protected but subject scale/viewpoint differs |
| Grading and atmosphere | Approximate scalar matching; distinctive green tint/lighting still fails |
| Diverse Instagram styles | Not accepted. Two gym fixtures and an older coastal workflow are the available evidence. |

Next work should refine OCR timing and missing-word evidence, improve source/crop selection with equipment protection, and add measured color-axis/tone reconstruction. The existing snapshots and failing comparison frames must remain available to judge those changes.

## Export and persistence evidence

All paths below are relative to `test-results/fidelity-breakthrough`. Each listed export decodes every frame with audible AAC, contains only permitted raw footage/music, and has zero detected black frames or dark side bars. The error is the largest RGB mean absolute error among first/middle/last decoded frames versus the production compositor, on a 0–255 scale. It measures preview/export consistency, **not reference fidelity**.

| Reference / mode | Export path | Execution path | Frames / duration | Maximum sampled error |
| --- | --- | --- | --- | --- |
| 54 Close Match | `54/final/render.mp4` | Windows Deliver | 506 / 16.867 s | 1.693 |
| 54 Smart Adaptation | `54/Smart-Adaptation/render.mp4` | Windows Deliver after full restart | 514 / 17.133 s | 1.694 |
| 54 Creative Remix | `54/Creative-Remix/render.mp4` | Windows Deliver after full restart | 436 / 14.533 s | 1.711 |
| 55 Close Match | `55/final/render.mp4` | Windows Deliver | 392 / 13.067 s | 1.831 |
| 55 Smart Adaptation | `55/Smart-Adaptation/render.mp4` | Production compositor + native encoder harness | 410 / 13.667 s | 1.450 |
| 55 Creative Remix | `55/Creative-Remix-recheck/render.mp4` | Production compositor + native encoder harness | 384 / 12.800 s | 1.506 |

`output-inventory.json`, each output's `comparison.json` / `verification.json`, and the two Close Match `title-pixels.json` / `audio-timing.json` files contain measured results. The title check verifies all 16 / 3 accepted intervals, not unrecognized words. Source music lag is zero in three windows for both Close Match exports, with correlation above 0.9998. This is sample alignment; reference cuts may lie 20–233 ms from the independently supplied music's nearest detected events.

All modes remain distinct in pacing and trims. Reference 55 selects incline/deadlift/squat/bench in Close Match and Smart Adaptation with different source starts; Remix replaces the final bench shot with another deadlift interval and has a shorter duration. Reference 54 has different squat/bench trims and replaces one row interval with incline footage in Remix. Smart/Remix still use generic typography placement: inspected sheets show REASON beneath the picture and other titles over blur. The measured foreground-relative text reconstruction currently targets Close Match. This remains an explicit fidelity gap in the other modes.

Reference 54's full Windows exit/restart/Open/Save preserved all compositions and assets exactly, including 48 text layer instances across three sequences (`54/reopen-verification.json`). The project parser also round-trips all saved graphs. Browser acceptance covers Preview, Apply, reviewed wording, Undo/Redo and save/reopen through the normal command/history boundary. Earlier native manual mask/title editing evidence remains in `test-results/fidelity2`; current conservative automatic-depth plans create no confident behind-person titles and do not substitute that historical manual evidence for automatic acceptance.

### Intermittent black frame investigation

The first CPU harness export `55/Creative-Remix/render.mp4` failed the full scan at frame 100, the first frame of a new deadlift cut. Its pre-encode PNG was also black. The actual source at 5.2 s and a fresh compositor render at frame 100 are valid. The failure is therefore upstream of encoding. Thirty-two cold single-decoder seeks and thirty-two duplicate-layer seeks did not reproduce it; the exact intermittent trigger is not proven.

The production seek path now registers a video-frame presentation callback before seeking and waits for both completed seek/readiness and a matching source-frame timestamp. It rejects stale events and times out instead of returning unready pixels. This closes a readiness gap but does not establish the original trigger conclusively. The complete rerender passed all 384 frames; retain both the failed output and `Creative-Remix-recheck` for further stress testing. New browser evidence exercises stale seek-event rejection on real decoded video, repeated source-frame equality, the existing cache/parity test, relinking and fractional speed remapping. All four tests pass. Both frontend and embedded Windows builds pass after the change. The comparison script now writes failure frame numbers before returning a failing exit code.

The additional Windows Deliver export after restarting and reopening reference 55 passed all 384 frames, AAC, and source isolation. Its largest sampled preview-to-export error was 1.88/255. See 55/Windows-Creative-Remix. These results close the interrupted export check.
