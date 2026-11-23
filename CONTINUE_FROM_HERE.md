## Evaluation set (step 1 of the any-footage plan) — 22 November 2026

**What exists** (`docs/EVALUATION_SET.md` is the guide):
- **Tools in `scripts/eval/`:**
  - the labelling page (`npm run eval:label`, http://127.0.0.1:5199);
  - the runner (`npm run eval:run`; `--into=RUN_DIR` adds pairs to a run of the same build);
  - the score card (`npm run eval:score -- RUN_DIR`), which has a by-role table;
  - command-line labelling aids: `sheet`, `cuts`, `find-exact`, `compare-frames`, `set-labels`;
  - `fetch-open-pairs.mjs` with `open-pairs.json`.
- **Data:** `work/eval/` (git-ignored).
  - **13 locked pairs:** 11 open, labelled by the developer from frames, so never blind; and 2 seen (the A/B gym-and-beach footage and the personal gym reel).
  - **Kinds:** film (Big Buck Bunny), aviation (X-59 ×2), rocket launches (×3), sea recovery, parks travel (×2), cooking, dogs.
  - **Sources:** NASA's media library, the National Park Service API (demo key, about 30 requests an hour), Blender's server.
  - **Blocked sources:**
    - Wikimedia Commons answers 429 to this client after the first burst, so the US-military pairs in `open-pairs.json` (cooking-chefs, dog park, beach, summer party, ship, Sintel) are not downloaded.
    - DVIDS requires an account to download.
- **Found by the set:** the vision result schema allowed only 32 analysed scenes, while the native analyser samples up to 160. Any clip with more scenes (a film) failed the whole edit. Fixed in `dab2ba4`; build `56c50ce0`.
- **Known limit, not yet tested:** the analysis schema's `ms` caps a raw clip at 30 minutes.

**Rules:**
- Develop against open and seen pairs only.
- Blind pairs run only with `--split=blind --release`, scored in aggregate.
- Never look at blind pairs' footage, labels or per-shot results while tuning.
- No pair labelled by the developer can be blind; blind pairs must come from someone else.

**Next:**
1. Score the baseline: `work/eval/runs/*-56c50ce0`.
2. Step 2: describe each shot by exact action, role and energy, and match at the most specific level the footage supports. Start from the by-role table.

## Resume after 4.4 body pose — 22 November 2026

**State:**
- Commits `aa07a62` (4.1–4.3) and `a237673` (4.4). Nothing pushed; `.claude/` stays uncommitted.
- **Final build:** `bin/supp-edit.exe` sha256 `2af2ae1d…` (`test-results/final44/build-identity.txt`).
- **Pose models:** `work/ai-models/mediapipe-pose-2023mar/` (git-ignored; the app's installer fetches the same pinned files).
- **Evidence:**

  | Folder | What it holds |
  | --- | --- |
  | `test-results/final44/` | final matrix (`summary.md`, `binaries.txt`), plus `README.md`: what was tried, kept and reverted |
  | `test-results/final44/offline/` | offline comparison against `aa07a62` |
  | `test-results/final44-smoke/` | app runs before the matrix (gym text penalty, titles) |

**Reproduce:**
- **Pose per clip:** `node test-results/footage/pose-inventory.mjs INVENTORY` writes `i-pose.json` into the inventory (uses `target/debug/examples/pose.exe`; build it with `cargo build --offline -p supp-media --example pose`).
- **Matrix:** `bash test-results/footage/run-final44.sh`, then `node test-results/final44/summarize.mjs` and `node test-results/final44/check-binaries.mjs test-results/final44`.
- **Offline comparison:** `LOGS="$PWD/test-results/final43c" OUT="$PWD/test-results/final44/offline" bash test-results/footage/offline-compare-43.sh BASE_DIR` (absolute paths: the script runs each side from its own folder). `--no-pose` on `check-footage-selection.mjs` measures without body pose.

**Next, in order of impact:**
1. **A wider real evaluation set:** 20–30 reel-plus-footage pairs, labelled before any run. Every remaining gain is now one or two shots on a handful of cases.
2. **Scene detection that ignores burned-in label animations** (bench clip), so one recording is not split into stretches too short for its own action.
3. **Same-footage identity across repetitions and holds:** vertical holdout shot 2, workshop shot 4 and street shot 3 claim 93–100% on the wrong moment.
4. **Gym shot 1:** the footage holds one deadlift stretch, which goes to the longer lift shot; shot 1 is flagged "no close source match". Better only with more footage or a split of that stretch.
5. **Still shots:** find a signal that separates a right still pick from a wrong one, or cap their confidence.
6. **Titles:** MOUTH across style changes; Tiger's script hand.

## Resume after the 4.3 selection fixes — 22 November 2026

**State:**
- Checkpoint `1f06d94` plus uncommitted 4.1–4.3 work. Nothing committed or pushed; `.claude/` stays uncommitted.
- **Final build:** `bin/supp-edit.exe` sha256 `218c7a9b…` (`test-results/final43c/build-identity.txt`).
- **Evidence:**

  | Folder | What it holds |
  | --- | --- |
  | `test-results/final43c/` | final matrix, fresh titles |
  | `test-results/final43b/` | cached-title matrix, plus `README.md`: what was tried, kept and reverted |
  | `test-results/final43/` | interim build |
  | `test-results/final43-debug/` | unplaced-pick diagnosis |
  | `test-results/final43/offline/` | offline base-vs-new comparison |

**Reproduce:**
- **Matrix:** `bash test-results/footage/run-final43c.sh`, then `node test-results/final43c/summarize.mjs` and `node test-results/final43c/check-binaries.mjs test-results/final43c`.
- **Offline comparison against a copy of an earlier source:** `bash test-results/footage/offline-compare-43.sh BASE_DIR`. `BASE_DIR` holds `packages`, `scripts` and junctions to `node_modules` and `target`. `ONLY="gym street"` limits the cases.
- **A/B footage offline:** `node test-results/final43/grade-offline-labels.mjs LABELS SHOTS SELECTION.json`.
- **Unplaced plan picks:** search the run's `app-console.log` for "planned pick not placed".

**Next, in order of impact:**
1. **Recognise the action from body pose, not outlines.**
   - The gym deadlift is retrieved and then outranked, by incline press on shot 1 and by beach squat on shot 3.
   - Framing, movement level, look and the vision model's labels cannot separate the two across recordings.
   - Joint positions and angles from a pose model (standing hip hinge vs lying on a bench) are framing- and background-invariant.
   - Measure on the gym reel, the A/B assets and the holdouts offline, then in the app.
2. **Calibrate confidence on shots with nobody in them.**
   - Movement geometry alone gave three close-match labels on wrong picks: vertical holdout shot 3, formerly sealed shot 1, A/B shot 5.
   - Two moments of one clip move alike; confidence needs a term that separates them, or a ceiling without one.
3. **Keep a dissolve's lead-in:** prefer in-points with footage before them (transition-heavy shot 5).
4. **Narrow the still-shot rule:** street still 4/6 vs 4.1's 5/6 (shot 2).
5. **Titles:** MOUTH across colour pulses; the Tiger size veto.
6. **A meaningful "best available"** (a gym row gets a beach).
7. **A wider real evaluation set:** 20–30 reel-plus-footage pairs, labelled before any run.

## Resume after Universal Reference-to-Edit 4.2 — 21 November 2026

**State:**
- Checkpoint `1f06d94` plus uncommitted 4.1 and 4.2 work. Nothing committed or pushed; `.claude/` stays uncommitted. Waiting for review.
- **Final build:** `bin/supp-edit.exe` sha256 `e3ebf2f9af4450fcf4e18e37642f60fdc1b6b161ecdf1c7bebe322737060279f` (`test-results/final42b/build-identity.txt`).
- **Other binaries:**
  - frozen 4.2 (blind A/B): `test-results/final42/frozen-bin/supp-edit.exe` (`18fac9fb…`);
  - preserved 4.1: `test-results/preserved-4.1/bin/supp-edit.exe` (`7e12e200…`).
- **Evidence:**

  | Folder | What it holds |
  | --- | --- |
  | `test-results/final42b/` | final matrix; `summary.md`, `binaries.txt`, `street-attribution.md` |
  | `test-results/final42b-titles/` | HONORABLE fix |
  | `test-results/final42/` | frozen regressions; `cooking-diagnosis/`, `gym-inspection/` |
  | `test-results/footage/different42/` | blind A/B: sealed labels, `ab-41`, `ab-42`, `warm-42` |
  | `test-results/audio42/` | effect timing and level, takes on the earlier build |
  | `test-results/person42/` | offline person check |

**Reproduce:**
1. **Final matrix:** `bash test-results/footage/run-final42b.sh`. It writes `test-results/final42b/`.
   - Stop it by killing the bash, node and `supp-edit.exe` processes. A stopped background shell can leave the script running and holding `bin/supp-edit.exe` open.
2. **Summary:** grade each truth case with `node scripts/measure-footage-selection.mjs RUN/final.supp TRUTH RUN.grade.json --log=RUN.log`, then:
   - `node test-results/final42b/summarize.mjs` (per case: build, first edit, labels, baselines, playback, editability, Save/Reopen, export);
   - `node test-results/final42b/check-binaries.mjs DIR…` (which executable each run launched).
3. **Different footage:** `node scripts/grade-different-footage.mjs LABELS REFERENCE_SHOTS RUN.log OUT.json`. Labels must be recorded before any build runs, and sealed with a hash.
4. **Blind A/B against another binary:** `SUPP_EXE=path/to/supp-edit.exe node scripts/run-native-verification.mjs …`.
5. **Offline selection:** `node scripts/check-footage-selection.mjs INVENTORY TRUTH [--identity] [--peaks=RUN.log] [--inspect=1,3] [--ungated]`.
   - `--peaks` reuses the app's action peaks.
   - `--ungated` uses person outlines unchecked, as builds before the person check did.
   - `TOP=40 FINE=1 FULL=1` lists more candidates with every term.
6. **Effects:** `node scripts/measure-effect-tracks.mjs RENDER.mp4 SAVED.supp OUT.json` (isolated tracks rebuilt from the saved project) and `scripts/measure-effect-placement.mjs` (controlled cases).
7. **Takes:** `node scripts/verify-native-takes.mjs COPY.supp OUT`.
8. **The 4.1 source, for attribution:** `git archive 1f06d94`, overlay `test-results/preserved-4.1/tracked-files` and `untracked`, junction `node_modules`, then run the harness there (as in `street-attribution.md`).

**Next (measured, in order of user impact).** The two gym misses point at selection, not retrieval: the right deadlift windows are scored, and they lose.
1. **Score what the shot does above how it is framed.**
   - The deadlift lost shot 1 on subject size (framing 0.76 vs 0.94) and movement level (0.52 vs 0.78), despite better action agreement. It lost shot 3 mainly on framing (0.37 vs 0.60).
   - The editor already crops and zooms. Subject size should be a correction the edit applies (when the source has resolution to spare), not a selection penalty.
   - Measure the reference shot's movement outside its transition span (shot 3 opens with a blur).
   - Re-run the gym reel, the A/B assets and the holdouts offline, then in the app.
2. **Make the planner keep its own picks.**
   - A plan pick that starts within a frame or two of a pool range, or right after a consumed interval, must not fall to the local matcher.
   - This cost gym shot 3 (squat at 40 ms vs a range starting at frame 2) and street shot 6.
3. **Narrow the still-shot rule** (`STILL_LEVEL`/`bothStill`). Reverting it alone restores street's 4.1 picks. Cooking shot 4 needs a narrower form, e.g. only when nothing moves in the reference shot at all.
4. **Keep a dissolve's lead-in.** When the reference shot enters by dissolve, prefer in-points with footage before them (transition-heavy shot 5).
5. **Titles:**
   - Read lettering across colour-pulse style changes as one word (MOUTH, 8 frames).
   - Do not let an unrelated uncertain reading veto a trace on size (Tiger).
6. **A meaningful "best available":** a gym row should get a gym clip, not a beach (A/B shot 4).
7. **Carried over:** same-footage misses near titles and transitions, and on repeated actions (vertical holdout shot 2: a false identity claim at 93%); banding; the 26-minute reopen incident.

## Resume after Universal Reference-to-Edit 4.1 — 20 November 2026

**State:**
- Start of phase: checkpoint `1f06d94` (the only commit authorised by the 4.1 brief). Nothing since is committed; nothing is pushed; `.claude/` stays uncommitted.
- `bin/supp-edit.exe` is the final 4.1 build (`test-results/final41/build-identity.txt`), including same-footage identity.
- Evidence: `test-results/final41/`:
  - `matrix.out` and the per-run folders: the final matrix on the identity build;
  - `baseline/`: the same matrix on the build before identity;
  - `offline/` and `previous-holdout-analysis.md`;
  - `reopen-stress.md`;
  - `stuck-after-export/` (minidump);
  - `sealed-truth.sha256`.

**Reproduce:**
1. **Final matrix:** `bash test-results/footage/run-final41.sh`. It ends with the sealed holdout; that holdout is now spent.
2. **Matrix summary:** `node scripts/summarize-matrix.mjs test-results/final41`.
3. **Offline selection with identity:** `node scripts/check-footage-selection.mjs INVENTORY TRUTH "Close Match" --identity`. Native matches are cached as `identity-N.json` in the inventory.
4. **Identity on any pair:** `target/debug/examples/identity.exe REFERENCE SOURCE PROBE_MS,... [START-END ...]`. Build with `cargo build --offline -p supp-media --examples`; set `SUPP_FFMPEG` and `SUPP_FFPROBE`.
5. **Save/reopen stress:** `node scripts/stress-reopen.mjs COPY.supp OUT [CYCLES] [--export]`. The lifecycle log is `%APPDATA%/studio.supp.edit/lifecycle.log`.
6. **Effect levels:** `node scripts/measure-sfx-levels.mjs RENDER.mp4 SAVED.supp`. It works at 16 kHz mono (the analysis domain) and rebuilds the music track to separate an effect from a beat of the music.
7. **Banding:** `node scripts/measure-banding.mjs A.mp4 B.mp4 FRAMES`.
8. **Export validity against the reference:** `node scripts/validate-export.mjs RENDER SECONDS --reference=REF`. Silences or black frames that the reference has at the same time count as intended.
9. **New holdouts:** `node scripts/make-unseen-holdout.mjs OUT SEED vertical|landscape|square`. Seal the truth (hash it), never read it before the one graded run.

**Next (measured gaps, in order of user impact):**
1. **Exact moment in look-alike footage that is not the same frames:** identity proves "same footage". When the reference is another repetition of the raw's action, selection still relies on likeness.
2. **Riser level:** about 20 dB under the reference's relation to its music; impact and bass hit are audible (`recreated-audio/sfx-levels.json`).
3. **Banding:** steps −31% on the steepest grade, but the tone then differs by about 11 codes. A real fix needs grading in float before quantisation, or dithering.
4. **26-minute reopen incident:** not reproduced in 25 instrumented cycles. Read `lifecycle.log` if it recurs.
5. **Alternative takes:** an alternative take may duplicate a moment another shot already uses; it is not flagged.

## Resume after the universal reference-to-edit engine — 20 November 2026

**State:**
- Start of phase: `690a96e` (Long Footage 2.1). Nothing from this phase is committed (waiting for approval); `.claude/` stays uncommitted; nothing pushed.
- `bin/supp-edit.exe` is built from the working tree.

**Reproduce:**
1. **One click:** `node scripts/run-native-verification.mjs COPY.supp OUT 0 END_MS --untouched`. Only the reference and the raw videos are chosen.
2. **Other driver options:** `--mode="Creative Remix"`, `--audio=reference|recreate`, `--exclude=id`, or a reviewed-words file as the 5th argument.
3. **Batches:**
   - the matrix: `test-results/footage/run-matrix-ue.sh`;
   - the follow-ups: `run-followups-ue.sh`, `run-final-ue.sh`, `run-oneclick-ue.sh`;
   - the regression: `run-regression-ue2.sh`;
   - the last checks: `run-final2-ue.sh`.

   Templates are clean `*.template.supp` files. Never use `.bak` files: the app writes those on save.
4. **Grading:**
   - footage selection: `scripts/measure-footage-selection.mjs`;
   - export validity: `scripts/validate-export.mjs RENDER SECONDS`; Remix and recreated audio compose their own length, so validate against the timeline;
   - audio structure: `scripts/measure-av-fidelity.mjs`.
5. **Cuts and transitions:**
   - `scripts/reference-cut-audit.mjs --out=FILE` (true and false positives per cut);
   - `scripts/make-transition-generalization.mjs`, then `scripts/evaluate-transitions.mjs DIR`.
6. **Holdouts:** `scripts/make-holdout-case.mjs workshop|street`, and `scripts/make-unseen-holdout.mjs OUT SEED vertical|landscape`. Run each once, read its truth only after.
7. **Grammar:** `scripts/print-reference-grammar.mjs INVENTORY OUT.json`.
8. **Person masks:** `test-results/footage/verify-person-masks.sh`. It uses `SUPP_PERSON_MASK_EXHAUSTIVE=1`, which is for verification only.

**Next (measured failures, in order of user impact):**
1. **Burned-in text:** text already in the raw footage is recreated again as an overlay. Read the text in each chosen raw range and skip overlays the footage already shows.
2. **Exact moment on real footage:** picks often land in the right clip at another moment. Two clips were wrong in the landscape holdout.
3. **Stills and camera-only shots:** still pictures across palettes and camera-only shots are matched on the wrong evidence.
4. **Effect levels in recreated audio:** they mix a peak with a loudness measure.
5. **Whip, dissolve and banding:** the whip is classified as a cut; a dissolve is rebuilt ending at the cut, not centred on it; strong curves band flat skies.

## Resume after Long Footage 2.1 — 19 November 2026

**State:**
- Long Footage 2.1 is committed on top of `a3eb3f0` (Long Footage 2.0 is `3f9fcee`).
- `bin/supp-edit.exe` is built from the working tree.

**Reproduce:**
1. Cases:
   - `make-long-footage-case.mjs` (A), `make-multi-clip-case.mjs` (B), `make-motion-case.mjs travel|cooking` (C, D), `make-long-form-case.mjs` (E, one 11-minute clip).
   - A cold copy of E: remux with `-c copy`, probe it, and give the asset a unique id.
2. Offline, with the app's own audio-anchored peaks from a run log: `node scripts/check-footage-selection.mjs DIR/inventory DIR/truth.json "Close Match" --peaks=RUN.log [--inspect=N] [--json=OUT]`. Use `TOP=… FULL=1 FINE=1` for candidate detail.
3. Signatures: `node scripts/compare-shot-signatures.mjs INVENTORY REF_START REF_END CLIP START END`.
4. Windows: `node scripts/run-native-verification.mjs COPY.supp OUT 0 END_MS`. It is the harness around `verify-native-focused.mjs`; on failure it collects a screenshot and the console, closes the app, and keeps only this run's recovery snapshot. The matrix scripts are `test-results/footage/run-matrix-21*.sh`.
5. Grade: `node scripts/measure-footage-selection.mjs COPY.supp DIR/truth.json OUT.json --log=RUN.log`.
6. Inventories must use dense vision (recapture `i-vision.json` with `analyze … vision`). Sparse vision made offline look neutral and hid what the app does.

**Next:**
- **Local motion direction** (per-region flow) to separate a falling stream from a circling spoon, cooking's remaining confusion.
- **Shared decode** of the per-frame visual pass and person masks (the measured critical path); tone stays in the webview until then.
- **Cache reference title tracing** (16 s of every cached reconstruction).
- **A clip over 20 minutes** to exercise the 15 fps dense rate.
- **Native colour sampling** should report cache hits (reuse is inferred from time today).

## Resume after Long Footage 2.0 — 19 November 2026

**State:**
- Long Footage 2.0 is committed as `3f9fcee` (on top of `6632f5e`).
- `bin/supp-edit.exe` is built from the working tree.

**Reproduce:**
1. Generate the cases:
   - Gym: `node scripts/make-long-footage-case.mjs test-results/footage/long90`, `node scripts/make-multi-clip-case.mjs test-results/footage/multi`.
   - Non-gym: `node scripts/make-motion-case.mjs cooking|travel test-results/footage/<kind>`.
2. Inventories: `node scripts/capture-reference-analysis.mjs DIR/inventory REF RAW… work/gym/music.wav`; person masks with `target/debug/examples/person_mask.exe work/ai-models CLIP > DIR/inventory/i-person.json`.
3. Offline:
   - Selection: `node scripts/check-footage-selection.mjs DIR/inventory DIR/truth.json [MODE] [--inspect=3]`.
   - Cuts: `node scripts/check-frame-cuts.mjs VISUAL.json "t1,t2"`, and for references `node scripts/compare-frame-cuts.mjs DIR --strict`.
   - Feature discrimination: `node scripts/action-feature-confusion.mjs DIR/inventory DIR/truth.json`.
4. Profile: `node scripts/profile-footage-analysis.mjs CLIP [OUT] [--parallel]`.
5. Windows:
   - Run `node scripts/verify-native-focused.mjs COPY.supp OUT 0 END_MS` (A: 8000, B: 15000, C: 9300).
   - Then `node scripts/measure-footage-selection.mjs COPY.supp DIR/truth.json OUT.json --log=RUN.log`, which grades the preview's own picks.
   - If a run fails, the app stays open and leaves `%APPDATA%\studio.supp.edit\recovery-0.json`. Close that instance and move the snapshot aside before rerunning.

**Next:**
- **Capacity packing:** let two shots share one cut-safe stretch (with the mild retime) when the reference repeats an action the footage holds once.
- **Strict reference cuts for punch-ins** without flow reset; native tone sampling (the webview stage is now a notable cost).
- **Dense stages beyond 300 s per clip** (visual, tone and colour stop at 5 minutes; quality and vision cover the whole clip).
- **Vision per refined segment:** sample embeddings per refined segment rather than per first-stage scene.
- **Hold shots:** match holds on something better than look across palettes.

## Resume after long-footage selection — 19 November 2026

**State:**
- Last commit: `4c2c7e5`.
- Not committed: the file-dialog thread (`src-tauri/src/dialogs.rs`, `windows-sys 0.59` from the local cache), dense vision sampling, the footage-index fixes (cut splitting, motion gate, dense look), the multi-clip generator, the measurement scripts and these notes.
- `bin/supp-edit.exe` is built from the working tree.

**Reproduce:**
1. Generate the cases: `node scripts/make-long-footage-case.mjs test-results/footage/long90`, then `node scripts/make-multi-clip-case.mjs test-results/footage/multi`.
2. Build each inventory: `node scripts/capture-reference-analysis.mjs DIR/inventory REF RAW… work/gym/music.wav`.
3. Check selection offline (coarse reference shots): `node scripts/check-footage-selection.mjs DIR/inventory DIR/truth.json`.
4. Windows: `node scripts/verify-native-focused.mjs COPY.supp OUT 0 8000` (multi-clip: `0 15000`), then `node scripts/measure-footage-selection.mjs COPY.supp DIR/truth.json`.

**Next:**
- **Exercise identity:** make look discriminate similar exercises, e.g. person-model pose for raw clips by default, or embeddings on the subject crop.
- **Missed cuts:** a cut detector on the dense per-frame visual analysis instead of 500 ms samples.
- **Analysis time:** for long pools.
- **Smart Adaptation:** let it extend a shot to the available action when a reference shot is longer than any action.

## Resume after audio fidelity 3.1 — 18 November 2026

Last commit: `9da430a` (Audio 3.0 checkpoint). The structural-recreation work (3.1, top of `CURRENT_STATE.md`) is not committed. `bin/supp-edit.exe` is built from it; `bin/supp-edit-audio30.exe` is the 3.0 build.

Reproduce:
- **Windows cases:** as below. Case 3 now runs 0–12000; case 4 is `test-results/audio31/s3-dialogue-music-inventory/SOURCE.supp` 0 12000 `--audio=reference`; case 5 is `test-results/audio31/s4-beat-montage-inventory/SOURCE.supp` 0 10000 `--audio=recreate`.
- **Structural fidelity:** `node scripts/measure-av-fidelity.mjs --reference=REF --render=OUT/render.mp4 --start=0 --end=MS --mode=recreate --project=PROJECT.supp`.
- **Corpus (4 cases):** `node scripts/make-reference-corpus.mjs DIR`.

Next:
- speech-activity detection, so "cut in a pause" and dialogue sections are measurable without a transcript;
- merging caption fragments of the same text;
- the false band title (case 3 "rise");
- recreate-mode drops when the replacement has none (generate a riser into an impact?).

## Resume after audio fidelity 3.0 — 18 November 2026

Both milestones are committed: `029a30a` holds the hidden-title / tone-curve milestone (next section) and the audio milestone at the top of `CURRENT_STATE.md`; the "Audio 3.0 multimodal reference reconstruction checkpoint" commit records this state.

`bin/supp-edit.exe` is built from this tree; `bin/supp-edit-before-audio.exe` is the previous build. Read "Audio fidelity and the shared audio/visual event clock" in `AI_ARCHITECTURE.md` first.

Reproduce:
1. Build: `npm run build`, then `cargo build -p supp-desktop --features tauri/custom-protocol`, then copy `target/debug/supp-edit.exe` to `bin/supp-edit.exe` with the app closed.
2. Windows cases. Copy the `SOURCE.supp` first; the driver saves the copy in place.
   - `node scripts/verify-native-focused.mjs COPY.supp OUT 0 7967 test-results/focus55/p2/review.txt --audio=reference` (reference soundtrack).
   - The same with `--audio=recreate --exclude=probe-1` (supplied music restructured, squat withheld).
   - `node scripts/verify-native-focused.mjs S1COPY.supp OUT 4000 12000 --audio=reference` with `test-results/audio3/s1-inventory/SOURCE.supp` (generated letterbox/lyric reference; focused intervals are at most 8 s).
   - The driver refuses to start while a crash-recovery snapshot exists, and reattaches if its debugging page handle closes during Deliver.
3. Measurements: `node scripts/measure-av-fidelity.mjs --reference=REF --render=OUT/render.mp4 --start=0 --end=7967 --mode=reference|recreate --out=OUT/av-metrics.json`.
4. Side by side with switchable audio: `node scripts/compare-av.mjs REF 0 7967 OUT/render.mp4 OUT/compare-av.mp4`.
5. Ground-truth corpus: `node scripts/make-reference-corpus.mjs DIR`, then `measure-av-fidelity.mjs --reference=X --render=X --truth=DIR/CASE/truth.json` for detector accuracy.
6. Inspect a soundtrack: `node scripts/inspect-audio-events.mjs FILE [all]`.
7. Offline plan check: `node scripts/verify-focused-reference.mjs test-results/fidelity2/55 test-results/fidelity-breakthrough/55/final/dna.json NEW_DIR 0 7967 test-results/focus55/p2/review.txt --audio=reference`.

Next, by audible/visible effect: let recreate mode move an event to any replacement beat or onset when no same-family event is within reach (case 2: titles 29% on events against the reference's 73%); titles over dense backgrounds (S1 NEW HEIGHTS); the beat octave on short or vocal windows; drop detection (wrong on both generated cases); downbeats when bar accents are weak; recreated SFX loudness relative to the music; remove the empty default "Music" track when another audio mode carries the sound; drag (not only keys) for audio-event markers; transitions measured as events (the whip blur at 5 s is still a cut).

## Resume after the hidden-title and tone-curve milestone — 18 November 2026

Last commit: `5e1cfa2`. The working tree holds the verified milestone described at the top of `CURRENT_STATE.md`; `bin/supp-edit.exe` is built from it (previous builds: `bin/supp-edit-milestone1.exe`, `bin/supp-edit-before-focus.exe`).

Reproduce:
1. `node scripts/verify-native-focused.mjs COPY.supp OUT 0 7967 test-results/focus55/p2/review.txt` (copy `test-results/fidelity2/55/SOURCE.supp` first; remove assets from the copy to test another raw pool). Plays, edits a tone-curve level, and exports through Deliver.
2. `node scripts/repeat-native-export.mjs PROJECT.supp OUT 4` repeats Deliver in one session.
3. `bash test-results/focus55/p2/generalize.sh` (`ONLY="smart vertical"` to select) runs the harness matrix.
4. `node scripts/measure-title-fidelity.mjs REFERENCE MOVIE DNA OUT` and `node scripts/compare-title-interval.mjs …` for measurements and sheets.

Next, by visible effect: reconstruct titles in Smart Adaptation and Creative Remix from the same measurements (HONORABLE is cut there); extend the focused band to several lines for stacked layouts like reference 54; a sharper person contour for subject flashes; per-letter title motion; the directional-blur transition; a portrait framing option that crops wide shots around subject and equipment. Pose matching is a weak tie-breaker; do not raise its weight without better contours (a stronger weight picked an outdoor clip).

## Resume after the focused Windows verification — 17 November 2026

The working tree holds the focused title reconstruction, verified through `bin/supp-edit.exe` (rebuilt from this tree). Nothing is committed yet; `ce71503` is still the last commit. Read the "Focused title reconstruction" section of `docs/REFERENCE_FIDELITY_BREAKTHROUGH.md` before changing fidelity code.

Reproduce:

1. `npm run build`, then `cargo build -p supp-desktop --features tauri/custom-protocol`, then copy `target/debug/supp-edit.exe` to `bin/supp-edit.exe` with the app closed.
2. Copy `test-results/fidelity2/55/SOURCE.supp` to a new file and run `node scripts/verify-native-focused.mjs COPY.supp OUT_DIR 0 3967`. It opens and saves the copy in place. Add a review file as the fifth argument to supply words such as `4.72 MOUTH`.
3. `node scripts/compare-title-interval.mjs REFERENCE PREVIOUS OUT_DIR/render.mp4 OUT_DIR/comparison.jpg 5 20 40 …` and `node scripts/measure-title-fidelity.mjs REFERENCE OUT_DIR/render.mp4 DNA.json OUT_DIR/fidelity`.
4. Faster iteration without the app: `node scripts/verify-focused-reference.mjs test-results/fidelity2/55 test-results/fidelity-breakthrough/55/final/dna.json NEW_DIR 0 3967`, then `node scripts/render-reference-sequence.mjs NEW_DIR/Focused.supp NEW_DIR/render`. The harness uses installed Chrome because Playwright's pinned browser is absent.

Next fidelity work, in order of visible effect: choose raw shots whose subject pose suits a measured subject flash and sharpen its contour; read flat colored titles such as the red HONORABLE and place them behind the athlete; measure title entrance motion and rotation; decide with the owner whether a geometric display face and a brush script may be bundled; rerun reference 54, vertical framing and the other two modes with the new grade and framing. Do not raise brightness by lifting the upper quartile: it was measured and reverted.

## Windows export check completed 17 November 2026

The reopened second gym project exported Creative Remix through Windows Deliver. All 384 H.264 frames and the AAC audio decoded. The complete frame scan found zero black frames, including cut 100. The permitted-source graph excludes the reference. The largest sampled preview-to-export mean channel error was 1.88/255. The separate CPU rerender passed too. Both results and the original failing export are retained. The intermittent trigger remains unproven. See `test-results/fidelity-breakthrough/55/Windows-Creative-Remix`.

The active fidelity target is the second reference's opening typography and athlete interaction. Earlier whole-Reel exports remain comparison evidence.

# Resume Reference Fidelity Breakthrough from the current tree

The governing request is attachment `ddeb5f00-5028-4122-9f3c-5d2f9524c9aa/Pasted text.txt`. Preserve `93f97de`, all current changes and the accepted typography/audio baseline. Desktop testing and a reproducible commit are authorized.

Latest projects: `test-results/fidelity-breakthrough/{54,55}/final/Three-modes.supp`. These use `reference-text-v8`, measured installed-font ink geometry and conservative reference-depth inference. Actual Windows Close Match videos are `final/render.mp4`. Aligned diagnostics live in `before`, `intermediate`, and `after`; `comparison.png` presents reference/previous/current decoded frames. Read `docs/REFERENCE_FIDELITY_BREAKTHROUGH.md` before interpreting fidelity claims.

Both Close Match exports passed complete decoding, source isolation, black/side-bar scans, title-pixel verification and zero-lag music checks. Reference 54 passed full native exit/reopen with identical compositions/assets, then a Windows Smart Adaptation export. Reference 55 Smart Adaptation passed the native encoder harness. First 55 Creative Remix harness failed at black frame 100; direct cold seeks did not reproduce it. The original failed artifact is retained. `55/Creative-Remix-recheck` is being rerendered after adding an actual decoded-frame presentation fence to the production seek path. Cache and speed-remap browser regressions passed. Finish this investigation without calling a non-reproduction proof of root cause.

Next: finish remaining mode export checks, rebuild the native executable after any additional source change, document exact UI-versus-harness provenance, and commit. Preserve the unrelated `native/crates/supp-project/src/typography.rs` whitespace diff. Next fidelity work is missing-word/timing evidence, subject-and-equipment-aware framing, and measured green–magenta/tone reconstruction. Difficult automatic occlusion, ornate text and arbitrary Instagram-style recreation remain unaccepted.

## Historical Visual Fidelity 2.0 notes

Preserve `7be9d83` and all current changes. The latest user brief is attachment `2ed66c5d-db87-4fe8-99e8-eb6e3ac5b9e5/Pasted text.txt`. Continue automated Windows testing; the user explicitly authorized it.

Active artifacts: `test-results/fidelity2/54` and `55`. `54/project.supp` was saved through the native app after actual Preview/Apply/Undo/Redo, then full process close. It has 16 editable titles and five animated person-mask copies, but predates the final framing correction. Reopen and verify editability, then regenerate using the current planner before final export. `54/aperture-v2/Three-modes.supp` exercises the latest framing through the production planning/history path with captured native evidence.

Do not claim Visual Fidelity 2.0 complete. Ornate text in reference 55 is still withheld as uncertain, and PP-HumanSeg misses limbs or includes equipment in bench/deadlift shots. Accurate ornate lettering, reliable segmentation, six final native gym exports and independent non-gym acceptance remain open. Preserve the pre-existing formatting-only change in `native/crates/supp-project/src/typography.rs`.

# Continue from the advanced reference checkpoint

The three final coastal Windows exports and their comparison reports are in test-results/reference-coastal/final. Use the saved project in reviewed/Three-modes.supp. The old reviewed movies predate the HLG color correction. The accepted audio and typography commits remain 87541c2 and 6706330.

For the two supplied gym references, use the existing independently measured five-take inventories in test-results/reference-user54/multi-raw and reference-user55/multi-raw. The current editable projects are in reserved/Three-modes.supp and validated/Three-modes.supp respectively. Their Close Match sequences cover 506 and 392 frames. The latter has two editable timed duotones, driven by the raw clip's luminance. Ignore the superseded single-take and pulse/ experiments for acceptance.

The coastal and negative-duotone checkpoint is `8a64f95`. In Reference Editor, expand Review title wording to correct or omit generated titles, then choose Update title preview. The next automatic recognition work should target the misreads and missed words in the comparison sheets, captions spanning cuts, creator end cards, textured lettering and text behind an athlete. Test with additional unrelated natural references for motion transitions, music synchronization and speed curves. Refer to docs/REFERENCE_STYLE_CAPABILITIES.md for the limits of each real footage test.

# Continue Reference-to-Edit after Windows acceptance

Use the current repository and working tree. Windows native reference import, raw/music import, four-shot generation, preview, Apply, Undo/Redo, manual brightness revision to 0.91, full exit/reopen and MP4 export have passed. All three modes have separate actual desktop exports. CURRENT_STATE.md records artifacts, measurements and limits. The accepted audio and typography checkpoints remain 87541c2 and 6706330.

Read the current Reference-to-Edit section before running further acceptance. Final desktop artifacts live under test-results/reference-gym/desktop and desktop-modes. The earlier verified directory contains superseded title sizing. The final directory contains independently rendered three-mode comparisons and the browser-generated projects.

Next implement and validate the remaining reference requirements. Prioritize transcript-grounded automatic wording with source-time remapping, unsupported-transition reporting from measured evidence, stronger shot-specific color/camera treatment, and a comparison UI showing actual timing/event distances. Continue real travel, talking-head/lifestyle and five-input acceptance. Current adaptation acceptance uses user-supplied replacement phrases. Current transition acceptance uses hard cuts. Keep those limits explicit.

The three-mode project is test-results/reference-gym/desktop-modes/Three-modes.supp. The independently imported native project with the manual revision is test-results/reference-gym/desktop/Desktop-recreation.supp. Select the generated composition after reopening because the default main sequence is empty. scripts/verify-native-reference.mjs verifies native persistence, the 0.91 edit, raw-only rendering, title animation, cut boundaries, speed keys and decoded audio. scripts/compare-reference-edit.mjs checks corresponding reference/output frames, black frames and soundtrack lag. scripts/verify-render.mjs compares exported frames with retained compositor PNGs.

When validating new genres, use separate authorized raw footage. Keep source words editable and source media out of generated sequences. Reference speed curves and fonts remain estimates. Caption adaptation needs transcript/action evidence or supplied wording. Continue through real native exports and commit each validated milestone.

## Prior handoff

Native kinetic typography acceptance passed on the corrected 1080×1920, 12-second Reel. The 360-frame H.264/AAC file decodes with mono RMS 0.19034. Four text layers remain editable. Native Preview, Apply, Undo/Redo, manual 68.5 px size and 0.845 entrance scale, full process exit and reopen were exercised. After the first export exposed face overlap, the planner weighted upper-body overlap and refit the existing titles through ordinary commands, preserving their other edits. A freshly launched native app reopened and resaved the corrected project exactly and exported it. Twelve decoded samples average 3.13/255 error relative to the text compositor and 119.58/255 against the same frames with text removed. The row title clears the athlete’s face. See test-results/typography-reviewed/render.mp4, NATIVE.supp, contact.png, native-verification.json and scripts/verify-native-typography.mjs.

All twenty treatments passed native decoded-frame verification in the 600-frame showcase. CPU/GPU parity covered 120 samples, maximum per-channel mean absolute error 0.363/255. Recorded-speech karaoke was rendered separately with transcript word timestamps. The gym source clips in the combined Reel contain no speech. Audio checkpoint 87541c2 remains accepted.

Next: the Reference-to-Edit attachment 4d8c8375-f3c7-47ba-a500-b793ef50341f governs the flagship workflow. Use separate reference and raw inputs, extract measured editing characteristics, and apply them to the raw sources through normal project commands. Validate each genre through native export.

## Earlier checkpoints
# Continue the exact current supp.edit tree

Latest instructions: the current audio-export follow-up, building on 479e4d6f-78b3-43e9-a892-42114ec81205/Pasted text.txt. Continue this exact repository; no reset or repeated validated work. Portrait d893688, profiles c93e206 and speed a3c7857 remain accepted. Audio is ready for its tested checkpoint. Immediately continue kinetic typography, then Reference Style Analyzer and Automatic Sound Design and the remaining Universal Reel Engine roadmap. Full aesthetic/universal acceptance remains open.

## Exact active work — audio acceptance, then kinetic typography

Gain is now an ordinary media-only keyframe channel, available in Inspector/Graph Editor and preview/native export. Maximum automated clip duration is five minutes. Native scalar interpolation matches frontend linear/hold/ease/Bezier modes. The existing PCM resampler evaluates gain in timeline time, cancels the static clip base before the final native volume stage, and retains ancestor gain. Preview has a shared hard peak guard; native export uses FFmpeg's lookahead limiter with automatic makeup disabled. These limiter algorithms differ; no pitch preservation is claimed.

`rough-cut/audio.ts` protects speech from ramps, uses source-bound Whisper word/segment ranges intersected with measured non-silence, normalizes measured active RMS conservatively, generates ordinary music duck/fade keys and source fades, and suppresses pitched room sound under music. Real captions support Minimal/Bold/Creator/Fitness and single-word Karaoke when real word timestamps exist. Whisper non-verbal bracket annotations (real squat output `[SIGH]`) now produce structured `speechDetected:false`; only speech parser cache keys changed, not vision/music caches.

Audio revision commands exist for voice clarity, lower music during speech, remove ducking, music +3 dB and original gym sounds. `sequence.remember` stores bounded generated-treatment baselines in AI metadata; `sequence.treatment` patches ordinary channels through History. Revisions preserve manual added/moved/deleted/edited gain keys across successive changes, without adopting them as automatic keys. Both schemas have native persistence.

Validation so far: 145 TypeScript tests pass across the suite plus an isolated 100,000-clip performance-test rerun (parallel test timed out under simultaneous native builds); actual browser audio acceptance passed (57.6s), including preview playback, Apply, Undo/Redo, audio revisions, manual gain **−17.25 dB at frame 90**, save/page-close/reopen, and 300 real compositor frames. `scripts/verify-audio-mix.mjs` passed three real native H.264/AAC exports (source-only, music-only, combined), native save/read, all 300 frames decode, 10s duration, correct gain windows (worst 0.815 dB with AAC/limiter), per-channel peak <1. Artifacts `test-results/audio-mix`. The test uses raw gym video combined with the existing recorded JFK sample; inference is real, not fabricated transcript data. This validates audio, not the full aesthetic prompt.

Speech-aware audio acceptance PASSED on 3 November 2026. Full native Preview → Apply → Undo → Redo → Save → complete process exit → relaunch/reopen → resave → Deliver export. All compositions/transcripts survived exactly. Five captions, one transcript, eleven music gain keys and manual frame-90 −17.25 dB key remain. Ducking was removed and restored around three measured speech regions. Actual UI export test-results/audio-mix/render.mp4 (copied to NATIVE_AUDIO.mp4) has 300 frames/10s, H.264/AAC, zero black frames, channel peak 0.96236. Its decoded stereo audio is byte-identical to the independently verified timeline mix. Early and late source-only speech have zero lag and >0.99999 correlation. No tolerance relaxation or hardcoded offset. See scripts/verify-native-audio.mjs and test-results/audio-mix/native-verification.json. No pitch-preserving time stretching is claimed.

Native project/media/export tests: 23+11+4; workspace all-target Clippy, frontend typecheck/build and speed-remap export regression pass. Installed binary includes the AAC fix and schema v10. Current native app is on completed audio Deliver.

NEXT: implement real editable kinetic typography, the required profiles/treatments and social-safe bounds, actual transcript/music timing, ordinary History commands and preview. Native exported animation and full close/reopen must pass before typography is accepted. Do not repeat audio unless its production path changes.

## Accepted checkpoint

Native rough cut, existing-sequence revisions and editable portrait reframing are accepted. See `CURRENT_STATE.md` and `docs/REFRAME_ACCEPTANCE.md`. Native app performed Preview → Apply → Undo → Redo → ordinary Inspector Position X edit → Save → complete app exit → relaunch/reopen → exact composition equality → native Deliver export. Final file: `test-results/reframe/NATIVE_MANUAL.mp4`, H.264/AAC, 1080×1920, 600 frames/20 seconds, all frames decoded, audio present, zero entirely black frames. First key is exactly 249.088; only that key differs from the generated graph. Export pixels match the manual override. Artifacts and scripts are retained under ignored `test-results/reframe` and `work`.

## Immediate implementation

Implemented the first aesthetic subsystem: seven structured profiles change real evidence ranking, 1–2s hook selection, pacing, source-bound exact-duration scheduling when footage permits, measured music-event placement, initial bounded luma matching/contrast/saturation and music gain. Preview reports actual decisions and remaining limitations. Strong onsets use measured samples; energy/section/possible-drop estimates require continuous power samples and drops also require a real onset. Real captured-fixture tests cover the exact 25s duration, editable effects, source bounds, manual order, Undo/Redo/reopen and style differences. This is NOT the full aesthetic acceptance.

Time remapping is now implemented: schema v10 (reads 1–10), positive 0.25–4× linear/smooth speed curves with analytic source-time integration, fractional source offsets, safe split/trim/ripple/roll/slip/overwrite and source guards, ordinary Inspector key editing, preview decoding/cache timing and native PCM audio resampling. Audio pitch follows speed; slow motion repeats frames, no optical flow. Captions/silence ranges and new reframe sampling use mapped source times. Profile plans choose at most three measured high-motion ramps and preview individual enable/disable with curves/reasons/duration. Musical cut positions and source endpoints are preserved. Manual source replacements with an existing ramp explicitly reject pending a reviewed rebuild.

Validation: full TS suite 133 passed, 21 native project + 3 export tests passed. `tests/e2e/speed-remap.spec.ts` manually changes the speed key to 0.65, saves/closes/reopens, then renders 60 frames; five references exactly match source-time sampling. `scripts/verify-speed-remap.mjs` encodes through the actual native exporter: H.264/AAC, 320×180, 2 seconds/60 decoded frames, zero black frames, reference errors 3.35–3.89/255. Export audio changes from ~520 Hz at the fast opening to ~290 Hz at the manually slowed highlight, verifying the .65 override reaches native output. Artifacts: `test-results/speed-remap`. This is focused speed-engine acceptance, NOT the final aesthetic Reel acceptance.

Active uncommitted subsystem: `rough-cut/framing.ts` calls the accepted detector/camera planner on newly created aesthetic shots at remapped source times, then adds at most two separate ordinary null parent punch-in controllers (`commands/punch-in.ts`). Base x/y/scale keys are untouched. Reselect is now an async background job; preview cannot Apply while rebuilding. New controller + integration tests pass (synthetic detector geometry explicitly identified as such). Profile framing treatments and individual punch/effect review toggles are implemented. Full aesthetic integrated acceptance and remaining revision ownership handling are pending.

Finishing effects implemented in both CPU and GPU paths: deterministic monochrome grain with amount/size/softness, vignette, bounded neighbor-clamped sharpening, signed temperature, endpoint-preserving tonal contrast. Ordinary ordered effects/Inspector/native persistence accept them. `finish-effects.test.ts` and `tests/e2e/finish-effects.spec.ts` pass: all five effects match CPU/GPU, alpha remains intact, manual grain parameters save. Artifacts `test-results/aesthetic-finish`. Current profiles use tonal contrast, measured sharpness restraint and subtle grain/vignette.

Just added RGB shot matching: native `analysis/color.rs`, `sample_color` host endpoint and `rough-cut/matching.ts`. Five RGB samples per selected range measure luma, contrast, saturation and low-chroma neutral temperature proxy. Content/mtime/range-keyed native cache is separate from vision caches; no expensive vision invalidation. Frontend pairs measured matching with restrained creative looks. Full service now matches color then frames the newly created sequence. TypeScript passed; native media/project tests passed (11+22). Actual RGB measurements from all six real fixture videos were captured with `cargo run -p supp-media --example color_samples -- tests/fixtures/gym-analysis.json test-results/aesthetic-finish/color-evidence.json` (set media env), copied to `tests/fixtures/gym-color.json`. Matching tests use clearly identified synthetic differences to test correction bounds plus genuine captured statistics. Latest changes still need final combined validation.

Remaining aesthetic requirements: conservative useful transitions and current-sequence revisions (less edited, stronger intro, fewer ramps, other opening, warmer, remove grain) respecting manual edits. Then real exact 25s prompt, manual speed/controller/color edits, full native close/reopen and 1080×1920 H.264/AAC export. Source replacement must refresh source-dependent framing or explicitly request review; never treat old camera data as new detections.

Exact acceptance prompt: “Create a 25-second dark aesthetic Instagram gym Reel from my best footage. Start with the strongest shot, keep me centered in 9:16, sync the important cuts to the music, use tasteful speed ramps on the strongest movements, add subtle punch-in zooms, keep transitions minimal, preserve natural skin tone, use deep contrast and slightly muted colors, add subtle grain, and balance the music under any speech.”

Then test existing-sequence revisions: less edited/fewer ramps/harder intro/another opening/more physique/warmer/less grain/remove captions/louder music/20 seconds. Use real gym media and verify native export, manual edit, Undo/Redo and save/reopen. Sound assets must be user-provided/licensed. Reference-video style extraction must report measurable general characteristics and disclose unsupported estimates.

## Runtime / verification

Local models are already explicitly installed in `work/ai-models`; set process `SUPP_AI_MODELS` there. `npm run launch` uses `bin/supp-edit-compositor.exe`. Current binary includes accepted audio, AAC alignment, finishing effects and schema v10. Build `npm run build` then `cargo build -p supp-desktop --features tauri/custom-protocol`; copy target/debug/supp-edit.exe only after closing the running compositor binary. Native window is on completed audio Deliver.

Windows UI uses the computer-use skill and @oai/sky. Never press Escape. Alt+F4 is allowed to close our saved acceptance app. UIA can lag the screenshot by a refresh; reacquire window/index after interruptions. User input can minimize/occlude the window; activate and refresh. File-dialog filename UIA focus may misleadingly report the search box; inspect caret/selection. No terminal commands through UI.

Tests: 122 TS pass across full run plus isolated timing-test rerun, 16 focused reframe tests, browser reframe/manual/reopen pass, native media tests and workspace Clippy pass. Full-HD CPU render: `work/render-portrait.mjs` disables Vite HMR and resumes existing frames. Manual references: `scripts/reframe-references.mjs`; native export audit: `scripts/verify-native-portrait.mjs`. These scripts use existing captured real files. Native revision evidence: `test-results/revisions/native-verification.json`.

Known limits: ramps apply to media layers (not composition instances), max 5 minutes per ramped clip, no pitch preservation/optical flow; no physical-GPU/4K/cross-platform certification; 10-layer1080 SwiftShader timeout; natural two-person crossings not certified. Installed native binary includes schema v10 and accepted audio. Distribution START_HERE/BUILD_MANIFEST/source ZIP stale: update truthfully later, never run old work/checkpoint-manifest.mjs unchanged.

## Keep the reel's own shots (2026-11-23, code committed, not yet built or tried in the app)
- `controls.reelShots: "keep"` ("Shots your footage lacks" in the AI Studio panel; `--reel-shots=keep` in
  `scripts/verify-native-focused.mjs`). `reelShotsToKeep` in `planner.ts` picks the shots; later passes
  (titles, transitions between two kept shots, colour pulses, bars, card plates, subject layers) skip them.
  Tests are in `tests/keep-reel.test.ts`.
- Still to do: wait for the release run (`work/eval/release-run.log`, exe `d1493419`) to finish and compare
  it with the baseline `work/eval/runs/20261122-1643-56c50ce0`. Only then rebuild and copy to `bin/`
  (the run uses `bin/supp-edit.exe`). Try keep mode on the 2026-11-23 reel and raw, and write up the results.
