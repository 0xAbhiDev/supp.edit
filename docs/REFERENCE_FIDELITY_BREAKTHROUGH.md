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

## Focused title reconstruction — 17 November 2026

This increment rebuilds the opening of the second gym reference (`…12.51.55 AM.mp4`) and is verified through the rebuilt Windows application, not only the browser harness. It is **not acceptance of autonomous reference recreation**: the footage, typefaces and several listed attributes still differ. No overall similarity percentage is claimed.

### What the reference does in 0–3.967 s

One word at a time at a fixed center: YOU, CANNOT, REASON, WITH, A, a script Tiger, WHEN, YOUR, HEAD. The lettering is white composited in difference mode, so it shows the plate's photographic negative: pink over the green grade and maroon over a flat mint subject flash. The plate is dark with a teal cast that deepens toward the shadows and fades toward near-neutral highlights. The picture fills the frame. A hard cut falls at 2.967 s.

### Diagnosis of the earlier output

| Defect in the previous focused export (`test-results/focus55/pass1`) | Stage | Correction |
| --- | --- | --- |
| A, Tiger, YOUR and HEAD missing; WHEN partly | Analysis | The chroma-band mask broke over skin and bright plate, and the Whisper transcript for this vocal is wrong ("Who cannot please him … heavy sin is slow"), so vocal words could not supply the wording. |
| Flat monochrome green wash, or no grade | Treatment | A single `color` blend replaced hue everywhere. The reference keeps near-neutral highlights. |
| Black bars above and below | Planning | The union of detected subjects kept a contain fit although the reference has no letterbox. |
| Negative pulse muted to dim green (found while extending to 8 s) | Planning | Grade tracks were inserted before the pulse tracks and ended up above them. |

### Implemented

- `packages/ai/reference/title-ink.ts` — negative-ink classifier. The plate outside the title band gives a per-frame color model; a band pixel is ink when its negative is an ordinary plate color and the pixel is not. Votes across the frames of one stationary word reject moving scenery. Runs tolerate frames inside a measured full-frame pulse. No color threshold and no reference-specific values.
- `packages/ai/reference/title-read.ts` — local reader. Each candidate wording is rendered in every installed candidate face and compared with the full-resolution mask. A letter-by-letter decode of separated capitals proposes wordings when OCR and the vocal have none.
- `packages/ai/reference/ink-titles.ts` — evidence rules. Reviewed wording wins; prior OCR that still fits is kept; a decode within one substituted letter of an OCR or vocal wording yields to it; a decode with no other support must persist for at least three frames; a vocal word that does not fit on its own (connected script, single letter) is accepted only between two confirmed neighbors with exactly matching counts. Unread lettering is reported by time, never guessed. Capitals of one size share one face and one ink treatment.
- `packages/ai/reference/tone.ts`, `source-tone.ts` — five per-channel percentiles for each reference shot and each raw source, and a solver for one brightness gain, a highlight cast (plain multiply) and a shadow cast (multiply through an inverted-luminance matte). `sequence.plateTint` gained `highlight-cast` and `shadow-cast`; both are ordinary editable shape layers with mattes.
- `packages/ai/reference/planner.ts` — Close Match in reference framing covers the frame when the reference has no letterbox and warns when the detected subject area is cropped; grade layers are emitted after color pulses so pulses stay above them; the saturation boost is capped when a measured cast is present.
- `packages/typography/fonts.ts` — more installed sans and script candidates.
- Earlier uncommitted work is kept: focused-interval controls, difference ink on text, subject flash layers, the chroma-band reader (now the fallback for flat colored fills).

### Windows application evidence

`scripts/verify-native-focused.mjs` launches `bin/supp-edit.exe` (rebuilt 17 November, 36,015,104 bytes, embedded bundle `index-T9WY3Q9Z.js`), drives its own interface through the WebView2 debugging port, and answers native file dialogs with `scripts/native-file-dialog.ps1`. Analysis runs in the native host and the MP4 is written by Deliver.

| Run | Evidence directory | Result |
| --- | --- | --- |
| 0–3.967 s | `test-results/focus55/native` | Open → Recreate (235 s of local analysis) → Preview → Apply → Undo → Redo → Save → full exit → reopen → resave with identical compositions and assets → Deliver. `render.mp4`: 464×368, 119 H.264 frames, AAC. 17 layers, 9 editable difference-blend titles. The Deliver step was resumed in the same reopened application after a harness selector error; `native-session.json` records the earlier steps from `run.log`. |
| 0–7.967 s | `test-results/focus55/native-long` | Same sequence in one uninterrupted run. `render.mp4`: 239 frames, AAC. 27 layers, 12 editable titles (adds IS, IN, ITS, read from letter shapes alone). The preview states that lettering at 4.70–4.77 s and 4.83–4.90 s was isolated but not read; MOUTH is absent from the export by design. |

Screenshots `0-launched.png` … `6-deliver-done.png`, `native-verification.json`, `before-close.supp` and the saved project are in each directory. The Windows export and the CPU harness render of the same plan agree at 47.1 dB average PSNR.

### Measurements

`scripts/measure-title-fidelity.mjs REFERENCE EXPORT DNA OUT` isolates the lettering in the reference frame and in the export frame at each title's midpoint and reports their intersection over union, plus the mean absolute difference of five per-channel plate percentiles (0–255). These measure the compared attributes only.

| Export of 0–3.967 s | Mean title overlap | Titles with any overlap | Plate tone error, shot 1 / shot 2 |
| --- | ---: | ---: | ---: |
| Earlier focused pass (`focus55/pass1/render.mp4`) | 0.187 | 5 of 9 | 25.3 / 18.3 |
| Working tree at handoff (`focus55/claude/baseline`) | 0.266 | 5 of 9 | 21.9 / 15.6 |
| Windows Deliver export (`focus55/native/render.mp4`) | 0.491 | 9 of 9 | 7.0 / 10.1 |

Per title in the Windows export: YOU 0.74, CANNOT 0.42, REASON 0.57, WITH 0.49, A 0.36, Tiger 0.08, WHEN 0.57, YOUR 0.51, HEAD 0.70. Position and size agree; the remaining gap is letter shape (Segoe UI against a geometric display face) and places where the export's own plate is mid-gray and the classifier cannot see its ink. Tiger scores near zero because no installed script resembles the reference hand.

Negative pulse, Windows 0–8 s export: mean RGB of frames 139, 140, 143, 144 is (199, 146–147, 53–54) against the reference's (201–202, 138–140, 53–54). Before the track-order fix the same frames rendered dim green (`focus55/claude/long1`). Aligned sheets: `focus55/native/comparison.jpg`, `focus55/native-long/comparison.jpg`, overlay `focus55/native/fidelity/title-fidelity.png`.

### Unresolved

| Attribute | Status |
| --- | --- |
| Overall brightness | Outside pulses the export's mean RGB is about (22–32, 39–57, 32–47) against the reference's (42–46, 61–63, 48–50). Medians match; the reference has bright fixtures and floor that evenly lit raw footage lacks. Lifting toward the upper quartile was tried and reverted: tone error rose to 12.6 / 15.3 with almost no change in mean. |
| Typeface | Nearest installed faces only: Segoe UI Bold for the capitals, Segoe Script for Tiger. No font is bundled or downloaded. |
| Subject flash | Timing and color are measured. The silhouette comes from the low-resolution person contour of the matched raw shot; for the reclined incline-press athlete it is a soft blob beside the reference's crisp standing figure. |
| MOUTH (4.63–4.97 s) | Two-frame flashes between pulses; the decode reads a damaged H as L. Withheld with a warning. Entering reviewed words places it in the family face and size (`focus55/claude/long6`, harness only). Its rotation is not reproduced. |
| HONORABLE (5.3 s onward) | Red serif behind the athlete. The negative-ink model does not apply to a flat colored fill and OCR sees only fragments; still withheld. |
| Title motion | Titles cut on and off on the measured frames. No entrance scale, rotation or blur is measured. |
| Raw footage | Burned-in exercise labels, flat studio lighting and different camera positions are properties of the supplied clips. |
| Instagram logo and handle | Recognized as recurring edge labels and deliberately excluded. |
| Other references and modes | Reference 54, vertical framing, Smart Adaptation and Creative Remix were not rerun with these changes. Cover framing and tone casts apply to any Close Match with measured tone; only this reference has native evidence. |

Harness note: Playwright's pinned Chromium is not installed on this machine. `scripts/runtime.mjs` falls back to installed Chrome or Edge; nothing is downloaded.

## Hidden, colored and decorative titles; measured tone curves — 18 November 2026

Continues the focused reconstruction of the second gym reference, now over 0–7.967 s. Verified through the rebuilt Windows application. This is **not acceptance of autonomous reference recreation**; the limits below still apply.

### What changed and why

| Reference behaviour | Previous result | Change |
| --- | --- | --- |
| Plate: lifted blacks (≈7–12), bright upper midtones from fixtures, teal cast | Two global casts matched median and highlights only; shadows crushed, upper midtones dark | New editable **Tone curve** effect (`packages/effects/curves.ts`): a monotone cubic per channel through five measured percentile pairs. CPU and WebGL evaluate the same curve (max 0.017/255 apart). Native schema validates it; the Inspector edits each output level. Close Match measures the raw tone over the part of the frame the shot actually shows (stripe histograms, `spanTone`) and bounds extrapolation above the brightest measured level. |
| Red serif HONORABLE spans the frame, partly behind the athlete | Absent | Second, independent pass for flat colored lettering (`distinctInk`: colors concentrated in the title band but rare elsewhere). Full-width band with dominant-cluster selection. Pixels inside the reference person contour are excluded from the vote (`exposedVote`), so the word is assembled from the frames where each part is exposed. Depth is measured (`lettingDepth`): lettering that vanishes inside the contour but stays outside is placed behind the editable foreground person copy. |
| MOUTH twice, larger than the other words, second time turned ≈4° | Absent | Reviewed words keep their own measured size when it fits; a repeated word reuses its clearest occurrence's lettering; baseline angle is measured from the ink's upper and lower edges and becomes an editable rotation. |
| Script *Tiger* in a hand no installed face resembles | Segoe Script | When no face fits (fit < 0.3) and at least six frames agree, the measured letterforms become an editable **traced lettering** shape: outer contours add, counters subtract (`title-outline.ts`, `sequence.tracedTitle`). Contours are traced from a smoothed, 2× field. |
| Serif letters joined by serifs | Decoder could not partition | Strokes wider than a letter split at hairline columns; a letter may rejoin up to four pieces. |
| A title cut in during a blurred transition | Started after the blur | An accepted title absorbs an immediately preceding unreadable run in the same place. |
| Subject pose | Not considered | Shot ranking adds a body-shape term from reference and raw person contours (`subject-shape.ts`). It is a tie-breaker (weight 1.0): the available contours do not separate lying and standing reliably, and a stronger weight chose an outdoor clip. |

Unreadable lettering is never guessed. The preview names each moment and what was seen, for example *"Lettering at 5.10–7.97 s … (letter shapes read "HON6RAF" with 1 letter mostly hidden; OCR saw "HON"; OCR saw "RABLE"; OCR saw "HOFORABLE")"*. Words entered under **Visually reviewed words** are reconstructed from the measured color, face, size, position, angle and depth. In this run MOUTH (twice) and HONORABLE were supplied that way (`test-results/focus55/p2/review.txt`); the other twelve words are read automatically.

### Export reliability fix

Deliver could stop with *Timed out waiting for decoded media frame*. New diagnostics in the error identified the cause on real exports: the seek had completed at the exact requested time with decoded data (`readyState 4`), but WebView2 never delivered a presentation callback for that frame. A second case, a seek to the time already shown (as after preview playback), never presents a new frame at all and was reproduced deterministically (`scripts/inspect-same-time-seek.mjs`). `seekMedia` now returns at once when already settled on the time, and otherwise accepts a settled seek after a 400 ms grace if no callback arrives. With the same project and session, four consecutive exports failed before the change and four succeeded after it, byte-identical to each other (`native-p2d/repeat`, `native-p2d/repeat-typed`). Astra's 32 cold-seek inspection still shows no stale or black frame.

### Windows application evidence

`scripts/verify-native-focused.mjs` (bin/supp-edit.exe rebuilt from this tree) now also plays the sequence in the program monitor and edits one tone-curve output level in the Inspector before Deliver. Run `test-results/focus55/native-final` (byte-identical to the earlier verified `native-p2e` export):

Open → Recreate → Preview → Apply → Undo → Redo → Save → full exit → reopen → identical resave → playback 00:00 → 02:28, paused at 03:20 → Inspector edit (incline.webm, green output at 255: 158 → 138, saved, nothing else changed) → Deliver. `render.mp4`: 464×368, 239 H.264 frames, AAC, no black frames, preview-to-export error 1.61–2.14/255, identical to four repeat exports. Screenshots `0-launched.png` … `6-deliver-done.png`, `native-verification.json`.

The file-dialog helper now types the path as characters. Plain `WM_SETTEXT` left a Save dialog's own name in place; earlier native exports were unaffected only because the default location equalled the requested path.

### Measurements (0–7.967 s, Windows exports)

`scripts/measure-title-fidelity.mjs`: intersection over union of isolated lettering in reference and export at each title's midpoint (white/difference titles by negative ink, flat colored ones by concentrated color), and tone error averaged over five frames per shot outside color pulses. These measure those attributes only.

| | Previous Windows export (`native-long`) | This export (`native-final`) |
| --- | ---: | ---: |
| Mean title overlap (15 titles) | 0.445 | 0.512 |
| Tiger | 0.078 | 0.536 |
| MOUTH / MOUTH | 0 / 0 | 0.575 / 0.166 |
| HONORABLE | 0.070 | 0.358 |
| Tone error, shots 1 / 2 / 3 | 12.5 / 13.0 / 7.9 | 7.9 / 7.6 / 5.3 |
| Negative pulse, frames 139–144 mean RGB | 199, 146, 54 | 197–207, 152–156, 43–49 (reference 201–202, 138–140, 53–54) |

Aligned sheet: `native-final/comparison.jpg` (reference │ previous Windows export │ this export).

### Unresolved

| Attribute | Status |
| --- | --- |
| Review needed | MOUTH appears for two frames between pulses and its H is damaged; HONORABLE has one letter hidden in every frame. Both are reconstructed only from reviewed wording. |
| MOUTH motion | Each letter turns separately in the reference; one overall angle is reproduced. The second MOUTH measures −2.3° against roughly −4° by eye. |
| HONORABLE occlusion | Follows the raw athlete, who lies on a bench, so different letters are hidden than in the reference. |
| Subject flash | Color and timing match; the shape is the low-resolution PP-HumanSeg contour of a reclined athlete. |
| Raw footage | No supplied clip shows a standing lifter in a dark gym; the incline and bench clips carry burned-in labels. Pose matching cannot fix this. |
| Traced *Tiger* | Parts of the T swash and g tail are missing where the shirt behind defeated the ink model. |
| Transition | The directional blur at 4.97 s is not reproduced. |

### Generalization

The focused pass and grade run through the same production planner for other modes, framing, raw footage and the first reference. Harness runs use the production compositor and native encoder; the other-clips case was also run through the Windows application.

| Case | Evidence | Execution | Result |
| --- | --- | --- | --- |
| Other raw clips (row, deadlift, squat; incline and bench withheld) | `focus55/native-other` | Windows app: full sequence incl. playback, Inspector edit (row.webm), Deliver | 239 frames, AAC, no black frames, preview-to-export ≤ 2.54/255. Mean title overlap 0.589; tone 7.6 / 7.6 / 10.8. The standing row athlete gives a subject flash close to the reference's standing silhouette; HONORABLE passes behind the standing squatter. The squat clip's baked-in bars are now cropped using its measured content aperture. |
| Smart Adaptation | `focus55/generalize/smart` | Harness | 268 frames. Now carries the measured tone curve. Titles keep generic placement and an installed script for Tiger (measured placement and traced lettering are Close Match only). **Defect:** HONORABLE is cut to "HONOR". Retimed shots make per-frame scores meaningless. |
| Creative Remix | `focus55/generalize/remix` | Harness | 254 frames. Ungraded by design; pulse kept; generic placement; HONORABLE also partly cut. |
| 9:16 Close Match | `focus55/generalize/vertical` | Harness | 1080×1920, 239 frames, grade applied. The portrait policy keeps wide raw footage whole, small in a blurred field, so titles are small. Unchanged. |
| Reference 54, 9.3–12.4 s | `focus55/generalize/ref54` | Harness | Stacked lyric words rebuilt at measured positions: TO 0.94, YOU 0.77, EVERYWHERE 0.58, LEAVE 0.51, HARD 0.22. A stacked "I" under WHEN is missing (the focused band follows one line), and the matcher chose the bright beach clip for a night exterior (tone 11.2). |

Nothing in the implementation names these references' words, times or colors; review text is supplied per run.
