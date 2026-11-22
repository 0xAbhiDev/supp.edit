# The evaluation set: real reels and footage, labelled before any run

Every change to footage selection is graded on this set. A pair is a reference reel plus raw footage. A person labels the pair before the app ever runs on it, saying which moments of the footage could fill each reference shot. Each build then gets one score card.

## What to collect

- **About 30 pairs**, across kinds: gym, cooking, travel, vlog, talking, product, dance, sports, events, pets, real estate.
- **Two kinds of footage:**
  - **Own footage:** the raw clips the reel was cut from.
  - **Different footage:** other recordings for the same reel, for example your own gym clips for someone else's gym reel.
  - Aim for about half of each.
- **Include hard cases:** footage that lacks some shots, long footage, several clips, vertical and landscape.
- **Privacy:** the files stay on this computer in `work/eval/`, which git ignores.

## Add a pair

1. Make a folder in `work/eval/pairs/`, for example `gym-01`.
2. Put the reel in it, named `reference.mp4`, or `.mov` or `.webm`.
3. Put the raw clips in the same folder, under any names.
4. Start the labelling page:

   ```powershell
   npm run eval:label
   ```

   Then open http://127.0.0.1:5199.
5. Press **Refresh**, then choose the category and whether the footage is the reel's own.
6. Press **Prepare**. This step:
   - hashes the files;
   - finds the reel's cuts as a draft;
   - makes playable copies of clips the browser cannot play;
   - writes the project the app will open.

   Each new pair has a one-in-three chance of joining the **blind** set.

## Label a pair (about 10 minutes)

1. **Shots.** Check the strip under the reference: each block should be one shot. Use **Split at playhead**, **Merge with next** and **Move start to playhead** to fix it. Dissolves and flashes are where the draft is most often wrong.
2. **Each shot.** Fill in:
   - **What it shows:** a short sentence.
   - **Role:**
     - opener: sets the scene;
     - action: the subject doing the main thing;
     - detail: a close-up;
     - face: a reaction or talking;
     - reveal: the result or payoff;
     - passing: b-roll between moments;
     - card: a title or end card;
     - other.
   - **Energy:** still, steady, building or peak.
   - **Action (optional):** a word such as deadlift or pouring.
3. **Where the footage can fill it.** Play the clips, mark in (`I`) and out (`O`), choose how well the range fits, and add it (`A`):
   - **Exact moment:** the very moment the reel used. Own footage only.
   - **Same action:** the same action or subject, at another moment or in another recording.
   - **Fits the role:** something else that would do this shot's job.

   Add every range that would be acceptable: several are fine. If nothing in the footage fits, add none and mark the shot done.
4. **Lock labels** when every shot is done. Always lock before the app runs on the pair.
   - Unlocking later is possible.
   - If the app has already run on the pair, unlocking marks it "relabelled after a run", and it no longer counts as unseen.

More keys:
- `,` and `.` step one frame;
- `[` and `]` move to the previous or next shot;
- `P` plays the selected shot;
- `S` splits at the playhead.

## Run and score

```powershell
npm run eval:run
```

This runs the Windows app (`bin/supp-edit.exe`) once on every locked open and seen pair, the way a user would: choose the reference and the raw clips, press Recreate. It stops at the first automatic edit and closes the app. The score card goes to `work/eval/runs/<time>-<build>/scorecard.md`.

Options:
- `--only=gym-01,cooking-02` runs only those pairs.
- `--mode="Smart Adaptation"` uses another recreation mode.
- `--exe=PATH` runs another build.

To grade a finished run again:

```powershell
npm run eval:score -- work/eval/runs/RUN
```

### What the score card measures

A pick counts as inside a labelled range when at least 80% of it falls inside a range on the same clip.

| Column | Meaning |
| --- | --- |
| Right action | Shots whose action the footage has: the pick is an exact-moment or same-action range. |
| Right moment | Shots with an exact moment, own footage only: the pick is that moment. |
| Right clip | The pick is from a clip that holds the action. |
| Fits the role | Shots with any range: the pick is in one, at any level. |
| Missing shots flagged | Shots the footage lacks: the app did not call its pick a close match. |
| Wrong among "close match" | Picks labelled close match that are not the right action. This should be near 0. |
| Not placed | Labelled shots that the app's edit did not cover. |

The confidence table shows how often a pick at each confidence shown was right. A trustworthy label is right about as often as it says.

## Rules that keep the score honest

- **Lock first.** Labels are locked before the app runs on a pair. The runner skips unlocked pairs, and pairs whose labels changed after locking.
- **Development uses open and seen pairs only.** Blind pairs run only at release checks (`npm run eval:run -- --split=blind --release`), and their results are reported as one aggregate line. While developing, nobody looks at blind pairs' footage, labels or per-shot results.
- **Production code never reads this set.** It doesn't use labels, file names, pair names or categories. The app sees only the reference and the raw clips, as a user's would be.
- **Seen pairs** were used for tuning before the set existed. They are regression checks, never reported as unseen:
  - the A/B gym-and-beach footage, labels imported;
  - the personal gym reel, prepared and waiting for labels.

## Openly licensed pairs

`node scripts/eval/fetch-open-pairs.mjs` downloads and prepares the pairs listed in `scripts/eval/open-pairs.json`. They come from three places:
- Wikimedia Commons, at its own pace;
- NASA's media library;
- Blender's download server.

Licences are public domain, CC0 or CC BY. Each pair's `sources.json` records the title, licence, credit and link of every file. Files get neutral names (`reference`, `raw-1` …), so no name hints at an answer.

The developer labels these pairs, not an independent person, so they are always **open**, never blind.

There are two kinds:
- **Own footage:** an official edit and the raw footage it was cut from. For example, a news piece and its b-roll, or a film trailer and the film.
- **Different footage:** the same edits with other recordings.

### Aids for labelling from the command line

| Command | What it does |
| --- | --- |
| `node scripts/eval/sheet.mjs VIDEO OUT --fps=2 [--from= --to=]` | contact sheets with each frame's time |
| `node scripts/eval/find-exact.mjs PAIR_DIR --shots=draft --json=OUT` | where each reference shot came from in the raw (small-frame correlation, independent of the app); a lead to check, never a label by itself |
| `node scripts/eval/compare-frames.mjs PAIR_DIR MATCHES.json OUT` | reference frame, match and runner-up side by side, to check by eye |
| `node scripts/eval/set-labels.mjs PAIR_DIR LABELS.json --lock --by="…"` | writes and locks labels with the page's checks |

## Files

| Path | What it is |
| --- | --- |
| `scripts/eval/lib.mjs` | formats, labels, grading |
| `scripts/eval/prepare.mjs` | hashing, probing, draft cuts, proxies, project template |
| `scripts/eval/label-server.mjs`, `labeller.html` | the labelling page (this computer only) |
| `scripts/eval/run.mjs`, `score.mjs` | running the app and the score card |
| `scripts/eval/import-seen.mjs` | brings in the seen pairs |
| `tests/eval-set.test.ts` | grading rules |
