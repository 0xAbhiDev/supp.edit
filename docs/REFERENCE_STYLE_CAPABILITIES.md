# Reference-to-Edit capability evidence — 13 November 2026

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
