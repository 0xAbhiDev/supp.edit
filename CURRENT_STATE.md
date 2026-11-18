## Audio fidelity 3.0: shared audio/visual event clock and three audio modes — 18 November 2026

References are now measured for sound as well as picture, on one millisecond clock: typed audio events, drifting beats, sections, sweeps, silences, words. An event graph links every cut, title, pulse and flash to the sound that triggers it, keeping the measured offset apart from the inferred relation. The Recreate panel has an Audio control:
- *Supplied music*.
- *Use reference audio*: the reference soundtrack, extracted natively, becomes an editable audio clip.
- *Recreate audio structure*: the supplied music is offset and the linked visual events are moved onto its matching events; sounds it lacks are synthesised locally as editable clips.

Linked events become markers that move their layers (←/→), and the preview shows the measured events, the inferred grammar and each link. Shot matches record why they were chosen. A letterboxed reference keeps its measured bars as editable layers. Details: `AI_ARCHITECTURE.md` (top section); evidence: `docs/REFERENCE_STYLE_CAPABILITIES.md`.

| Evidence | Location |
| --- | --- |
| Windows cases (full UI flow: preview, Apply/Undo/Redo, save, exit, reopen, play, Inspector edit, Deliver) | `test-results/audio3/native/case{1,2,3}/`: `native-verification.json`, screenshots, `render.mp4`, `compare-av.mp4`, `av-metrics.json` |
| Earlier and failed attempts, kept as evidence | `test-results/audio3/native/earlier/` |
| Generated corpus with ground truth | `test-results/audio3/corpus/` (`truth.json`, `self-metrics.json`, `detector-summary.json`) |

Measured:
- **Reference audio, reference 55 (case 1):** the exported soundtrack matches the reference with loudness correlation 1.00, lag 0 ms, drift 0 ms, beats F 1.00 and onsets F 0.94. The edit's cuts are 2/2 on audio events and its titles 57%.
- **Recreate on `music.wav` with the squat withheld (case 2):** a 3.48 s offset, 20 events moved and 8 kept, and a riser and a bass hit generated and audible. Measured on the export, cuts are 1/2 on audio events and titles 29% against the reference's 73%, so structure transfers only partly.
- **Generated letterbox/lyric reference (case 3):** the bars are reproduced as editable layers, the audio matches F 1.00 with 0 ms lag, and the cut relations (on the sweep peak, after the impact) are kept. The NEW HEIGHTS title is missing.
- **Detectors on the generated ground truth:** beats F 0.97–0.98, tempo within 1 BPM, impacts 3/3 with no false ones, sweep peaks 2/2, cut relations 14/14. Drops are wrong on both cases, and downbeats are withheld on S1.

Tests: 203 TypeScript, 42 native.

Open:
- drop detection;
- weak-accent downbeats;
- octave errors on short or vocal-heavy windows;
- recreate mode only moving events within 150 ms of a same-family event;
- generated effects mixed loud against the music;
- titles over dense backgrounds (NEW HEIGHTS);
- the empty default "Music" track left in the reference/recreate modes;
- audio-event markers move by keys only, not by drag;
- whip blur still recreated as a cut;
- a focused interval is at most 8 s.

## Hidden, colored and decorative titles; measured tone curves — 18 November 2026

The second reference's 0–7.967 s now exports from the rebuilt Windows application with all fifteen titles. Twelve are read automatically. MOUTH (twice) and the red HONORABLE are reconstructed from reviewed wording: the preview lists exactly what was seen and never guesses hidden letters. HONORABLE sits behind the athlete by measured depth; the script *Tiger* is an editable traced shape of the measured letterforms; the grade is a new editable per-channel **Tone curve** effect matched to five measured percentiles of the part of each shot actually shown. Not acceptance of autonomous recreation.

| Evidence | Location |
| --- | --- |
| Windows exports | `test-results/focus55/native-final/render.mp4` (all clips), `test-results/focus55/native-other/render.mp4` (row, deadlift, squat) |
| Full native sequence incl. program-monitor playback and an Inspector tone-curve edit | `native-verification.json`, `run.log`, screenshots in the same folders |
| Reference / previous Windows export / new export | `comparison.jpg` in the same folders |
| Measurements | `fidelity/title-fidelity.json` in the same folders |
| Export timeout root cause and repeat exports | `test-results/focus55/native-p2d/repeat` (4 failures before) and `repeat-typed` (4 identical successes after) |
| Generalization runs | `test-results/focus55/generalize/{smart,remix,vertical,otherclips,ref54}` |

Measured on 0–7.967 s against the previous Windows export: mean title overlap 0.445 → 0.512 (0.589 with the other clips), tone error per shot 12.5/13.0/7.9 → 7.9/7.6/5.3. Deliver's intermittent "Timed out waiting for decoded media frame" was traced and fixed. Tests: 191 TypeScript, 42 native.

Open: subject flash shape follows the raw person contour; available raw clips do not match the reference's standing, low-angle gym shots; MOUTH's per-letter motion and the blurred transition are not reproduced; Smart Adaptation and Creative Remix cut HONORABLE; the 9:16 policy leaves wide shots small; reference 54's stacked layouts are only partly covered. Details: `docs/REFERENCE_FIDELITY_BREAKTHROUGH.md`, sections "Hidden, colored and decorative titles" and "Generalization".

## Focused title reconstruction verified in the Windows app — 17 November 2026

The opening of the second gym reference (0–3.967 s) now exports from the rebuilt Windows application with all nine reference words as editable difference-blend titles, a measured highlight and shadow cast, and a filled frame. A 0–7.967 s run adds IS, IN and ITS and keeps the two-frame MOUTH flash flagged for review. Both runs passed Open, Recreate, Preview, Apply, Undo, Redo, Save, full exit, reopen with identical compositions and assets, and Deliver export. This is **not acceptance of autonomous reference recreation**.

| Evidence | Location |
| --- | --- |
| Windows Deliver exports | `test-results/focus55/native/render.mp4` (119 frames), `test-results/focus55/native-long/render.mp4` (239 frames) |
| Native session records and screenshots | `native-verification.json`, `run.log`, `0-…6-*.png` in the same directories |
| Reference / previous / Windows export sheets | `comparison.jpg` in the same directories |
| Title overlap and plate tone | `test-results/focus55/native/fidelity/title-fidelity.json` and `.png` |

Measured on 0–3.967 s: mean title overlap 0.491 with 9 of 9 words present (earlier focused pass 0.187 with 5 of 9); plate tone error 7.0 / 10.1 levels (earlier 25.3 / 18.3). The negative pulse at frames 139–144 keeps its yellow and purple above the new grade layers. 180 TypeScript tests and 41 native tests pass; `bin/supp-edit.exe` was rebuilt from this tree and `bin/supp-edit-before-focus.exe` is the prior build.

Still different from the reference: the export is darker on average (flatly lit raw footage), the typefaces are the nearest installed ones, the subject flash is a soft contour, MOUTH and the red HONORABLE title are withheld, and titles have no measured motion. Reference 54 and the other modes were not rerun. Details and reproduction: `docs/REFERENCE_FIDELITY_BREAKTHROUGH.md`, section "Focused title reconstruction".

## Windows export check completed 17 November 2026

The reopened second gym project exported Creative Remix through Windows Deliver. All 384 H.264 frames and the AAC audio decoded. The complete frame scan found zero black frames, including cut 100. The permitted-source graph excludes the reference. The largest sampled preview-to-export mean channel error was 1.88/255. The separate CPU rerender passed too. Both results and the original failing export are retained. The intermittent trigger remains unproven. See `test-results/fidelity-breakthrough/55/Windows-Creative-Remix`.

The active fidelity target is the second reference's opening typography and athlete interaction. Earlier whole-Reel exports remain comparison evidence.

# Reference fidelity breakthrough — 16 November 2026, in progress

Continue from the current working tree after `93f97de`; preserve the accepted audio and typography checkpoints. This increment improves measured typography geometry, cast-aware OCR, aperture framing, and evidence-based text depth. It is **not acceptance of autonomous high-fidelity recreation**. The user's assessment of less than 30% similarity remains the baseline feedback, not a measured score.

Current evidence is in `test-results/fidelity-breakthrough/{54,55}`. `final/Three-modes.supp` contains all three editable modes; `final/render.mp4` is the actual Windows Deliver Close Match export (506 / 392 frames). Both fully decode H.264/AAC, pass permitted-source checks with reference footage excluded, have no detected black frames or dark side bars, and show zero measured music lag in three windows. Every accepted title has a decoded-ink presence check: 16 intervals in 54 and three words in 55. Recovered words and geometry are improved, but missing ornate words, event timing, protected wide framing, and grading remain significant failures.

Reference 54 was saved, the application fully exited, then relaunched and reopened. Saving again preserved all three compositions, 48 editable title instances and all assets exactly (`54/reopen-verification.json`). Smart Adaptation was subsequently exported through Windows Deliver and passed the full frame scan. Reference 55 Smart Adaptation passed the production compositor/native-encoder harness. A single black frame at cut 100 in the first harness Creative Remix output is under investigation; preserve that failed output. A decoded-frame presentation fence has been added to media seeking, with cache/speed-ramp regression passing; a complete rerender is in progress.

The full diagnosis, artifact paths and practical limits are in `docs/REFERENCE_FIDELITY_BREAKTHROUGH.md`. Already passed before the additional seek change: 174 TypeScript tests, the three-mode browser acceptance, 41 native tests, frontend build and embedded Windows build. Do not repeat successful analysis or replace current projects. Finish the pending seek/export check, update these results, and commit the tested increment. Preserve the unrelated formatting-only diff in `native/crates/supp-project/src/typography.rs`.

## Historical Visual Fidelity 2.0 notes (superseded by the current evidence above)

Starting checkpoint: `7be9d83`. The existing audio, typography and coastal acceptance remains valid. The new vertical gym workflow is **partially complete**; six final native exports and independent non-gym acceptance are still outstanding.

Dense animated-mask projects exposed unbuffered native JSON file reads. A buffered reader preserves the same validation and 64 MiB limit. Native read/save/read of the actual three-mode 18.9 MB project completed in 6.10 seconds with identical project data; the unbuffered run had exceeded 120 CPU seconds. All 24 project tests pass. This is a persistence performance fix, not visual-fidelity acceptance.

Current evidence is under `test-results/fidelity2`. Native Preview/Apply/Undo/Redo and Save completed for the first layered gym reconstruction in `54/project.supp`; the application was fully closed. That saved project predates the final aperture fix and is not a final visual acceptance artifact. Continue with the current framing implementation and full reopen/export checks.

# Advanced reference checkpoint — 13 November 2026

Coastal rendering and the two supplied gym references are recorded at `8a64f95`. Reference Editor now permits corrections and omissions in Review title wording before applying the generated sequence.

The reviewed-wording change is `0bb6c96`. Run `npm run launch` from this checkout to start the verified local build in `bin/supp-edit.exe` with the installed media tools and local analysis models. This executable was built with the debug Cargo profile and embedded production frontend assets.

The restarted Windows desktop app exported all three coastal compositions from the saved project. The eight-shot sequences use two independent coastal sources. Every H.264/AAC frame decoded, all three audio streams contain signal, and the full-frame scans found zero black frames and zero dark side bars. The saved Smart Adaptation brightness edit of 0.96 survived reopening. The reference remains available for comparison in the library and is absent from the rendered graph.

| Windows Deliver output | Frames at 30 fps | Duration | Largest mean RGB error among first, middle and last frames |
| --- | ---: | ---: | ---: |
| Close Match | 528 | 17.600 s | 2.34/255 |
| Smart Adaptation | 591 | 19.700 s | 2.44/255 |
| Creative Remix | 491 | 16.367 s | 2.22/255 |

Evidence lives under test-results/reference-coastal/final in each mode directory. The editable project is test-results/reference-coastal/reviewed/Three-modes.supp. Close Match cut starts differ by at most 16.34 ms. The coastal reference uses hard cuts and contains no lyric typography or supplied music. Comparisons show matching shot timing and materially different scenery and camera viewpoints. Natural sound, typography and musical beat accuracy require separate cases.

Controlled tests on real footage recover flash, blur, zoom, whip and motion signatures. The generated motion-controller peaks visibly change the export, though their strength can be too low for the detector to recognize again. Shared sRGB decode resolves the HLG preview/export mismatch. See docs/REFERENCE_STYLE_CAPABILITIES.md for boundaries.

Both supplied WhatsApp videos were used as finished references with independent exercise footage and a separate music track. The first Close Match edit has eight intervals, 506 frames and 16.867 s of actual video. The second has four shots, 392 frames, and two editable negative duotone pulses. Its original words, font treatment, text behind the athlete and end card still differ substantially. Technical acceptance applies to the measured features. The previous gym, audio and typography acceptance records follow.

# Reference-to-Edit Windows acceptance checkpoint

Validated on 11 November 2026, building on reference checkpoint 09e863f and typography checkpoint 6706330. The 12-second finished fitness reference and separate 15.555-second squat take produce four independently trimmed shots in each of three modes. Detection recovers boundaries at 2.00, 5.50 and 9.00 seconds. A measured cadence hold at 1.50 seconds drives one bounded editable speed curve.

Native import of the reference, raw footage and supplied music, local analysis, generation, synchronized preview, Apply and Undo/Redo passed in the Windows app. The scheduler now reports one monotonic stage count with separate operation detail. The next desktop failure was precise revision planning inside generated compositions. The agent now scopes context and commands to the active composition while retaining the project identity.

The desktop revised the first Smart Adaptation shot to brightness 0.91. Saving after Undo exactly restored its original composition. Redo changed only that brightness. Full process exit, relaunch, reopen and resave preserved every composition exactly. Deliver exported 388 frames at 1080×1920 with H.264/AAC. Twenty-three decoded samples cover twelve title animation positions, every shot boundary and all speed keys. Maximum full-frame mean absolute error against the compositor is 1.290/255. Text regions distinguish the rendered titles from footage with those layers removed. Only squat.webm and music.wav are supplied to the independent renderer. See test-results/reference-gym/desktop/Desktop-recreation.supp, render.mp4, before-revision.supp, undone.supp, before-close.supp, native-verification.json and comparison.json.

All three generated compositions also survived a separate native save, full process exit and reopen. Native Deliver exports are available at the following locations.

| Mode | Frames / duration | Desktop MP4 |
| --- | --- | --- |
| Close Match | 360 / 12.000 s | test-results/reference-gym/desktop-modes/Close-Match/render.mp4 |
| Smart Adaptation with manual revision | 388 / 12.933 s | test-results/reference-gym/desktop/render.mp4 |
| Creative Remix | 337 / 11.233 s | test-results/reference-gym/desktop-modes/Creative-Remix/render.mp4 |

All exports decode, contain audio and have zero wholly black frames. Early, middle and late soundtrack samples have zero lag at the 8 kHz comparison rate and correlations above 0.999. Close Match cut distances to measured supplied-music events are 0/0/0 ms. Smart Adaptation distances are 100/233/133 ms and Creative Remix distances are 63/33/100 ms. Each mode uses different real source trims and pacing. Contact sheets place corresponding reference frames above output frames. Source letterboxing remains visible. The hard-cut fixture validates cuts and one speed accent, while dissolve, masked-transition and whip-transition acceptance remains open.

Reference text now offers original wording, adapted wording or omission. Windows OCR recovers all four original phrases, white foreground, lime word emphasis, cap height and a word-build observation. Original wording passed the native workflow. The automated three-mode test uses original words for Close Match and four explicitly supplied new squat phrases for Smart Adaptation and Creative Remix. Automatic adaptation can draw from overlapping source transcripts or sufficiently confident action labels. Unresolved intervals are omitted with a warning. Freeform semantic caption rewriting remains incomplete. All generated titles use editable text layers and ordinary effects/keyframes. Profiles discard source words.

Browser UI acceptance covers three-mode generation, comparison scrubbing, Apply, Undo, Redo, save and fresh-page reopen. The TypeScript suite passed its 149 existing tests across the full run and isolated performance rerun, plus the new composition-scoped regression. Native project/media/export tests pass 24/11/4, workspace Clippy passes and the frontend/native debug build passes. Existing Vite bundle-size and mixed dynamic/static-import warnings remain.

Diverse-style completion remains open. Required work includes travel and talking-head/lifestyle acceptance with independent footage, a five-raw-input acceptance, unsupported-reference tests, reliable transition classification/reconstruction, exact typography/font and motion treatment recovery, stronger per-shot color matching, grounded caption rewriting, and measured output-style assessment. Reference-conditioned Automatic Sound Design remains on the roadmap. Current measurements support bounded local editing and disclose estimates.

## Validated kinetic typography checkpoint 6706330

Native kinetic typography acceptance passed on the corrected 1080×1920, 12-second Reel. The 360-frame H.264/AAC file decodes with mono RMS 0.19034. Four text layers remain editable. Native Preview, Apply, Undo/Redo, manual 68.5 px size and 0.845 entrance scale, full process exit and reopen were exercised. After the first export exposed face overlap, the planner weighted upper-body overlap and refit the existing titles through ordinary commands, preserving their other edits. A freshly launched native app reopened and resaved the corrected project exactly and exported it. Twelve decoded samples average 3.13/255 error relative to the text compositor and 119.58/255 against the same frames with text removed. The row title clears the athlete’s face. See test-results/typography-reviewed/render.mp4, NATIVE.supp, contact.png, native-verification.json and scripts/verify-native-typography.mjs.

All twenty treatments passed native decoded-frame verification in the 600-frame showcase. CPU/GPU parity covered 120 samples, maximum per-channel mean absolute error 0.363/255. Recorded-speech karaoke was rendered separately with transcript word timestamps. The gym source clips in the combined Reel contain no speech. Audio checkpoint 87541c2 remains accepted.

Next: the Reference-to-Edit attachment 4d8c8375-f3c7-47ba-a500-b793ef50341f governs the flagship workflow. Use separate reference and raw inputs, extract measured editing characteristics, and apply them to the raw sources through normal project commands. Validate each genre through native export.

## Earlier checkpoints
# Current state — speech-aware audio acceptance complete

Latest current-tree audio-export follow-up governs. Portrait, profile and speed checkpoints remain accepted. Next is actual editable kinetic typography through native export and full app close/reopen. Full aesthetic/universal acceptance remains open.

Speech-aware audio acceptance PASSED on 3 November 2026. Full native Preview → Apply → Undo → Redo → Save → complete process exit → relaunch/reopen → resave → Deliver export. All compositions/transcripts survived exactly. Five captions, one transcript, eleven music gain keys and manual frame-90 −17.25 dB key remain. Ducking was removed and restored around three measured speech regions. Actual UI export test-results/audio-mix/render.mp4 (copied to NATIVE_AUDIO.mp4) has 300 frames/10s, H.264/AAC, zero black frames, channel peak 0.96236. Its decoded stereo audio is byte-identical to the independently verified timeline mix. Early and late source-only speech have zero lag and >0.99999 correlation. No tolerance relaxation or hardcoded offset. See scripts/verify-native-audio.mjs and test-results/audio-mix/native-verification.json. No pitch-preserving time stretching is claimed.

Audio uses real media-only gain animation, bounded measured active-RMS normalization, speech-safe normal speed, music ducking/fades, source suppression, five editable audio revision intents and generated baselines preserving manual edits. Non-verbal Whisper annotations do not trigger speech. Decode-before-seek corrects AAC priming.

Validation: 145 TS tests pass across suite plus isolated performance rerun; browser audio acceptance passed; 23 native project + 11 media + 4 export tests, workspace Clippy, frontend typecheck/build and speed export regression pass. Native binary is current.

The bounded gym workflow has passed native Windows acceptance:

- AI rough cut: COMPLETE for the supported local source-selection/onset-alignment workflow.
- AI revisions: COMPLETE for the implemented guarded existing-sequence requests.
- 9:16 AI auto-reframe and editable framing: COMPLETE for the supported video-shot layout.
- Preview, Apply, Undo/Redo, full app close/reopen, exact framing persistence and native 1080×1920 export: COMPLETE.

The last native test sampled seven shots locally, applied a separate portrait copy, undid/redid it, then manually changed the first Position X key from 189.08830378666667 to 249.088 in the ordinary Inspector. The preview visibly shifted. Save, complete app exit, relaunch, reopen and resave preserved every composition, transform and keyframe exactly. `test-results/reframe/NATIVE_MANUAL.mp4` is H.264/AAC, 1080×1920, 20 seconds, 600 decoded frames, no entirely black frames, audio RMS 0.02189297. Its first-frame error against the edited compositor reference is 1.534/255 versus 19.650/255 against the unedited reference. See `docs/REFRAME_ACCEPTANCE.md` and `test-results/reframe/native-manual-verification.json`.

Local dense YOLOX sampling, source-fingerprinted caching, conservative association, uncertainty holds, safe margins, smoothing/dead zone, Locked/Smooth/Responsive modes and reduced ordinary x/y/scale keys are implemented. Default landscape conversion duplicates the sequence with remapped internal IDs. Wide subjects/groups may retain letterboxing. Unsafe parent/matte/crop/rotation dependencies and unplanned overlay resizing reject. White-shirt requests use a disclosed bright-neutral torso pixel heuristic, not identity recognition. Fast ambiguous displacement holds position; this is not general re-identification.

Validation: 122 TypeScript tests passed across the full run plus an isolated rerun of the 100,000-clip performance test (the parallel run timed out under simultaneous native inference/build load). Sixteen focused framing tests include actual gym inference and controlled translated/duplicated/occluded/edge footage, plus low confidence, stationary, rapid displacement and nonfinite inputs. Browser Preview/Apply/Undo/Redo/manual Inspector edit/save/close/reopen passes. Native media tests, workspace Clippy, production frontend and embedded Windows build pass. Native thumbnail/relink paths now accept the same opaque asset IDs as project/analysis.

Active milestone: Aesthetic Gym Reel Editing. Seven profiles now change real ranking, hook selection, pacing, measured music-event placement and ordinary editable luma/contrast/saturation effects and music gain. The captured real footage produces exactly 25 seconds with a 1–2s ranked hook, distinct bounded ranges and 1080×1920 canvas. Events disclose confidence and distinguish actual onsets from qualified energy/section/drop estimates. Preview displays actual counts/reasons; manual review order is respected. Native provenance accepts the optional style, preserving older projects. Time remapping, portrait generation, restrained zooms, RGB matching, finishing effects, captions and automatic mix are implemented; full integrated aesthetic acceptance remains. The exact 25-second aesthetic prompt is NOT complete yet. Do not expose unsupported controls or claim fake exercise-phase recognition.

Existing compositor, nested compositions, masks/mattes, blend modes, effect stacks and normal command/history boundary remain intact. No cloud upload or automatic model download. Known limits: natural independent two-person footage/identity crossings, physical-GPU/4K/cross-platform certification remain open; controlled two-person stress footage duplicates a licensed source. Ten-layer 1080p SwiftShader stress still times out at 120 seconds. Distribution manifest/source ZIP need an accurate refresh.

Speed-engine checkpoint: schema v10 with legacy migration, editable smooth/linear 0.25–4× curves, analytic source-time mapping, source-bound NLE operations, Inspector controls, selective profile ramps and per-ramp preview toggles. Captions/silence/framing sampling map through actual speed. Native audio follows the curve by offline PCM resampling (pitch follows speed); no optical-flow or pitch-preservation claim. Full TS suite: 133 passed. Native project/export: 24 passed. Browser manual speed edit/save/close/reopen/render passed. Actual native export: 60 frames, 2 seconds, H.264/AAC, zero black frames, expected fast/slow audio frequencies and matching mapped video references. See `test-results/speed-remap/verification.json` and `scripts/verify-speed-remap.mjs`. Final 25-second aesthetic acceptance remains unfinished; installed native binary includes v10 and accepted audio.

Current work: aesthetic jobs now compose dense person-aware framing with independent editable punch-in parent controllers; a source clip's existing camera keys remain intact. RGB shot matching is connected through a separate small native sampling/cache endpoint. Finishing effects now include grain (amount/size/softness), vignette, controlled sharpening, temperature and endpoint-preserving tonal contrast. Focused controller/finishing tests and CPU/GPU browser comparisons pass; manual grain controls persist. Audio/captions and individual effect/zoom review toggles are implemented. Full native aesthetic workflow, transitions and remaining aesthetic revision intents are unfinished. See `CONTINUE_FROM_HERE.md` for the exact active subsystem and remaining work.
