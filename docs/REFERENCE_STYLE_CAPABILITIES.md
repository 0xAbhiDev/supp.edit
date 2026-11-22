# Reference-to-Edit capability evidence — 13 November 2026

**22 November, 4.4 body pose.**
- **Build:** final `2af2ae1d…`. Windows app; one click; every title traced fresh.
- **Evidence:** `test-results/final44/` (`summary.md`, `binaries.txt` 19/19, `README.md`).
- **Tests:** TypeScript 306/306, native 54/54.

| Capability | Status | Tested scope | Evidence |
| --- | --- | --- | --- |
| Action from body pose (MediaPipe joints, optional 17.6 MB download) | VERIFIED (one case) | Gym shot 3 → deadlift lift (0 of 2 before). No graded case lost. | `final44/gym/`, `final44/README.md` |
| Different footage: right action when the raw is another recording | PARTIAL | Gym 1 of 2 usable-deadlift shots; A/B assets 2/4 moment, 3/4 clip, 0 false confident | `final44/gym/`, `final44/different42.grade.json` |
| Confidence calibration | PARTIAL | Close match needs 65%: wrong close labels 7 → 3, all same-footage identity claims | `CURRENT_STATE.md` (4.4) |
| Still shots | IMPROVED | Street 4/6 → 5/6 right action; cooking 6/6 | `final44/street.grade.json` |
| Dissolve rebuilt with footage before the cut | VERIFIED | Transition-heavy case: dissolve, flash, whip | `final44/transitions/` |
| Formerly sealed holdout | IMPROVED | 3/6 → 4/6 exact and right action | `final44/sealed41.grade.json` |
| Titles: Tiger, MOUTH | FAILED (unchanged) | Tiger glyph fit 0; MOUTH split by style changes | `final44-smoke/` |
| Everything else in the 4.3 table | unchanged | cooking 6/6, travel 6/6, long 9/9, Remix, Smart, audio, takes, HONORABLE | `final44/summary.md` |

**22 November, 4.3 selection fixes.**
- **Build:** final `218c7a9b…`. Windows app; one click; every title traced fresh.
- **Evidence:** `test-results/final43c/` (`summary.md`, `binaries.txt` 19/19); what was tried and reverted is in `test-results/final43b/README.md`.
- **Tests:** TypeScript 300/300, native 52/52.

| Capability | Status | Tested scope | Evidence |
| --- | --- | --- | --- |
| Plan picks placed as planned (no fallback from frame rounding or slowed-shot consumption) | VERIFIED | 19 runs, 0 fallback placements (4 on 4.2). Street 3/6 → 4/6. Gym export valid again. | `final43c/*/explanations.json`, `app-console.log` |
| Person check identical on first and repeat runs | VERIFIED | Fresh-title matrix equals cached-title matrix on every graded result and label | `final43c/` vs `final43b/` |
| Reference movement without colour pulses and person flashes | VERIFIED (neutral) | No pick changed. One label moved from missing to weak. | `final43/offline/`, `final43c/gym/` |
| Different footage: right action when the raw is another recording | FAILED (unchanged) | Gym 0 of 2 usable-deadlift shots; blind A/B 2/4 | `final42/gym-inspection/`, `different42/` |
| Confidence on shots with nobody in them | FAILED | 3 close-match labels on wrong picks, previously hidden by a first-run leak | `CURRENT_STATE.md` (4.3) |
| Everything else in the 4.2 table | unchanged | Same results on `218c7a9b` (cooking 6/6, travel 6/6, long 9/9, Remix, Smart, audio, takes, HONORABLE) | `final43c/summary.md` |

**21 November, Universal Reference-to-Edit 4.2.**
- **Build:** final `e3ebf2f9…`, in the Windows app; one click unless noted.
- **Scoring:** the first automatic edit is graded before any take or Inspector edit. Then each run went through playback, Save → Exit → Reopen, an Inspector edit and Deliver.
- **Evidence:** `test-results/final42b/` (`summary.md`), the blind A/B in `test-results/footage/different42/`, and `CURRENT_STATE.md` (4.2).
- **Tests:** TypeScript 295/295, native 52/52.

| Capability | Status | Tested scope | Evidence |
| --- | --- | --- | --- |
| Full one-click workflow | VERIFIED | 19 runs + take check on `e3ebf2f9`. All played, reopened identically and exported valid MP4s (0 drift, 0 black, 0 decode errors). | `final42b/summary.md`, `binaries.txt` |
| Generated whoosh timing | VERIFIED | Controlled 6 cases 484 → 23 ms. App −27 / −26 ms (2 exports). | `audio42/README.md`, `final42b/{s1-whoosh,s4-montage}/effect-tracks.json` |
| Generated riser level | VERIFIED | Controlled 14.5 → 0.6 dB at peak. App −0.3 dB, +6 ms (reel 55). No clipping. Listening not done (excerpts provided). | same; `audio42/listen/` |
| Impact and bass hit | VERIFIED (regression) | Onset on frame; −0.7 to −2.2 dB vs plan | `final42b/*/effect-tracks.json` |
| Alternative take reuse warning | VERIFIED | 63 takes; 0 mismatches after Apply, take, Undo, Redo and Save/Reopen. 20 separate moments of the same clips not warned. | `final42b/takes-case5.log` |
| Different footage: blind A/B, frozen 4.2 vs 4.1 | FAILED (no gain) | One unseen case. Both builds: right clip 3/4, right moment 2/4, unavailable flagged 2/3, 2 false confident. | `different42/ab-41`, `ab-42/grade.json` |
| Different footage: cooking (seen case) | VERIFIED | App 4/6 → 6/6 right action after the person check | `final42b/cooking.log`, `final42/cooking-diagnosis/` |
| Different footage: personal gym reel | FAILED | 0 of 2 shots with usable deadlift footage picked; labels honest (0/4 close match) | `final42/gym-inspection/` |
| Person-outline check | VERIFIED (scope: this matrix) | Rejected phantom outlines on 3 references; kept 0-contradicted gym clips | `CURRENT_STATE.md` (4.2) |
| "Best available" / fallback labels | VERIFIED | Fallback shots now labelled (gym 3, street 6, sealed 2, transitions 8). A/B assets: false confident 2 → 0 (regression check, seen). | `final42b/*/explanations.json` |
| Generated, long, multi-clip, travel, Remix, Smart | VERIFIED | Equal to 4.1: travel 6/6, 26 min 9/9, multi 9/9, Remix 8/9 and 7/9, Smart 6/6 | `final42b/summary.md` |
| Same-footage identity | PARTIAL | 13 claims across 3 holdouts, 12 right. Vertical holdout shot 2 claimed another repetition at 93%. | `final42b/holdout-*.log` |
| Real holdouts | PARTIAL, one REGRESSION | Landscape 5/6, vertical 4/6, workshop 4/6 action, sealed 3/6 (6/6 clip); **street 5/6 → 3/6 action** (still-shot rule, planner fallback) | `final42b/street-attribution.md` |
| Transitions | PARTIAL, REGRESSION | 9 boundaries detected; flash and whip rebuilt; **dissolve kept as a cut** (pick starts at the clip's first frame) | `final42b/transitions.log` |
| Titles traced from the reference | PARTIAL | HONORABLE restored (timing ±1 frame, placement within 5 px of 360). Tiger vetoed on size. MOUTH (8 frames) split by colour pulses and withheld. | `final42b-titles/README.md`, `final42b/gym/` |
| Colour banding | PARTIAL (unchanged) | Steps −31%, tone shift about 11 codes | `final41/` |
| Save/reopen reliability | VERIFIED (prior stress); incident unresolved | 20/20 and 5/5 with export (4.1). 19/19 identical reopens in this matrix. | `final41/reopen-stress.md` |
| Copied framing pixel accuracy, multilingual text, references over 90 s, non-Windows | PLANNED | not verified | — |

**21 November, Universal Reference-to-Edit 4.1.** Final build `7e12e200…`. Windows app; one click unless noted; full flow through save, exit, reopen, Inspector edit and Deliver. Every MP4 was checked by `scripts/validate-export.mjs --reference`. Evidence: `test-results/final41/`.

| Capability | Status | Evidence |
| --- | --- | --- |
| One-click recreation, any reference + raw footage | VERIFIED | 15 matrix runs plus the sealed holdout: all completed, all exports valid, 0 black frames |
| Same-footage identity (exact source frames under regrade, crop/zoom, ±speed) | VERIFIED | previous holdout in app 0/6 → 5/6; sealed holdout 3 claims, 3 correct; real gym reel 0 false claims |
| Exact moment when the raw only resembles the reference | PARTIAL | sealed 3/6 exact, 5/6 right clip; cooking 4/6 in app |
| Generated long / multi-clip / travel cases | VERIFIED | 26 min 9/9, multi 9/9, 90 s 6/6, travel 6/6; 0 cut crossings anywhere |
| Confidence and labels (close match / best available) | VERIFIED (calibrated offline) | AUC 0.50 → 0.69; sealed misses: 2 of 3 flagged best available |
| Burned-in source text (no duplicate titles) | VERIFIED | previous holdout: "BENCH PRESS" kept from the footage, not re-added |
| Transitions: cut, punch-in, dissolve, flash, blur, whip | VERIFIED | transition-heavy reference: 9/9 kinds; dissolve, flash and whip rebuilt as editable layers |
| Framing from the matched region (the reference's exact crop/zoom) | VERIFIED (code path), PARTIAL (no pixel audit yet) | applied on identity shots without bars |
| Generated effect audibility | VERIFIED for bass hit and impact; FAILED for whoosh | bass +2.3 dB, impact −2.9 dB vs music; whoosh −11.3 dB (peak placed 0.5 s early); riser about 20 dB under the reference relation |
| Tone-curve banding | PARTIAL | steps −31%, tone shift about 11 codes on the steepest grade |
| Save / reopen reliability | VERIFIED (25 cycles); original incident unresolved | 20/20 plain and 5/5 with export, exit 0, exact restore |
| Creative Remix / Smart Adaptation | VERIFIED | Smart 6/6 (90 s); Remix stays distinct: 8/9 multi, 7/9 11 min (baseline 7/9, 8/9) |
| Relational small-object motion | PLANNED | — |

**20 November universal reference-to-edit engine.** What a user gets from a reference and raw footage alone, measured on the final build in the Windows app (`--untouched`: only the reference and the raw videos chosen, Recreate pressed, everything else automatic; full flow through save, reopen, Inspector edit and Deliver; every MP4 checked by `scripts/validate-export.mjs`):

| Capability | Status | Evidence |
| --- | --- | --- |
| One-click recreation (defaults, automatic title tracing, reference soundtrack) | verified | travel 6/6, multi 9/9, 26 min 9/9; preview lists the automatic choices |
| Search of all footage, up to 26 minutes (15 fps past 20 min) | verified | 7 of 9 picks after minute 20; 0 cut crossings |
| Cuts: hard, punch-in, same-scene, out of moving shots, 15 fps | verified | `matrix-ue/reference-cuts-after2.json`: 0 false positives on 14 references |
| Dissolves (detect, split, rebuild) | verified | 2/2 detected, 0 false; rebuilt as a fade-in layer |
| Flash, blur | verified | fixture spans 8134–8301 and 9900–10167 ms |
| Whip | known failure | classified as a cut |
| Caches (per stage HIT/MISS, dependency-aware, titles v2) | verified | cached 7 s vs 77 s; changed clip only; word correction re-traces titles only |
| Close Match selection on generated gym / travel / long cases | verified | 9/9, 6/6, 6/6, 9/9, 9/9 |
| Cooking (small directional motion) | partially working | 4/6 in the app; still-vs-still and pour-vs-stir misses |
| Creative Remix | partially working | 7/9 and 8/9 (was 3/9 and 1/9); its own 14.4 s rhythm |
| Unseen real-footage holdouts | partially working | right clip 4/5 and 4/6, exact moment rarely; 2 wrong clips flagged |
| Framing for mixed shapes (fill, per-shot bars) | verified | vertical beach holdout re-run: no letterbox, bars only where the reference has them |
| Titles (reading vs trace agreement, reviewed words) | partially working | sizes and colours right; uncertain words stay flagged; burned-in source text duplicated (known failure) |
| Reference soundtrack | verified | correlation 1.00, 0 ms lag and drift |
| Recreated audio structure | partially working | S4 relations 0.955 / 0.667, 0 inversions; effect levels off (bass hit masked) |
| Person masks (skip on unchanged frames) | verified | 2.2–2.9× faster; mean outline difference ≤ 0.65 % |
| ReferenceGrammar (measurement / confidence / interpretation / generated) | implemented | `matrix-ue/grammar-travel.json`; planner still reads the DNA |
| Shared decoding | planned, not justified | vision is ~83 % model inference |


**19 November Long Footage 2.1.** Five cases ran the full Windows flow on the current build (final matrix: `test-results/footage/*/native21-final`). Picks are graded from the preview's own explanation. Cached times vary with machine load (the 7 m 10 s case: 22 s quiet, 38 s under load):

| Case | Raw pool | Shots measured | In planted action | Right action | Cut crossings | Reuse | Preview first / cached |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `footage/long90` | one 90 s gym clip | 6 | 6/6 | 6/6 | 0 | 0 | 48 s / 17 s |
| `footage/multi` | three gym clips, 7 m 10 s | 9 | 9/9 | 9/9 | 0 | 0 | 145 s / 22 s |
| `footage/travel` | two generated city clips, 3 m | 6 | 6/6 | 6/6 | 0 | 0 | 62 s / 13 s |
| `footage/cooking` | two generated counter clips, 2 m 50 s | 6 | 5/6 | 4/6 | 0 | 0 | 166 s / 5 s |
| `footage/long11` | one 11-minute gym clip | 9 | 9/9 | 9/9 | 0 | 0 | 343 s / 60 s (machine under load) |

- **Repeated action:** the 90 s reference repeats the deadlift the footage holds once; the plan shares one repetition by movement phase, without reuse.
- **Long clips:** the 11-minute clip is analysed end to end (seven picks after minute 5).
- **Cooking:** pour versus stir is the remaining confusion; the signature has where small things move, not which way.

**19 November Long Footage 2.0.** The same two gym cases, plus a generated travel case; all three passed the full Windows flow on the current build, including "Choose another take" after Apply with Undo and Redo. Picks are graded from the preview's own explanation.

| Case | Raw pool | Reference shots measured | In planted action | Right action | Cut crossings | Reuse | First preview / cached |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `footage/long90` | one 90 s clip | 6 of 6 | 6/6 | 4/6 | 0 | 0 | 49 s / – |
| `footage/multi` | 2 m 10 s + 1 m 40 s + 3 m 20 s | 9 of 9 | 9/9 | 8/9 | 0 | 0 | 155 s / 19 s |
| `footage/travel` | two generated city clips, 3 m | 6 of 6 | 5/6 | 4/6 | 0 | 0 | 104 s / 18 s |

- **Held-out cases:** travel and cooking (`scripts/make-motion-case.mjs`) were not used to tune selection weights. Three cut-detector rules (camera movement, flow reset before a cut, punch-ins) came from their references. Cooking is measured offline only: 1/4, limited by two punch-in cuts strict reference mode still misses.
- **Remaining gaps:** a capacity conflict when the reference repeats an action the footage holds once (90 s case); thin margins between similar lifts; static holds decided by look.

**19 November long-footage selection.** Two cases were generated from local clips. Each raw file holds long held frames of the exercises (look-alike but motionless), with live action only at planted places. Both ran through the full Windows flow on the current build.

| Case | Raw pool | Reference | Picks in planted action | Right exercise | From a clip's first 10 s | Reuse |
| --- | --- | --- | --- | --- | --- | --- |
| `footage/long90` | one 90 s clip; action at 12–14, 31–34, 46–48, 67–70, 82–85 s | 8 s, 6 shots (5 measured) | 4/5 | 4/5 | 0 | 0 |
| `footage/multi` | 2 m 10 s + 1 m 40 s + 3 m 20 s; 10 action moments | 15 s, 9 shots (8 measured) | 6/8 | 3/8 | 0 | 0 |

- **Before the fixes:** the first real 90 s run picked 2/5; dense vision and missed-cut splitting brought it to 4/5.
- **Coverage:** the whole supplied duration is analysed; the coverage line reports supplied and analysed duration and the candidate count.
- **Gaps:** exercise identity between similar gym exercises, two cut-crossing windows in the multi-clip run, and about 18 minutes of first analysis for 7 minutes of footage.

**18 November structural recreation (3.1).** Evidence lives in `test-results/audio31/`: the generated corpus with ground truth under `corpus/`, and the Windows cases under `native/case1…5/`. Each case folder holds `native-verification.json`, screenshots, `render.mp4` and `av-metrics.json`. Every case passed the full Windows flow on the 3.1 build: preview, Apply/Undo/Redo, save, exit, reopen, playback, Inspector edit and Deliver.

| Detector on ground truth | S1 letterbox lyrics | S2 vertical montage | S3 dialogue + music | S4 beat montage |
| --- | --- | --- | --- | --- |
| Tempo (truth) | 96.8 (96) | 127.7 (128) | 98.4 (100) | 139.5 (140) |
| Beats F | 0.97 | 0.98 | 0.50 | 0.98 |
| Downbeats | 5/5 | 6/6 | wrong phase | 6/6 |
| Drops | none, correct | 1/1 | none, correct | 1/1 (13 ms) |
| Impacts | 1/1 | 2/2 | – | 1/1 |
| Cut relations | 4/4 | 10/10 | 0/3 ("in a pause" is not measurable without speech detection) | 21/21 |

| Windows case | Mode | Result |
| --- | --- | --- |
| 1. Reference 55, original clips | reference audio | Export byte-identical to 3.0; loudness correlation 1.00, lag 0 ms, drift 0 ms, beats F 1.00. One "Reference audio" track and no empty track. |
| 2. Reference 55, squat withheld | recreate on `music.wav` | Cuts 2/2, titles 50% (3.0: 26%), pulses 2/2 keep their relation in the export. 19/24 events mapped in order; 0 inversions; phrase-position error 0.045; effect-level error 2.6 dB. The reference drop has no counterpart because the replacement has none. |
| 3. Generated S1, full 12 s | reference audio | NEW HEIGHTS and "fall" reconstructed. Audio F 1.00, lag 0 ms; cuts 4/4 keep on / offbeat / sweep / after-impact. Bars on two tracks. Defects: a false large "rise" title; "we" and "and" unread. |
| 4. Generated S3 dialogue + music | reference audio | Cuts exactly at the three pauses; ducking preserved by the soundtrack; lag 0 ms; all four captions worded correctly. Defects: phrases 1 and 3 timed short, phrase 4 in three fragments. |
| 5. Generated S4 beat montage | recreate on `music.wav` | 22/22 events mapped in order; cuts 21/22 and titles 6/9 keep their relation; phrase error 0.002; effect-level error 4.3 dB. The drop is not reproduced (the replacement has none). |

**18 November audio fidelity (3.0).** References now carry a measured audio timeline and an audio/visual event graph on one millisecond clock (see `AI_ARCHITECTURE.md`). There are three audio modes: supplied music, the reference soundtrack as an editable clip, and the reference's audio structure recreated on supplied music with generated effects.

### Detector accuracy on generated ground truth

`scripts/make-reference-corpus.mjs` generates two structurally different references from ffmpeg generators and synthesised sound; nothing is downloaded or copyrighted:
- **S1**: 1280 × 720 letterbox, 96 BPM, sung syllables as word captions, a whoosh into a title, one offbeat cut, one cut 66 ms after an impact, a silence.
- **S2**: 720 × 1280, 128 BPM, a cut every two beats, white flashes on impacts, a riser into a drop, titles on downbeats.

Scores come from `scripts/measure-av-fidelity.mjs --truth` (`test-results/audio3/corpus/*/self-metrics.json`):

| Category | S1 | S2 |
| --- | --- | --- |
| Beats (±70 ms) | F 0.97, median error 25 ms | F 0.98, 24 ms |
| Tempo (median) | 96.8 BPM (truth 96) | 127.7 BPM (truth 128) |
| Downbeats | none reported (phase evidence below threshold) | 6/6 |
| Impacts (±50 ms) | 1/1, no false impacts | 2/2, no false impacts |
| Sweep peak (±150 ms) | 1/1, 0 ms | 1/1, 100 ms |
| Silence edges (±120 ms) | 2/2, median 26 ms (plus the real trailing silence) | – |
| Drops | 1 false (music re-entering after the silence) | wrong: reported at the first impact, missed at the riser climax |
| Cuts / flashes from pixels | 4/4, 0 ms | 10/10 and 2/2, 0 ms |
| Cut relation to audio (event graph vs. how the cut was placed) | 4/4 (on, offbeat, on sweep peak, after impact) | 10/10 |

Before this pass, the same corpus exposed four errors:
- S1 tempo was doubled (193 BPM), because the off-beat hats were tracked as beats.
- Five sung notes that started on a kick were called impacts.
- The whoosh was compared at its tail, not its peak.
- A track that simply ended was called a fade.

Flatness, the octave check, sub-band ring and gradual-fade tests fixed these.

### Windows application cases

Each case below runs in the rebuilt `bin/supp-edit.exe`, driven through its own interface by `scripts/verify-native-focused.mjs`: preview with audio evidence, Apply, Undo, Redo, save, exit, reopen, playback in the program monitor, an Inspector edit, then Deliver. Results are in `test-results/audio3/native/<case>/`: `native-verification.json`, screenshots, `render.mp4`, `compare-av.mp4` (side by side, audio track 1 the recreation, track 2 the reference) and `av-metrics.json`.

**Case 1: reference 55, original raw pool, reference audio (0–7.967 s).**
- *Plan:* the soundtrack is extracted to its own WAV asset on a "Reference audio" track at Source In 0, the reference video never enters the timeline, and 18 audio-event markers drive 22 layers.
- *Export audio against the reference:* loudness-envelope correlation 1.00, mean level −0.03 dB, lag 0 ms, drift 0 ms, beats F 1.00, onsets F 0.94. One of 4 reference transients is not re-detected in the export.
- *Pixel cuts:* F 0.95, median error 0 ms.
- *The edit's own events (layer times) against its exported audio:* both cuts on an audio event, 57% of title entrances, 1 of 2 pulses; median offset 23 ms.
- *Repeatability:* the export from the final build is byte-identical to the export from the build before it.

**Case 2: reference 55, squat withheld, recreate audio structure on `music.wav`.**
- *Plan:* the music is offset 3.48 s, and 20 linked events move onto replacement events (largest shift 140 ms) while 8 keep their reference time. A riser (trimmed from its start so it peaks on its event) and a bass hit are generated as WAV assets on "Recreated SFX"; both are audible in the export: a −5.8 / −10.3 dB peak against −20.6 dB music-only.
- *How the edit's own events (layer times) relate to the exported audio:* 1 of 2 cuts on an audio event, 29% of title entrances (the reference has 73% on its own soundtrack), pulses one after and one offbeat. The replacement is 120 BPM against the reference's 160, and events only move to a same-family event within 150 ms, so the structure transfers only partly. This is a measured shortfall, not a pass.

**Case 3: generated reference S1, letterbox and lyric captions, reference audio (4.0–12.0 s; focused reconstruction accepts at most 8 s).**
- *App analysis of S1:* 4 measured shots (0.7 / 1.0 / 3.4 / 2.9 s, matching the placed cuts), 92–98 BPM (truth 96), one whoosh, one impact, two silences. Cut grammar: one on the sweep peak, one after the impact, one offbeat, exactly as placed.
- *Plan:* the reference content box is measured, bars are reproduced on "Letterbox · top" and "Letterbox · bottom" tracks with footage covering the box, the soundtrack starts at Source In 4.000 s, and 3 audio-event markers drive 3 layers.
- *Export audio against the reference:* onsets, beats and transients F 1.00; loudness correlation 1.00; +0.18 dB; lag 0 ms; drift 0 ms. Pixel cuts 3/3 within a frame.
- *The edit's own events against its exported audio:* the cut on the sweep peak (0 ms), the cut after the impact (+77 ms; placed +67 ms), the caption "tonight" on a kick.
- *Not reproduced:* the NEW HEIGHTS title over the dense cellular-automaton picture, and the caption "fall", which was flagged for review with OCR's partial reading rather than guessed.
- *Detector fragility:* the metric script re-analyses only the 8 s excerpt, and there the tracker doubles to 194 BPM; the app's analysis of the whole 12 s gives 92–98 BPM. The octave check is not yet robust on short, vocal-heavy windows.

**Process notes.**
- The first case 2 run failed its single-value assertion. Playback started near the end and looped, so a timeline click landed on a track's mute button. The driver now starts from frame 0 and confirms the pause.
- A force-closed run left a crash-recovery snapshot that the next launch restored. The driver now refuses to start when one exists.
- One Deliver run stayed on "Rendering…" after the file was complete. The front end awaited media cleanup (`AudioContext.close()`) indefinitely; cleanup now has a bounded wait.
- In the final case 3 run the app reported "Export complete · 35.8 s", but the driver lost its debugging page handle. The step is recorded from the reattached window, and the driver now reattaches by itself.

**16 November fidelity increment (not style acceptance).** Both supplied gym references now have actual 1080 × 1920 Windows Close Match exports in `test-results/fidelity-breakthrough/{54,55}/final`. Every frame decodes; permitted raw sources only, no detected black frames or dark side bars, and zero measured music lag in three windows. Measured installed-font ink geometry places text within the foreground footage. Cast-aware OCR recovers YOU, CANNOT and REASON in the second reference, and conservative depth analysis correctly leaves REASON in front. Missing ornate words, coarse timing, excessive background blur, subject scale and green-tinted grading remain failures. See `REFERENCE_FIDELITY_BREAKTHROUGH.md` for before/after diagnostics and mode-specific verification; no overall similarity percentage is claimed.

**14 November portrait evidence.** The first supplied gym Reel produced an eight-shot 1080 × 1920 Close Match Windows export. All 506 frames decode with audible AAC, no fully black frames, no detected dark side bars and at most 8.34 ms cut-start error. The render graph contains only the selected raw footage and supplied music. Frame 340 confirms removal of the baked squat letterbox. Inspect `test-results/fidelity2/54/windows-close/{render.mp4,comparison.json,comparison.png,frame-340.png}`. The blurred background preserves the visible exercise equipment but differs substantially from the reference composition.

The first layered native save reopened after a full process restart. A manual correction from “MISs” to “MISS” retained the title's animation keys and the five editable mask layers. Gym reference 55 still has unresolved textured lettering, an occluded title and a creator end card. Person-mask evidence in `test-results/fidelity2/55/person-masks.png` shows limb and equipment errors. The accurate subject segmentation and ornate typography acceptance criteria remain open.

The Windows editor creates editable sequences from reference measurements and selected raw footage. The accepted cases include an earlier four-shot gym edit and an eight-shot coastal workflow. The two newly supplied gym Reels expose further typography and style gaps.

| Capability | Evidence and practical boundary |
| --- | --- |
| Three editing modes | Earlier four-shot gym reference passed actual Windows import/analyze/preview/apply/revise/undo/redo/save/full restart/reopen and separate MP4 exports. All three coastal modes also passed full restart, reopen and separate Windows Deliver exports. Each has eight editable shots with different pacing and trims. |
| Safe framing | Coastal fill framing eliminates unwanted side bars in decoded outputs. Protected subject geometry limits automatic zooms and transition movement. Wide groups can still require preserved borders instead of unsafe cropping. |
| Flash / blur | Actual decoded coastal footage shows a flash at 2 seconds and blur at 4 seconds in the controlled transition fixture. Editable ordinary shapes/effects survive native serialization. The controlled reference is an engineered treatment on real footage, not an unrelated natural-style acceptance. |
| Zoom / whip / motion | Six encoded controller peaks match authored camera animation better than disabled controls. Parameters and parent controllers are editable. Unsafe cases use disclosed blur fallback. Automated output classification still calls some of these cuts; recognition is approximate. |
| Grading | Bounded per-shot brightness/contrast/saturation/temperature and vignette proxies work. Neutral-source saturation amplification was corrected. Exact LUT, skin isolation, selective lighting and cinematic grade recovery are unsupported. |
| Color consistency | A real HLG raw source exposed CPU/GPU differences. A shared sRGB source surface fixes three actual SDR/HLG parity samples to below 0.37/255 before compression. All nine sampled frames across three corrected desktop MP4s agree with the CPU preview within 2.44/255 mean pixel error. Delivery is 8-bit SDR. |
| Text | Prior simple gym titles and kinetic typography passed native rendering/editability acceptance. New OCR and placement fixes preserve short/overlapping words and horizontal layout. Ornate, video-filled, partially hidden and rapidly animated lettering is not reliably recovered. |
| Creator labels | Recurring edge-label candidates are flagged using repeated text/geometry evidence, excluded from caption recreation and disclosed. This heuristic can need manual review. It does not infer ownership or remove watermarks from source media. |
| Color flashes | Two inversions in the supplied second gym reference are measured at 4633–4700 and 4767–4833 ms, avoiding four false shot boundaries. The desktop MP4 reproduces the two two-frame negative duotones with editable color layers and raw-source luma mattes. The measured palette approximates the treatment. Exact selective color and subject masks remain unsupported. |
| Speed / music | Existing bounded editable speed curves and measured onset placement work. Original optical speed curves, optical-flow interpolation, pitch-preserving retiming and inferred music licensing are not provided. No music-sync claim is made for the coastal reference without supplied music. |
| Subject effects | Automatic silhouette fills, accurate subject segmentation, text behind a person, advanced tracked masks, particle/3D treatments and object replacement are unsupported in this workflow. |
| Source isolation | Planned/rendered media sources are restricted to selected raw footage and supplied audio. Recursive verification rejects reference or unknown asset paths. Reference video remains available only for analysis/comparison. |

## Export evidence

Open test-results/reference-coastal/reviewed/Three-modes.supp for the editable coastal timeline. The before/after snapshots agree on every asset and composition, including manual brightness 0.96. The final Windows renders, inspection sheets, per-shot measurements and decoded checks are in test-results/reference-coastal/final.

| Mode | Frames | Duration | Maximum sampled preview error | Fully black / dark side-bar frames |
| --- | ---: | ---: | ---: | ---: |
| Close Match | 528 | 17.600 s | 2.34/255 | 0 / 0 |
| Smart Adaptation | 591 | 19.700 s | 2.44/255 | 0 / 0 |
| Creative Remix | 491 | 16.367 s | 2.22/255 | 0 / 0 |

All coastal MP4s decode as 1280 × 498 H.264 video with audible AAC. All seven boundaries were classified as cuts in each decoded output. Close Match reproduces every cut start within 16.34 ms. Smart Adaptation extends holds by up to 1.89 s in cumulative timing and Creative Remix shifts boundaries by up to 0.99 s. The horizon, rocks and beach fill the frame. Boats, birds, aerial views and the reference's turquoise water cannot be recovered from the two ground-level raw clips. The coastal reference contains no typography or music to match.

The controlled flash/blur and camera tests use real footage with known authored transitions. See test-results/reference-transitions/reviewed/Close-Match and test-results/reference-motion/render-check. Six encoded controller peaks match the authored motion better than the disabled controls. The detector still classifies the softer output peaks as cuts. Natural travel edits with these transitions remain an open acceptance case.

## Supplied gym Reels

The five independent raw takes include squat, bench, incline, deadlift and row. The separate music asset is the soundtrack. Text baked into some raw exercise clips remains visible and may be cropped. It cannot be edited like a generated title. Original-word mode currently reproduces recognized words, so incorrect or missing OCR requires manual review.

- The first Close Match MP4 under test-results/reference-user54/multi-raw/reserved/Close-Match lasts 506 frames (16.867 s). The compositor and native encoder cover all eight measured intervals after reserving capacity for the long final hold. Side-by-side inspection shows the right cut timing but several missing, doubled or misspelled lyric fragments.
- The second Close Match MP4 under test-results/reference-user55/multi-raw/validated/Desktop was exported through Windows Deliver after opening the editable three-mode project. It has four shots and 392 frames (13.067 s). All frames decode and none is fully black. First/middle/last mean preview error is at most 1.92/255. Frames 139–140 and 143–144 contain the two measured color pulses. Against a render with both pulse layers disabled, the active-frame error exceeds 74/255 in grayscale. With the authored layers enabled it stays below 0.41/255. Adjacent normal frames are identical with the controls enabled or disabled before encoding.
- Full visual recreation of both references remains incomplete. The second output misses much of the ornate lettering and branded end card. The subject silhouette, text behind the athlete, relief/texture inside lettering, precise fonts and original speed curves remain capability gaps.

## Next acceptance cases

Each supplied reference now has three separate, decoded H.264/AAC exports. In Close Match, Smart Adaptation and Creative Remix order, the first sequence lengths are 506, 514 and 436 frames. The second lengths are 392, 410 and 384. These six outputs used the production compositor and native encoder. The separate Windows Deliver run for the second Close Match is in `validated/Desktop`. Each comparison sheet shows reference shots above the generated shots. The first reference's gym clips retain narrow side borders on several shots, including 194 frames in Close Match. Side-bar acceptance applies to the coastal case.

Review title wording now allows the user to correct or remove individual recognized titles before Apply. Updating the preview preserves the source trim, styling and title interval. Browser acceptance changed a two-word title to three words and verified Apply, Undo, Redo, save and reopen. This addresses correction of proposed wording. Automatic recognition of missed lettering still needs work.

Improve recognition of uncertain words and text spanning cuts. Test foreground masks and text occlusion on independent moving subjects. Compare unrelated natural travel, lifestyle, talking-head and cinematic references through the complete native workflow. Track color error, layout agreement and cut timing separately. The current confidence values measure rule evidence and have no calibrated overall style score.
