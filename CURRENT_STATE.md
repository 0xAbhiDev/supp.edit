## 4.4 body pose and the rest of what stopped different-footage editing — 22 November 2026 (committed as `a237673`)

**Builds:**
- **Final:** `bin/supp-edit.exe` sha256 `2af2ae1d892d91f5d4aa4232baf72ee7cb6bdc39ac029919cb2f9360cc46230d` (`test-results/final44/build-identity.txt`).
- **Baseline:** the committed 4.3 source `aa07a62` (build `218c7a9b`, kept at `final43c/bin/`).

**Tests:** TypeScript 306/306 (44 files), native 54/54, type check clean.

**Model download (approved by the user):** MediaPipe person detector and pose landmarks (OpenCV model zoo, Apache 2.0), 17.6 MB, pinned by revision and sha256 in `native/crates/supp-media/src/pose_model.rs`. In the app: AI models → "Download and install body pose". Without it, matching works as in 4.3.

**What changed, and why** (`test-results/final44/README.md`):

| Change | Status | Evidence |
| --- | --- | --- |
| Action from body pose: knee, hip, elbow and shoulder angles (3D joints) and torso lean, time-warped against the reference shot | VERIFIED (gym shot 3) | Gym shot 3 → **deadlift 1.73–6.80 s** (was a beach squat in every earlier build). No graded case lost. |
| Body pose counted double outside Creative Remix | VERIFIED as neutral in Close Match | Remix excluded: it cost multi-clip Remix one shot offline. |
| Sequence plan weights each shot by its length | VERIFIED | Lets the long lift shot win the deadlift footage over a short shot. No graded case changed. |
| Still shots: measured movement counts half instead of being ignored | VERIFIED | Street 4/6 → **5/6** right action; cooking stays 6/6. |
| Close match needs 65% confidence | VERIFIED | Wrong picks labelled "close match": 7 → 3 across the holdouts and A/B assets (see below). |
| A body on one side and nobody on the other costs ×0.9 | VERIFIED | A/B assets: false confident 1 → **0**; the bent-over row (not in the footage) gets the deadlift clip, not a beach. |
| A dissolve asks for footage before the shot's in-point | VERIFIED | Transition-heavy case rebuilds its dissolve again (4.3 kept it as a cut). |
| Burned-in text on unrelated footage costs at most 0.04 | VERIFIED | At 0.08 the deadlift clip's own "DEADLIFT" label made it lose in the app. Burned-in-text holdout unchanged (5/6). |
| Title size veto requires the reading to overlap the trace | PARTIAL | Lets "A" through. Tiger is still rejected (no installed font matches its script hand); MOUTH unchanged. |

**Final-build Windows matrix** (`test-results/final44/summary.md`, `binaries.txt`):
- **How it ran:** every title traced fresh. All 19 runs and the take check launched `2af2ae1d`.
- **Every check passed:** each run played, reopened identically and exported a valid MP4. 0 fallback placements.

| Case | 4.4 (exact · right action · right clip) | 4.3 final |
| --- | --- | --- |
| Cooking / travel | 6/6 · 6/6 · 6/6 each | same |
| 26 min / multi-clip | 9/9 · 9/9 · 9/9 each | same |
| Remix multi-clip | 9/9 · 8/9 · 9/9 | same |
| **Remix 11 min** | 9/9 · **8/9** · 9/9 | 9/9 · 7/9 |
| Smart 90 s | 6/6 · 6/6 · 6/6 | same |
| Previous landscape holdout | 5/6 · 5/6 · 6/6 | same |
| First vertical holdout | 4/6 · 4/6 · 5/6 | same |
| Workshop | 5/6 · 4/6 · 5/6 | same |
| **Street** | 5/6 · **5/6** · 6/6 | 5/6 · 4/6 |
| **Formerly sealed** | **4/6 · 4/6** · 5/6 | 3/6 · 3/6 · 5/6 |
| A/B assets (seen; regression check) | right moment 2/4 · right clip 3/4 · unavailable flagged 3/3 · **0 false confident** | 2/4 · 3/4 · 3/3 · 1 |
| Transition-heavy | **dissolve rebuilt** (dissolve, flash, whip) | kept as a cut |
| Gym reel | **shot 3 = deadlift lift** (best available 50%); shot 1 not the deadlift | 0 of 2 |

**Labels:** wrong picks still labelled "close match":
- vertical holdout shot 2, 93%: the wrong repetition of the same footage;
- workshop shot 4 and street shot 3, 100%: a hold in the same footage, at another moment.

All three are same-footage identity claims. The 4.3 calibration failures on shots with nobody in them (vertical holdout shot 3, formerly sealed shots 1 and 5, A/B shot 5) are gone.

**Other checks on the final build:**
- **Audio:** whoosh −27 / −26 ms, riser −0.3 dB (+10 ms), no clipping.
- **Takes** (`final44/takes-case5.log`): 66 takes, 0 mismatches after Apply, take, Undo, Redo and Save/Reopen.
- **Titles:** HONORABLE present (gym and reel55 runs).

**Still failing:**
- Gym shot 1 (the set-up over the bar): the deadlift footage goes to the lift; the rest is squat or incline.
- The bench clip's scene detector splits it at each animation of its burned-in label, so the A/B's two press shots compete for one stretch (right moment 2/4).
- Still shots: no measured signal separates a right still pick from a wrong one.
- Same-footage identity can claim the wrong repetition or hold (the three labels above).
- Tiger and MOUTH titles.
- Body pose from a floor-level camera is noisy (bent elbows read on a straight-armed lift).

The limits listed under 4.2 still apply: references over 90 s, non-Windows builds, banding, the 26-minute reopen incident, and a broad real evaluation set.

## 4.3 selection fixes — 22 November 2026 (not committed; awaiting approval)

**Builds:**
- **Final:** `bin/supp-edit.exe` sha256 `218c7a9be48ee51f2139dddd040ed5a6e6aceac9cd8fe61d0d23b6e1a40a3587` (`test-results/final43c/build-identity.txt`).
- **Earlier builds of this round:** `e97a5b37` (`final43/`) and `bbe22ce7` (`final43b/`), each binary kept in its folder.
- **4.2 final:** `e3ebf2f9`, kept at `final42b/bin/`.

**Tests:** TypeScript 300/300 (43 files), native 52/52, type check clean. One earlier full-suite run had 2 timing failures that passed alone and in two reruns.

**What changed, and why** (`test-results/final43b/README.md`):

| Change | Status | Evidence |
| --- | --- | --- |
| Planner keeps its own picks (`plannedRange`: within two frames at either end of a range; `sourceFramesPlayed`: a slowed shot consumes only the source frames it plays) | VERIFIED | Street holdout 3/6 → 4/6 (shot 6 plays its planned cyclist moment). Gym, street, formerly sealed and transition cases: 0 fallback placements (4 before). Gym export valid again. |
| Person check on first runs: title tracing's unchecked subject shapes are cleared | VERIFIED | Fresh-title matrix (`final43c/`) equals the cached-title matrix (`final43b/`) on every graded result and label. |
| Reference movement without colour pulses and person flashes (`effectSpans`) | VERIFIED as neutral | No pick changed offline or in the app. Gym shot 3's label rose from "missing" to "weak". |
| Scoring candidates at the zoom the edit could apply | Tried, reverted | Favoured the smallest, most distant subject (beach squat). |
| Transition spans left out of reference movement | Tried, reverted | Two new false close matches offline. |
| Vision-model activity labels as evidence | Measured, not used | Favours deadlift for gym shot 1 (0.78 vs 0.51) and against it for shot 3 (0.22). |

**Final-build Windows matrix** (`test-results/final43c/summary.md`, `binaries.txt`):
- **How it ran:** every title traced fresh. All 19 runs and the take check launched `218c7a9b`.
- **Every check passed:** each run played, reopened identically and exported a valid MP4.

| Case | Final 4.3 (exact · right action · right clip) | 4.2 final | 4.1 |
| --- | --- | --- | --- |
| Cooking | 6/6 · 6/6 · 6/6 | 6/6 · 6/6 | 5/6 · 4/6 |
| Travel / 26 min / multi-clip | 6/6, 9/9, 9/9 | same | same |
| Remix multi / Remix 11 min / Smart 90 s | 9/9 · 8/9; 9/9 · 7/9; 6/6 · 6/6 | same | same |
| Previous landscape holdout | 5/6 · 5/6 · 6/6 | same | 5/6 · 5/6 |
| First vertical holdout | 4/6 · 4/6 · 5/6 | same | — |
| Workshop | 5/6 · 4/6 · 5/6 | same | 5/6 · 4/6 |
| **Street** | 5/6 · **4/6** · 6/6 | 5/6 · 3/6 | 5/6 · 5/6 |
| Formerly sealed | 3/6 · 3/6 · 5/6 | 3/6 · 3/6 · 6/6 | 3/6 · 3/6 |
| A/B assets (seen; regression check) | right moment 2/4 · right clip 3/4 · unavailable flagged 3/3 · 1 false confident | 2/4 · 2/4 · 3/3 · 0 | blind: 2/4 · 3/4 · 2/3 · 2 |
| Transition-heavy | dissolve still kept as a cut | same | rebuilt |
| Gym reel | 0 of 2 usable-deadlift shots; labels honest; export valid | 0 of 2 | 0 of 2 |

**Other checks on the final build:**
- **Audio** (`final43c/*/effect-tracks.json`): whoosh −27 / −26 ms, riser −0.3 dB (+6 ms), impacts and bass hit −0.7 to −2.2 dB, no clipping.
- **Takes** (`final43c/takes-case5.log`): 66 takes, 0 mismatches after Apply, take, Undo, Redo and Save/Reopen; Restore exact.
- **Titles:** HONORABLE present on the fresh-title run.

**Honest-label correction to 4.2:**
- The 4.2 final matrix traced titles fresh, and its person check was then incomplete: phantom subject shapes from title tracing reached the scorer.
- With the check now applied on every run, three shots carry close-match labels on wrong picks:
  - vertical holdout shot 3, 63%;
  - formerly sealed shot 1, 89%;
  - A/B shot 5, 53%.
- Those are calibration failures the 4.2 labels hid by accident. Confidence on shots with nobody on either side rests on movement geometry alone, which cannot separate two moments of one clip.

**Still failing:**
- the gym deadlift (ranking, not retrieval);
- different-footage matching in general (blind A/B 2/4);
- the transition case's dissolve;
- the three false close matches above;
- Tiger and MOUTH titles;
- same-footage repetitions (vertical holdout shot 2, 93%).

The limits listed under 4.2 still apply.

## Universal Reference-to-Edit 4.2 — 21 November 2026 (not committed; awaiting approval)

### Builds and evidence
- **Checkpoint:** still `1f06d94` plus uncommitted work. Nothing committed or pushed; `.claude/` stays uncommitted.
- **Preserved 4.1:** source and binary `7e12e200…` in `test-results/preserved-4.1/` (patch, byte-exact files, untracked files, manifest).
- **Frozen 4.2:** `18fac9fb…`, kept at `test-results/final42/frozen-bin/`. It ran the blind A/B and the frozen regressions (`test-results/final42/`).
- **Final build:** `bin/supp-edit.exe` sha256 `e3ebf2f9af4450fcf4e18e37642f60fdc1b6b161ecdf1c7bebe322737060279f`, written 21 Nov 21:04:57 (`test-results/final42b/build-identity.txt`). It is the frozen build plus the person check, presence evidence, the fallback label and the title fragment merge.
- **Run identity:** all 20 final-build runs launched that executable. `test-results/final42b/binaries.txt` matches each run's recorded path, size and mtime; the running app's image hash was checked as `E3EBF2F9…`.
- **Tests on the final source:** TypeScript 295/295 (42 files), native 52/52, type check clean (`final42b/tests-ts.txt`, `tests-native.txt`).

**Runs not used, and why:**
- **Frozen R6** (previous landscape holdout): Windows entered Modern Standby at 17:08:44 during Deliver and woke at 20:01:32 (System log, Kernel-Power 506/507). Its first edit was graded from the preview (5/6). Not rerun on the frozen build; the final build's F13 ran the full flow.
- **`final42b-superseded/`:** F1–F5 on an intermediate build (`da4d15c2…`), stopped when the title fix replaced it.
- **A discarded title test:** a copy into `bin/` failed because an orphaned matrix instance held the executable open. That attempt launched the old build and failed. The orphaned driver and app were stopped before `e3ebf2f9` was installed.
- **Blind A/B outputs:** `footage/different42/ab-41`, `ab-42` are untouched since grading at 16:41. The labels hash still matches (`f683d4fa…`).

### 1. Generated whoosh and riser — VERIFIED (controlled; Windows app on the final build)
Causes, fixes and the controlled 24-case before/after: `test-results/audio42/README.md`.

| Effect | Controlled, before → after |
| --- | --- |
| Whoosh | timing 484 → 23 ms, level 5.0 → 0.5 dB |
| Riser | timing 737 → 70 ms, level 14.5 → 0.6 dB |

**On the final build:** decoded exports, measured on isolated tracks rebuilt from the saved project (within 0.01–0.02 dB of the export): `final42b/{s1-whoosh,reel55,s4-montage}/effect-tracks.json`.

| Effect | Timing error | Level error |
| --- | --- | --- |
| Whoosh, letterbox lyrics | −27 ms | −0.3 dB |
| Whoosh, 22-shot montage | −26 ms | −0.2 dB |
| Riser, reel 55 | +6 ms | −0.3 dB |
| Impacts and bass hit | start on the frame | −0.7 to −2.2 dB |

- No clipping: sample peaks 0.20–0.35.
- Save/Reopen identical.
- **Not done:** I cannot listen. Excerpts for listening in context are in `audio42/listen/`.

### 2. Alternative takes that repeat another shot — VERIFIED (Windows app, final build)
22-shot montage, `final42b/takes-case5/` (`takes-case5.log`). There are 63 takes; the app's warnings equal an independent overlap computation from the saved file at every stage (0 mismatches each):

| Stage | Warned |
| --- | --- |
| After Apply | 43 |
| After choosing a take | 40 |
| After Undo | 42 |
| After Redo | 40 |
| After Save → Exit → Reopen | 40 |

- The driver asserts that the timeline after Undo equals the timeline after Apply. It does; 42 vs 43 is which take buttons are on screen.
- **Separate moments of the same clip stay available without a warning:** all 63 takes come from clips other shots also play. 43 overlap a played interval (warned); 20 are separate moments (not warned), one of them within 300 ms of another shot.
- **Deliberate reuse:** the chosen take was labelled "Repeats shot 21 (0.3 s of the same moment)" before the click. "Restore the first choice" after the reopen restored the plan exactly.
- Unit tests cover full, partial, adjacent and separate overlap, and intentional reuse (`tests/take-reuse.test.ts`).

### 3. Blind A/B on unseen different footage (frozen implementation) — FAILED to improve
**The case:** one reference against four real raw clips that are different recordings (gym and beach). Acceptable intervals and unavailable shots were recorded in `footage/different42/labels.json` before any build ran (sealed 16:07:28). Each build ran once, and both were graded after both outputs were saved.

**Result: identical on both builds** (`ab-41/grade.json`, `ab-42/grade.json`).

| Measure | 4.1 | Frozen 4.2 |
| --- | --- | --- |
| Available shots, right clip | 3/4 | 3/4 |
| Available shots, right moment | 2/4 | 2/4 |
| Unavailable shots flagged "best available" | 2/3 | 2/3 |
| False confident matches | 2 | 2 |
| Under-confident correct pick | 1 | 1 |

| Shot | Shows | Both builds picked | Shown | Verdict |
| --- | --- | --- | --- | --- |
| 1 | sea under cloud | forster-beach 11.00–12.60 s | close 88% | right |
| 2 | incline press | bench 0.80–2.23 s | best 33% | right, under-confident |
| 3 | flower (unavailable) | forster-beach | close 76% | **false confident** |
| 4 | bent-over row (unavailable) | forster-beach | best 32% | appropriately flagged |
| 5 | rocky coast | forster-beach 16.33–17.57 s | close 53% | right clip, wrong moment, **false confident** |
| 6 | incline press, another repetition | deadlift | best 31% | wrong clip, flagged |
| 7 | two people (unavailable) | squat | best 30% | appropriately flagged |

**Same assets on the final build** (a regression check; these assets are no longer unseen): `final42b/different42.grade.json`.

| Measure | Blind result | Final build |
| --- | --- | --- |
| Right moment | 2/4 | 2/4 |
| Right clip | 3/4 | 2/4 |
| Unavailable flagged | 2/3 | 3/3 |
| False confident | 2 | 0 |

- Shot 3 is now flagged (squat, best 30%).
- Shot 5 moved to the wrong clip (squat, flagged best 30%).
- Shot 4 still puts a beach under a gym row (flagged).

**Cold vs warm**, frozen build, same footage and hardware: preview 139 s cold (reference 64 s; 48 s of footage analysed in 36 s) vs 50 s warm (3.4 s analysis, 28/28 stages reused) (`ab-42.log`, `warm-42.log`).

### 4. Final-build Windows matrix (first one-click edit) — `test-results/final42b/summary.md`
- **How it was graded:** from the preview's own explanation of each choice ("Explained each choice"), before any take or Inspector edit.
- **Full flow:** every run then did Apply/Undo/Redo, an alternative take, Save → Exit → Reopen (identical), playback, an Inspector tone edit (not applicable in Creative Remix, which keeps no matched curve; also skipped in 4.1), and Deliver.
- **Every check passed:** every run played, reopened identically and exported a valid MP4 (0 drift, 0 black frames, 0 decode errors).
- **Columns:** exact moment / right action / right clip; denominators are reference shots.

| Case | Final build | 4.1 | Frozen 4.2 | Change |
| --- | --- | --- | --- | --- |
| Cooking (different recordings) | **6/6 · 6/6 · 6/6** (6/6 close match) | 5/6 · 4/6 | 5/6 · 4/6 | **+2** |
| Travel | 6/6 · 6/6 · 6/6 | 6/6 · 6/6 | 6/6 · 6/6 | = |
| 26-minute | 9/9 · 9/9 · 9/9 | 9/9 · 9/9 | 9/9 · 9/9 | = |
| Multi-clip | 9/9 · 9/9 · 9/9 | 9/9 · 9/9 | 9/9 · 9/9 | = |
| Multi-clip, Remix | 9/9 · 8/9 · 9/9 | 9/9 · 8/9 | 9/9 · 8/9 | = |
| 11 min, Remix | 9/9 · 7/9 · 9/9 | 9/9 · 7/9 | — | = |
| 90 s, Smart Adaptation | 6/6 · 6/6 · 6/6 | 6/6 · 6/6 | — | = |
| Previous landscape holdout | 5/6 · 5/6 · **6/6** | 5/6 · 5/6 | 5/6 · 5/6 | shot 6: was the wrong clip labelled "close 51%"; now the right clip, wrong moment, "best 30%" |
| First vertical holdout | 4/6 · 4/6 · 5/6 | not run (pre-identity app 1/6) | 4/6 · 4/6 | = |
| Workshop holdout | 5/6 · 4/6 · 5/6 | 5/6 · 4/6 | — | = (two wrong picks swap, both labelled close) |
| Street holdout | 5/6 · **3/6** · 6/6 | 5/6 · 5/6 | — | **−2, regression** |
| Formerly sealed holdout | 3/6 · 3/6 · **6/6** | 3/6 · 3/6 (5/6 clip) | 3/6 · 3/6 | clip +1 |
| Transition-heavy | 9 boundaries detected as in 4.1; flash and whip rebuilt, **dissolve kept as a cut** | 9/9 kinds; dissolve, flash, whip rebuilt | same as 4.1 | **dissolve lost, regression** |
| Gym reel, recreated/reference audio, 22-shot montage | no selection truth (gym: by inspection, below) | — | — | — |

**Identity (same footage):**
- Landscape holdout: 5 claims, all right.
- Formerly sealed holdout: 3 claims, all right.
- First vertical holdout: 5 claims, **1 wrong**. Shot 2 claims squat 4.67–6.00 s at 93%, but the planted moment is squat 10.96–12.95 s: another repetition. The frozen build makes the same claim; that holdout was not in the 4.1 app matrix.

### Material regressions on the final build
1. **Street holdout, right action 5/6 → 3/6** (`final42b/street-attribution.md`).
   - **Not the person check:** the app found no outlines on this reference.
   - **Shot 2:** the 4.2 still-shot rule (`STILL_LEVEL`/`bothStill`, added before the A/B for cooking) reorders the plan. Reverting only that rule offline restores 4.1's picks.
   - **Shot 6:** lost to the planner's fallback. Its planned moment was adjacent to shot 2's and judged "no longer free".
2. **Transition-heavy: the 6.2–6.8 s dissolve became a cut.**
   - The person check rejected 25 of 25 phantom reference outlines. That flipped shot 5's near tie (margin 0.018) to forster-beach starting at the clip's first frame, so there is no lead-in for a dissolve.
   - The app says so: "dissolve measured, but the incoming take has no clean footage before it; retained a cut".
3. **A/B assets, right clip 3/4 → 2/4** (regression check, shot 5), while false confident matches went 2 → 0.

### Cooking: the offline gain holds in the Windows app — VERIFIED (this case)
`final42b/cooking.log`; frozen `final42/cooking.log`; offline `final42/cooking-diagnosis/`.

| Shot | Frozen 4.2 / 4.1 pick | Final build | Changed by the person check? |
| --- | --- | --- | --- |
| 1 pour | cook-B 9.00–10.60 s (stir), best 41% | **cook-A 7.03–8.63 s (pour 6–9.5)**, close 76% | yes |
| 4 finished dish | cook-B 15.43–17.23 s (no labelled action), **close 83%: false confident** | **cook-A 59.73–61.53 s (finished 58–62)**, close 100% | yes |
| 5 stir | cook-B 62.03–63.53 s | cook-B 9.03–10.53 s | moved, both right |
| 6 pour | cook-A 7.07–8.37 s, best 46% | cook-A 77.03–78.33 s, close 70% | moved, both right |

**What changed:**
- **The reference check:** 84 outlined frames, all 84 contradicted by the detector, 0 without detector data, 4 detector frames (`cooking/app-console.log`, "reference person check 84 84 0 4"). So every reference frame was *measured as empty*; none was *unavailable*.
- **The raw clips:** no reference shot kept a person, so the clips were not segmented at all; the "person masks" stage is absent. Neither measured-empty nor unavailable applies to them. On the frozen build they were segmented: phantom outlines on 920/920 and 780/780 frames.
- **The scores:** the phantom "subject" movement term (0.51–0.72) and pose term disappear from the explanations.
- **Attribution:** the only selection change between the frozen and final builds that applies to this case is the person check. Presence evidence is inert, because nobody is on either side. Offline, unchecked outlines reproduce the frozen misses, and checked outlines give 6/6.

### Gym reel: usable deadlift footage still missed — FAILED (2 of 2)
Inspection: `final42/gym-inspection/README.md`. Candidates from the final code with the app's own action peaks: `final42/gym-inspection/offline-final-build.txt`.

| Shot | Usable raw interval | App picked (final build) | Shown | Where the right moment was lost |
| --- | --- | --- | --- | --- |
| 1 (0–2.97 s): sets up over the bar | deadlift.webm 3.63–6.60 s: bent over the bar, then the pull, inside the clip's one 2.97 s-capable cut-safe stretch (1.57–7.40 s). The clip's own opening set-up (0–1.5 s) is split off by its label animation. | incline.webm 2.67–5.63 s (incline press) | best available 34% | **Ranked below incline press.** Retrieved (#3, 0.634 vs 0.674) and better on action (0.63 vs 0.58), but lost on framing/subject size (0.76 vs 0.94) and movement level (0.52 vs 0.78). Not offered among the app's three alternatives. |
| 3 (3.97–9.03 s): blur transition into the lift | deadlift.webm 1.57–6.63 s (the lift and lockout, same stretch) | squat.webm 5.40–10.47 s (beach kettlebell squat) | "best available, confidence low", fallback matcher | **Ranked below the beach squat (#10, 0.435 vs 0.476), then replaced by the fallback.** Look favours the deadlift (0.84 vs 0.70); framing (0.37 vs 0.60) and movement (0.28 vs 0.34) do not, and the reference's movement is dominated by the blur transition. Offline, the plan's own pick is squat 0.04–5.10 s, which starts one frame before the planner's range (scene start 36 ms → frame 2), so the fallback placed squat 5.40 s. Not lost in trimming: trimmed deadlift windows were scored. |

Displayed confidence is honest on all four shots (no close match). Selection is wrong on both shots where usable footage exists.

### Titles — PARTIAL
**HONORABLE — VERIFIED** (`final42b-titles/README.md`; matrix run `final42b/gym/`):
- Saved edit: a text layer "HONORABLE", Georgia, #9b0307, timeline 4.967–8.133 s.
- Decoded export against the reference: the red lettering is on screen at frames 149–243 vs 148–243 (one frame later). Its line spans rows 219–308 vs 218–309 (of 640) and columns 16–341 vs 14–346 (of 360).
- The subject passes in front through the "Subject flash · squat" layer, which has an editable person contour on the Foreground people track. The output's body covers less of the word (gaps up to 24 px vs 61 px), because it is different footage.
- Frames: `final42b/gym/honorable-matrix-compare.png`.
- A regression since 18 November; restored by `fragmentMerges` and the agreeing-pieces ink exception.

**Tiger — FAILED:** traced, then set aside by the size check against an unrelated uncertain reading of the Instagram handle ("6NOTKlN", 4.9× its size). Kept as is: that check fixed the 4.1 holdout's oversized brown title.

**MOUTH — FAILED, a reading defect, not timing:**
- The reference shows it for **8 frames, 139–146 (4.633–4.900 s)**. It alternates style with the colour pulses (blue on yellow, pink-white, tilted). Frame 138 still shows "ITS"; frame 147 is clear.
- The analysis split it into separate short runs ("MOUTL" 4.70–4.77 s, "MOOV" 4.83–4.90 s) and withheld each.
- The output shows no MOUTH on any frame (`final42b/gym/mouth-reference-f138-147.png`, `mouth-output-f138-147.png`). My earlier "two frames" was wrong.

### Person check — VERIFIED (scope: the references and clips in this matrix)
- **What it did:** rejected phantom reference outlines on cooking (84/84), the transition-heavy reference (25/25) and the gym end card (38 of 121). It kept every outline on gym clips (0 contradicted).
- **What it changed:** fixed cooking. Removed two false confident labels on the A/B assets. Kept the gym end card at "missing", through presence evidence.
- **What it cost:** caused the transition-heavy dissolve regression.

### Remaining limits
- Same-footage misses near titles and transitions; short clips and repeated actions (vertical holdout shot 2: a false same-footage claim on another repetition).
- Residual colour banding (4.1: steps −31%, tone shift about 11 codes; unchanged).
- The 26-minute reopen incident is still unexplained. The observed stress results are the prior 20/20 reopen cycles and 5/5 cycles with export.
- Not verified: pixel accuracy of copied framing, multilingual burned-in text, references longer than 90 s, behaviour outside Windows.
- New in this phase:
  - the still-shot rule's side effect (street);
  - plan picks lost to the fallback on one-frame or adjacency bookkeeping (gym shot 3, street shot 6);
  - dissolves lost when a pick starts at a clip's first frame;
  - the Tiger size veto;
  - MOUTH split by colour pulses;
  - a gym row still gets a beach as "best available".

## Universal Reference-to-Edit 4.1 — 20–21 November 2026 (not committed; awaiting approval)

**Checkpoint and build:**
- Starting checkpoint `1f06d94` is the only commit of this phase. Nothing since is committed or pushed.
- Final build: `bin/supp-edit.exe` sha256 `7e12e200…`, built 21 Nov 21:07 from the working tree (`test-results/final41/build-identity.txt`).
- Evidence: `test-results/final41/`.

**Product answer:** "edit the raw footage like the reference, one click".
- **VERIFIED for structure** (cuts, timing, transitions, titles, grade, framing, audio) on every case.
- **VERIFIED for which footage** when the reference was cut from the supplied raw footage: same-footage identity is new in 4.1.
- **PARTIAL** when the raw footage only resembles the reference: shots are matched by likeness and labelled close match or best available.

### Final Windows matrix (identity build, one click unless noted) — VERIFIED
Every run was Open → Recreate → Preview → Apply → Undo/Redo → alternative take → Save → Exit → Reopen → Playback → Inspector edit → Deliver. Every export was validated; 0 black frames.

| Run | Case | Picks (planted / right action) | Cut crossings | Preview (final / baseline) | Export |
| --- | --- | --- | --- | --- | --- |
| M1 | real gym reel (user's) | not graded; 0 shots claimed same footage (correct: raw is not its source); 0/4 close match (labelled best available) | — | 22 s / 40 s | ok |
| M2 | recreated audio | — | — | 15 s | ok; effects audible (see SFX) |
| M3 | reference audio, letterbox lyrics | — | — | 68 s | ok (reference silence reproduced) |
| M4 | mixed aspect, 22-shot vertical montage | — | — | 103 s | ok (failed on the prior build: harness false alarm, fixed) |
| M5 | travel | 6/6 / 6/6 | 0 | 22 s / 25 s | ok |
| M6 | cooking | 5/6 / **4/6** | 0 | 32 s / 29 s | ok |
| M7 | 26-minute footage | 9/9 / 9/9 | 0 | 138 s / 247 s | ok |
| M8 | multi-clip 7 min | 9/9 / 9/9 | 0 | 76 s / 49 s | ok |
| M9 (rerun) | multi-clip, Creative Remix | 9/9 / 8/9 (baseline 7/9) | 0 | — | ok |
| M10 (rerun) | 11 min, Creative Remix | 9/9 / 7/9 (baseline 8/9) | 0 | — | ok |

M9 and M10 were rerun once: the first attempts broke when Windows entered Modern Standby (21:48 and 22:27, 20 Nov; System log Kernel-Power), not from an app fault. Both attempts are kept in `final41/sleep-interrupted/`.
| M11 | 90 s, Smart Adaptation | 6/6 / 6/6 | 0 | 69 s | ok |
| M12 | previous landscape holdout + burned-in text | **5/6 / 5/6 (baseline 0/6)** | 0 | 94 s / 50 s | ok |
| M13 | transition-heavy (9 boundaries) | 9/9 kinds; dissolve, flash, whip rebuilt | — | 71 s | ok (reference has no audio) |
| M14 | workshop holdout | 5/6 / 4/6 | 0 | 28 s | ok |
| M15 | street holdout | 5/6 / 5/6 | 0 | 27 s | ok |
| S1 | **sealed holdout, single run** | **3/6 / 3/6** | 0 | 410 s (cold) | ok |

Baseline = the same matrix on the build before identity (`final41/baseline/`). Every graded case equals its baseline except M12 (0/6 → 5/6).

### Sealed holdout (S1) — first and only run, reported as is
- **The case:** square 1:1, desaturated high-contrast grade, ±10% speed, zoomed crops. Raw footage: a flower close-up, a two-person clip, squat, deadlift and a beach. Edit: a slide (whip-like) transition, a flash, a dissolve and a top title. Seed 1795182991; truth hashed before the run.
- **Result:** exact moment 3/6, right clip 5/6, 0 cut crossings, valid export.
- **Identity:** claimed 3 shots (0.99–1.00); all 3 correct.
- **Misses:**
  - Shot 1 (flower, right clip, other moment): labelled best available, 48%.
  - Shot 2 (two-person clip, starts after the slide, under the title): wrong clip, labelled "No close source match", 34%.
  - Shot 5 (squat, another repetition): labelled close match at 51%, so this one was over-confident.

### The eight 4.1 failure modes
1. **Burned-in source text — VERIFIED.** RawTextRegion via local OCR on candidate windows; equivalent / unrelated / absent / uncertain / unmeasured. Equivalent words suppress the duplicate title (M12: "BENCH PRESS" not re-added). Unrelated text costs ≤ 0.08; the shot reports "Source contains baked-in text."
2. **Stills and camera-only shots — VERIFIED offline, PARTIAL in app.** Sub-pixel camera path (CameraSignature) and an 8×8 edge layout. Offline workshop 4→5/6 and street 4→5/6 at the start of the phase; in the app both equal baseline. Same-footage identity now settles stills that are the same footage.
3. **Cooking / small objects — PARTIAL.** Offline 6/6; app 4/6 (unchanged; the app's person outlines differ from the offline inventory). Relational small-object motion: PLANNED.
4. **Effect levels — VERIFIED audible, PARTIAL level.**
   - Correction: the original "inaudible bass hit" was an error in my earlier measurement; the pre-4.1 export already had it at +2.3 dB over the music.
   - The 4.1 power-subtraction rule briefly made effects worse; the audibility rule keeps every effect ≥ min(target, music − 3 dB).
   - Measured from exports at 16 kHz with the music rebuilt from its source: bass hit +2.3 dB, impact −2.9 / +5.8 dB, riser −7.6 dB relative to the music where each plays; no clipping.
   - **FAILED:** a whoosh plays its loudest moment about 0.5 s before its event and is masked there (−11.3 dB); the riser stands about 20 dB under the reference's relation.
5. **Whip — VERIFIED.** Detected (fixture 9/9 kinds, no false whips on 15 references) and rebuilt as an editable motion transition with direction, span and strength (M13).
6. **Tone banding — PARTIAL.** Curve slope cap 4: visible steps −31% on the steepest shot (10,667 → 7,339 jumps), but tone shifts about 11 codes there. Half-float targets: no measurable change (the curve runs in one pass on 8-bit input).
7. **26-minute reopen incident — not reproduced; cause unknown.**
   - Instrumented lifecycle log (host and page stages, panics).
   - 20/20 Save → Close → Launch → Open → Verify cycles and 5/5 cycles with a Deliver export: every one exited 0 and restored every layer, curve and title exactly.
   - A separate hang on the prior build (window ignored close after an export; minidump kept) was not reproduced on the instrumented build.
8. **Previous holdout wrong picks — VERIFIED analysis, VERIFIED fix for same footage.**
   - Analysis: `previous-holdout-analysis.md`.
   - Calibration: confidence now rests on measured agreement (offline AUC 0.50 → 0.69; "high" right 35/39 vs 14/19).
   - Each shot is labelled close match or best available candidate.
   - With identity: in app 0/6 → 5/6.

### New in 4.1: same-footage identity — VERIFIED
- **Mechanism:** each reference shot's own frames are found in the raw clips regardless of regrade, crop/zoom or ±speed. A movement test separates the very frames from another repetition or a frozen copy. A detected cut is crossed only when continuity is proven.
- **Framing:** the matched region also gives the reference's exact framing.
- **Offline, all graded cases:** holdouts 0→5/6 and 1→4/6; every other case equal; 0 cut crossings.
- **In app:** M12 0→5/6, sealed 3/3 identity claims correct, the real gym reel 0 false claims.
- **Cost:** 17–80 s cold, cached afterwards.

### Known gaps (in order of user impact)
- Look-alike raw footage that is not the same frames still relies on likeness (sealed shots 1, 5; cooking 4/6).
- Whoosh placement; riser level.
- Banding is reduced but not removed.
- The reopen incident is unexplained.
- An alternative take can duplicate a moment another shot uses.

## Universal reference-to-edit engine — 19–20 November 2026 (not committed; awaiting approval)

Start of phase: `690a96e` (Long Footage 2.1). Evidence: `test-results/footage/matrix-ue/` (per-run records `rec-*.json`, audits, grammar examples), each run folder (screenshots, `explanations.json`, `validation.json`), `test-results/audio-ue/`, `test-results/transitions-ue/`, `test-results/footage/person-masks-ue/`.

**Product path — verified.** A reference and raw footage alone produce the edit: the defaults are Close Match, the reference's own words and its framing; titles are traced over the whole reference (≤ 90 s) and the reference soundtrack is used when no music is supplied; the preview says what it chose. Windows app, `--untouched` (only reference and raw chosen): travel 6/6, 7 m 10 s multi-clip 9/9, 26 minutes 9/9 (7 picks after minute 20), 0 cut crossings, valid exports.

### Windows matrix (11 runs, matrix build) — verified
All exit 0; all 11 MP4s validated (streams, duration, 0 ms drift, no black, no silence).

| Run | Case | Cache | Preview | In action | Correct | Cut crossings | Reuse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | multi 7 m 10 s | partly warm (titles, per-frame MISS) | 77 s | 9/9 | 9/9 | 0 | 0 |
| 2 | multi, cached | warm (titles HIT) | 7 s | 9/9 | 9/9 | 0 | 0 |
| 3 | multi, one clip changed | changed clip only MISS | 83 s | 9/9 | 9/9 | 0 | 0 |
| 4 | same reference, new 11 min clip | reference HIT, footage MISS | 121 s | 9/9 | 9/9 | 0 | 0 |
| 5 | new reference, same 11 min clip | reference MISS, footage HIT | 24 s | 9/9 | 9/9 | 0 | 0 |
| 6 | 90 s gym | partly warm | 20 s | 6/6 | 6/6 | 0 | 0 (1 shared repetition) |
| 7 | travel | partly warm | 26 s | 6/6 | 6/6 | 0 | 0 |
| 8 | cooking | partly warm | 17 s | 5/6 | **4/6** | 0 | 0 |
| 9 | 26 minutes, cached | warm | 23 s | 9/9 | **9/9** | **0** | 0 |
| 10 | workshop holdout (untouched) | cold | 113 s | 3/4 | **1/4** (4 of 6 shots) | 0 | 0 |
| 11 | street holdout (untouched) | cold | 109 s | 5/6 | 5/6 | 0 | 0 |

### Fixed after the matrix — verified (offline audits and the app)
- **Same-scene strict cuts** (flow reset + one-frame transform jump + layout jump): workshop 6/6 shots, 4/6 correct (was 1/4); coastal gains a verified cut at 3.8 s.
- **Flow collapse in moving shots:** S1 4/4, S4 18/21 (was 3/4, 15/21); 0 new false positives on any reference.
- **15 fps cut logic:** 26 min 17/18 planted boundaries (1330 s is a frozen picture starting to move — no picture change, missed at 30 fps too), 0 extra; 30 fps truth sets unchanged.
- **Dissolves:** detected (2/2 true, 0 false on 14 references; fades to black left as fades), split as shots and rebuilt (incoming shot fades in above, silent, pre-roll inside the cut-safe stretch).
- **Flash ramps:** a sliver between two flash boundaries joins the outgoing shot (new holdout 7 → 6 shots).
- **Title cache v2:** cached and uncached reconstructions agree (tone and plate tint cached); word correction re-traces titles only (W1 MISS, W2 HIT, footage HIT).
- **Honest cache report:** native analysis and colour report their own hits; text, motion, beat map, speech and audio timeline report their real state.
- **Creative Remix:** reference movement measured in every mode — in app 7/9 (was 3/9) and 8/9 (was 1/9).
- **Framing:** a frame the reference fills is filled in every mode; bars only over reference shots that show them; crops follow the footage's motion when no subject is detected.
- **Titles:** a trace that disagrees with the text reading (size beyond 0.5–2×, inverted ink) is set aside and reported; reel 55 and S1 titles unchanged.
- **Alternative takes:** each carries the tone curve fitted to its own footage.
- **Person masks:** skip vs exhaustive 12.7/18.4 s (90 s), 52/115 s (11 min), 123/269 s (26 min); outlines differ 0.16–0.65 % mean, worst 1.64 % (multi-C), 4.1 % at one frozen moment on 11 min (the model jitters on an unchanged frame).

### Holdouts
- **Workshop / street** (after engine work, never tuned): untouched 1/4 and 5/6; the workshop failure revealed the same-scene cut defect (fixed above; frozen in `holdout-workshop/UNTOUCHED-RESULT.md`).
- **Vertical beach holdout** (single run): 5/6 shots, right clip 4/5, right moment 1/5; visible defects (letterboxing, clipped brown title, missing word, grade overshoot) → framing, title agreement and per-take curves fixed and re-verified in the app; "HOUR" stays flagged uncertain.
- **Landscape gym + coast holdout (final, single one-click run, no correction):** 7 shots detected (a flash ramp sliver, now fixed), dissolve found at 8.07 s (truth 8.078), right clip 4/6 (two are other moments of the same repetitive exercise), 2 wrong clips (one flagged at 32 %), title "TRAIN HARD" yellow at the top with a stray extra layer, valid export with the reference soundtrack, 87 s cold.

### Partially working
- **Recreated audio structure:** S4 unchanged from 3.1 (cut relations 0.955, titles 0.667, 0 inversions, phrase error 0.002); reel 55: sections and mapping improved (build appears; 1 event without replacement, was 7), but generated effect levels are off (median 6 dB; a bass hit is masked).
- **Transitions:** cut, punch-in, dissolve, flash, blur found and classified; whip is classified as a cut; a dissolve is rebuilt ending at the cut, not centred on it.
- **ReferenceGrammar v2:** canonical view with measurement / confidence / interpretation / generated value; the planner still reads the StyleDNA.

### Known failures
- Burned-in text in the raw footage (gym exercise labels) is recreated again as an overlay over footage that already shows it.
- Stills across palettes (cooking "finished", workshop "product") and camera-only shots (street pan) pick the wrong hold.
- Cooking pour vs stir in the app: 4/6 (offline 5/6, the app's person outlines differ).
- Exact source moment on real footage: right clip but another moment in most holdout picks.
- Strong tone curves can band a flat sky; effect levels mix a peak and a loudness measure.
- Intermittent: once in two runs the reopened 26-minute project closed the app window (not reproduced).

### Planned
- Read text in the chosen raw ranges and skip overlays the footage already shows; still/composition identity across palettes; camera-move role; effect-level units; centred dissolve rebuild; whip classification. Shared decoding was measured (vision is ~83 % model inference) and not built.

## Long footage 2.1: global semantic planning, scarcity and generalization — 19 November 2026

Checkpoint before this phase: `a3eb3f0` (Long Footage 2.0 is `3f9fcee`). This phase was committed after review.

The planner now builds one plan for the whole reference against the whole inventory:
- **Scarcity:** source resources with scarcity, and repeat groups with a permission and an outcome.
- **Sharing:** action-phase windows that let shots share one repetition.
- **Search:** a future-aware beam that keeps diverse ways of spending contested footage.
- **Reuse and mismatch:** controlled reuse only within repeat groups (reported), and a semantic-mismatch penalty graded by how much worse a substitute agrees.
- **Decisions:** near-tie review, transition context, calibrated confidence and coverage classes, and "No close source match found" handled per mode.
- **Still shots:** a scene signature for static shots.
- **Long footage:** cut-versus-zoom boundaries, whole-clip dense analysis (no 5-minute limit), tone profiling and cache diagnostics.
- **Test harness:** it recovers from failed runs.

Windows app, Close Match, full flow (open, recreate, preview, apply, undo, redo, alternative take with undo and redo, save, exit, reopen, playback, Inspector edit, Deliver). Picks are graded from the preview's own explanation, before the deliberate take edit:

| Case | Shots measured | In planted action | Correct action | Cut crossings | Duration-infeasible | Intentional reuse | Accidental reuse | Coverage (exc/good/weak/missing) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: 90 s gym (before → after) | 6 | 6/6 → 6/6 | 4/6 → **6/6** | 0 | 0 | 0 | 0 | 3/2/1/0 |
| B: 7 m 10 s gym | 9 | 9/9 → 9/9 | 8/9 → **9/9** | 0 | 0 | 0 | 0 | 2/5/2/0 |
| C: travel (generated) | 6 | 5/6 → 6/6 | 4/6 → **6/6** | 0 | 0 | 0 | 0 | 1/5/0/0 |
| D: cooking (generated) | 4 → 6 | offline 2/4 → 5/6 | offline 1/4 → **4/6** | 0 | 0 | 0 | 0 | 2/1/2/1 |
| E: one 11-minute clip (new) | 9 | 9/9 | **9/9** | 0 | 0 | 0 | 0 | 3/4/2/0 |

- **A:** the planner finds that shots 1 and 6 repeat the deadlift the footage holds once ("shared one stretch"). It splits the repetition on movement-phase boundaries: shot 1 32.87–33.94 s, shot 6 31.07–32.69 s at ×0.85, with no frame played twice. Before, shots 5 and 6 swapped onto wrong lifts.
- **E:** seven of nine picks lie after minute 5 (330–642 s), which dense analysis never reached before.
- **Times:**
  - B first run 145 s (2.0: 155 s); B cached 22 s on a quiet machine (2.0: 19 s). The cached floor is reference title tracing (16 s, uncached by design) plus matching (3.5 s, +1.5 s for phase windows, the near-tie review and scene signatures).
  - E cold first run 343 s for 11 minutes (0.48 s per footage second). Person masks are the critical path (5 m 17 s), level with vision (5 m 11 s).
- **Tone profile (phase 15):** 90 s: 180 frames, seeking 11 s, drawing 4.2 s, pixel readback ≈ 0, measuring 0.1 s. 11 min: 1320 frames, seeking 1 m 41 s, drawing 33 s.
  - **Decision:** decode-by-seek dominates tone, but tone runs beside person masks, which take longer on every clip, so moving it native would not shorten any run yet. It was not moved. The one change: a single pixel readback per frame instead of two.
- **Shared frame analysis (phase 16):** not built. The same measurements show person masks (192², 10 Hz) and vision as the critical path; sharing tone's decode would not change wall time. Merging the visual and person-mask decodes is the measured next step.
- **Cut detection:**
  - Cooking reference: 5/5 punch-in cuts (was 1/5; now one-frame scale jumps).
  - Reel 55: no false splits.
  - Reel 54: gains 3.93 s, 6.17 s (both verified) and the end-card cut.
  - S1 corpus: gains its ground-truth cut at 2.5 s; coastal gains 7.57 s.
  - Raw clips: 30/30 planted cuts.
- **Bugs found on the way:**
  - **Vision frame cap:** the vision schema capped frames at 96, which broke any clip over about 4 minutes once 2.0 sampled every 2.5 s; now 2200.
  - **Retimed source range:** the panel showed a retimed shot's source range as in-point + timeline length (overlap and cut-crossing false alarms); now in-point + length × speed.
- **Tests:** 228 TS tests (8 new in `tests/long-footage-21.test.ts`), 42 native, `tsc` clean.

## Long footage 2.0: semantic action matching and cut-safe selection — 19 November 2026

Checkpoint before this phase: `6632f5e`. This phase was committed as `3f9fcee` after review.

Selection now asks "which stretch moves the same way, inside one shot, long enough to play this reference shot?":
- **Frame-accurate cuts:** a second-stage detector on the dense 33 ms frames finds cuts between similar material; segments keep a two-frame margin. In strict mode it also splits merged reference shots without splitting title swaps or silhouette flashes.
- **Movement and pose:** a temporal action signature (movement curve, where it moves, camera, rhythm, subject outline trajectory) plus a pose trajectory compared by time warping.
- **Retrieval:** two-stage retrieval with a rerank, and duration feasibility with a mild-retime fallback and an explicit "no source interval can faithfully fill" report.
- **Timing and roles:** shots have roles; the action phase follows the audio event, else the reference's own movement peak.
- **Global choice:** a wider global search, explained choices, distinct alternatives with what they lost on, and "Choose another take" after Apply as an undoable edit.
- **Speed and caching:** analysis is 6–7× faster (optimised media crate, concurrent stages, queued native slots), with a persistent per-file index and caches keyed by file identity.

Windows app, Close Match, full flow (open, recreate, preview, apply, undo, redo, alternative take with undo and redo, save, exit, reopen, playback, Inspector edit, Deliver). Each passed, with picks graded from the preview's own explanation (before the deliberate take edit):

| Case | Reference shots measured | In planted action | Correct action | Cut crossings | Duration-infeasible | Reused | First 10 s | Preview (first run) | Preview (cached) | Deliver |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A: 90 s gym clip | 6 (was 5) | 6/6 (was 4/5) | 4/6 (was 4/5) | 0 | 0 | 0 | 0 | 49 s (was 84 s) | – | 66 s |
| B: three gym clips, 7 m 10 s | 9 (was 8) | 9/9 (was 6/8) | 8/9 (was 3/8) | 0 (was 2) | 0 | 0 | 0 | 155 s (was 1070 s) | 19 s | 103 s (was 325 s) |
| C: travel, two generated clips, 3 m | 6 | 5/6 | 4/6 | 0 | 0 | 0 | 1 (planted at 8 s) | 104 s, fully cold | 18 s | 54 s |

- **Audio alignment:** the preview reports, per shot, that the audio event lands on the source's movement peak.
- **Offline (same code, captured inventories):** A 5/6 correct (the sixth flagged low-confidence), B 9/9, C 4/6, cooking 1/4.
- **Failures, honestly:**
  - **A:** the reference uses the deadlift twice and the footage holds one 3 s deadlift. Shot 1 takes most of it, the 1.9 s shot cannot fit in the rest, and the global search swapped shots 5 and 6 (two wrong but moving picks beat one right pick and an empty hold).
  - **B:** shot 3 (bench) took a row; four candidates scored within 0.008.
  - **C:** the vehicle shot took a slow push-in, and the sunset hold took a static street hold. Holds are decided by look, which is weak across palettes.
  - **Cooking:** strict reference mode finds 3 of 5 punch-in cuts, so two measured shots mix two actions.
- **Analysis profile** (`scripts/profile-footage-analysis.mjs`, 100 s clip, cold):
  - Before, per stage: person masks 117 s, vision 49 s, per-frame visual 37 s, aperture 9 s, scenes 7.5 s, colour 3 s; 230 s total (2.3 s per footage second).
  - After compiling `supp-media` optimised in dev builds: 74 s.
  - After running the stages concurrently: 35 s wall (0.35 s per footage second).
  - In the app, B's first run took 2 m 11 s for 7 m 10 s. Stage totals (summed across concurrent work): person masks 3 m 16 s, per-frame visual 1 m 42 s, webview tone sampling 1 m 23 s, aperture 36 s.
- **Cut detection:**
  - Raw: 30/30 planted cuts found (one extra two frames before a real cut).
  - References: gym 8/8 and 5/5, travel 5/5.
  - Real reels, strict mode: reel 55 adds nothing (its silhouette flashes and title swaps are rejected); reel 54 gains its missed cut at 6.17 s (verified visually); coastal gains 7.57 s.
- **Tests:** 220 TS tests (8 new in `tests/long-footage-2.test.ts`), 42 native tests, `tsc` clean.

## Long-footage selection and recreate-panel redesign — 19 November 2026

Raw clips are now searched end to end.
- **Index:** every clip is indexed from its cached analysis into action and hold candidates with quality flags, split where scene detection missed cuts.
- **Selection:** each reference shot is chosen globally by beam search, with reuse control and a motion gate.
- **Trimming:** the source's action peak is placed on the reference shot's strongest audio event.
- **Preview:** per-criterion match, up to three alternatives with *Choose another take* (re-preview, no re-analysis), and a coverage line.
- **Vision sampling:** dense for long scenes.
- **Recreate panel:** sources and style cards, progress steps, one action bar, readable evidence.
- **Stability:** file dialogs run on one persistent COM thread, after a Deliver crash in the unloaded shell dialog was traced.

| Case (Windows app, Close Match, full flow) | Source moments in planted action | Right exercise | From a clip's first 10 s | Reuse |
| --- | --- | --- | --- | --- |
| 90 s single clip, 8 s 6-shot reference (`test-results/footage/long90/`) | 4/5 | 4/5 | 0 | 0 |
| Three clips, 7 m 10 s, 15 s 9-shot reference (`test-results/footage/multi/`) | 6/8 | 3/8 | 0 | 0 |

The missed shot in the 90 s case is a 3.3 s reference shot (two shots merged by reference detection) that no planted action is long enough to fill in Close Match.

Open:
- **Exercise identity:** look discrimination between similar exercises is still weak (multi-clip: right action, often the wrong exercise). The pose term needs the person model's masks.
- **Missed cuts:** two windows crossed cuts the spike rule missed.
- **Analysis time:** first analysis of 7 minutes of footage takes about 18 minutes in the app.
- **Tests:** synthetic acceptance tests pass: 90 s planted moments, a three-clip pool, missed cuts, blur rejection.

## Audio fidelity 3.1: structural recreation — 18 November 2026

*Recreate audio structure* now aligns the two soundtracks' structures instead of snapping each event to the nearest replacement event:
- **Sections and beats:** labelled sections and an octave-matched beat mapping.
- **Landmarks:** drops, sweep peaks and silence edges anchor the map.
- **Events:** an order-preserving event mapping with per-term reasons.
- **Relationships:** each visual event is re-placed by its measured relationship (anchor + offset); events without a counterpart are reported.
- **Detectors:** tempo octave, downbeats and drops were fixed against ground truth.
- **Generated effects:** placed at the reference's level relative to its music, with fades.
- **Timeline:** no empty audio tracks; audio-event markers can be dragged with snapping.
- **Limits:** focused intervals up to ten minutes; titles read consistently over many frames are kept.

Design: `AI_ARCHITECTURE.md` (top section). Evidence: `docs/REFERENCE_STYLE_CAPABILITIES.md`, `test-results/audio31/`.

| Case 2 (reference 55, squat withheld, recreate on `music.wav`) | 3.0 | 3.1 |
| --- | --- | --- |
| Cuts keeping their relation in the export | 2/2 (1/2 strictly "on") | 2/2 |
| Titles keeping their relation | 26% (5/19) | 50% (9/18) |
| Pulses keeping their relation | 0/2 | 2/2 |
| Linked audio events mapped | nearest-event within 150 ms | 19/24, in order, 0 inversions |
| Generated-effect level vs reference relation | uncontrolled (+15 dB over music) | median error 2.6 dB |

Other cases on the 3.1 build, all through the full Windows flow:
- **Case 1:** reference audio; export byte-identical to 3.0; lag and drift 0 ms.
- **Case 3:** S1 over the full 12 s; NEW HEIGHTS and "fall" present; audio F 1.00; lag 0 ms.
- **Case 4:** dialogue + music; cuts exact; lag 0 ms.
- **Case 5:** beat montage recreated; 21/22 cuts and 6/9 titles keep their relation; 22/22 events mapped.

Tests: 208 TypeScript, 42 native.

Open:
- the dialogue fixture's beats and downbeats under a ducked bed;
- "cut in a pause" needs speech-activity detection, which needs a transcript today;
- caption fragments are not merged (case 4);
- a false large "rise" title in case 3;
- recreated edits have no drop when the replacement has none;
- two-letter words still need both OCR passes.

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
