# Reference-to-Edit

## Long footage 2.1: global semantic planning, scarcity and generalization

Selection now plans the whole reference sequence against the whole source inventory (`packages/ai/reference/sequence-planner.ts`), instead of finding a good candidate shot by shot.

- **Source resources (scarcity):** cut-safe stretches are grouped by the reference shots they can play well (options within 0.04 of a shot's best). Each `SourceResource` carries its usable intervals, total duration, compatible shots and scarcity, the demanded time over the available time.
- **Strong stretches:** a stretch plays a shot well when it is within 0.1 of the shot's best AND agrees on what the shot does (movement geometry and pose ≥ 0.6). A second, slightly weaker repetition of the same action counts; a different action that merely scores close does not.
- **Repeat groups:** reference shots whose clear best match is the same stretch, with moderate movement or pose agreement (≥ 0.6; pose ≥ 0.5), perform the same action. Each group gets:
  - **Permission:** `distinct repetitions` (enough strong stretches), `share one stretch` (one stretch long enough for all of them), `reuse` (neither, and the action agrees well), or `substitute`.
  - **Outcome:** what the plan actually did: separate repetitions, shared one stretch, reused one interval, or substituted another action. The preview reports it.
- **Action-phase inventory:** `actionPhases` finds rest points and movement peaks in a stretch from its smoothed movement curve.
  - **Phase windows:** these start or end on a rest point or a stretch edge, at full length or at the shortest length a mild retime can fill, and must hold a movement peak (`phaseWindows`).
  - **Sharing:** one long repetition can serve several shots without overlapping frames, each window holding a real movement phase rather than a mathematical split.
- **Future-aware global search:** a beam (width 40) whose priority adds, for every later shot, the best option still admissible given the footage already spent. The planner looks ahead before consuming scarce footage. The objective adds:
  - **Penalties:** semantic mismatch (−0.08 for a stretch that does not play the shot well when one that does exists); controlled reuse (−0.06); stutter (−0.25); retime (in the score).
  - **Small terms:** progression (±0.01–0.015), diversity (+0.01), and transition context (±0.03).
  - **Overlap:** permitted only inside a repeat group with `reuse` permission, or where the reference repeats the very same shot (same look and movement ≥ 0.9). It is recorded as `{ permitted, reason: "reference-repeat …", confidence }` and shown in the preview. Accidental reuse is impossible.
- **Near ties:** when a shot's two best stretches score within 0.02, `deepTemporal` reviews each tied stretch over its whole length (sliding windows, not only the peak-placed trim). It uses:
  - best-aligned pose trajectory;
  - body-orientation curve (principal axis of the outline);
  - outline deformation;
  - foreground/background movement split;
  - movement regions.

  The verdict moves each stretch's options by 0.15 × (review − mean).
- **Context:** `transitionFit` compares how framing scale and movement level change between adjacent picks with how they change between the same reference shots.
- **Calibration:** confidence comes from the lead over the best alternative from another stretch (full at 0.05), semantic agreement, quality and duration fit, never from the absolute score.
  - **Coverage:** each shot is classed `excellent` / `good` / `weak` / `missing`, and the project reports the counts ("Reference coverage: …").
  - **No good match:** a missing shot shows "No close source match found." Close Match keeps the reference timing and flags it; Smart Adaptation switches to the moment that best plays the shot's visual role (scene, framing, composition, look); Creative Remix reinterprets it with footage that moves like it.
- **Static shots** (`scene-signature.ts`): the scene signature captures:
  - the 4×4 brightness layout normalised to zero mean and unit spread (composition independent of palette and exposure, and of polarity at a 15% discount);
  - its row profile and strongest horizontal edge (horizon);
  - how concentrated movement is, camera movement and movement level;
  - subject size and detected object classes;
  - detail relative to the video's typical detail;
  - a visual role inferred from those measurements (environment reveal, object movement, sky/horizon hold, object detail, portrait close-up, establishing wide, static reaction, subject action).

  The scene term's weight grows as the reference shot's movement weakens (0.3 at full movement, 1.2 when still).
  - **Stillness:** below a mean change of 0.0003 a picture is still: two stills move alike, a still against a moving shot does not, and the codec-noise "movement map" of a still is ignored.
  - **Smooth content:** low detail is not penalised as blur when the reference shot is itself far smoother than its own video (relative detail ≤ 0.6), e.g. a sky or a plain wall.
  - **Small movement:** a small object moving in one place (≥ 45% of movement in three cells) is an action even at a low movement level, not a hold.
- **Reference shot measurements** keep a two-frame guard from their cuts (`shotSpan`): the frame at a cut used to dominate a short shot's movement map.
- **Cut versus zoom** (`cuts.ts`): a one-frame scale jump (flow expansion with a near-zero neighbourhood) or a one-frame translation jump is evidence of a cut; a continuous zoom or pan is coherent over many frames and is not. In strict reference mode a split now needs:
  - **Geometry break:** a flow reset, scale jump or transform jump;
  - **and a picture change:** a palette, level or motion-regime change;
  - **and no return:** the picture does not come back within half a second.

  This recovers punch-in cuts that keep the palette.
- **Long clips:** the dense per-frame pass and person masks run over the whole clip in 4 s chunks whose pixels are released at once; only compact features are kept (about 1.2 MB of JSON per minute).
  - **Frame rate:** 30 fps up to 20 minutes, 15 fps beyond.
  - **Vision:** the budget grows to a sample every 2.5 s past about 16 minutes; the cache key changes only for those clips.
  - **Tone:** sampling covers the whole clip, reads each frame's pixels once instead of twice, and reports where its time goes.
- **Caches:**
  - **Diagnostics:** each run reports HIT/MISS per stage across clips, the reference analysis, and the recomputed matching time.
  - **Invalidation:** per-file caches and the per-clip index are keyed by file identity and analysis versions only, so changing the reference or one raw file invalidates nothing else.
- **Test harness:** `scripts/run-native-verification.mjs` wraps the Windows driver. On failure it:
  - screenshots the window and keeps the app console the driver records;
  - closes the window gracefully, and stops only the instance this run launched;
  - moves a recovery snapshot into the evidence folder only if the run created it and it refers to the project under test.

## Long footage 2.0: semantic action matching and cut-safe selection

Long footage 2.0 replaces "find something that moves and looks similar" with "find the stretch that moves the same way, inside one shot, long enough to play the reference shot".

- **Frame-accurate cuts** (`packages/ai/reference/cuts.ts`, `frameCuts`). Scene detection compares sparse samples and misses cuts between similar material (two dark takes from one corner, a held frame and live action of the same subject). The second stage runs on the dense 33 ms frame measurements.
  - **Primary:** a one-frame change spike well above its own neighbourhood (≥ 4×; neighbours measured over frames that actually update, so footage below the delivery rate does not fake spikes), or a layout jump ≥ 8× its neighbourhood under camera movement. A discontinuity between moving and static picture needs less (≥ 2.5×).
  - **Joint evidence (≥ 2):** layout jump, palette jump, flow reset (judged against the frames before the cut), sharpness shift, level shift, motion regime switch, subject jump or appearance (person contours). Flashes that return within three frames are rejected; a title appearing or leaving over the same picture is masked by its measured box.
  - **Strict mode for finished references:** stylised effects imitate cuts, so a reference shot is split only when global flow resets *and* the palette, level or motion regime changes, and the picture does not return within half a second (silhouette flashes, colour pulses, short inserts). `extractDNA` applies it after the motion-residual split.
  - **Cut-safe segments:** `cutSafeSegments` splits each scene at every frame cut and keeps a 67 ms (two-frame) margin on both sides. Nothing selected crosses a cut, and no measurement of one segment borrows frames from its neighbour.
- **Temporal action signature** (`action-signature.ts`). Measured identically for every reference shot and every candidate window: movement energy over time (12 steps), where in the frame movement happens (4×4 region shares), camera pan/zoom per second, repetition period and periodicity, where the movement peak falls and how clearly. With person contours: the outline's centroid, height and aspect curves, travel axis and extension, and outline movement by body third × axis (a coarse joint-trajectory stand-in). No labels anywhere.
  - **Pose trajectory** (`subject-shape.ts`, `shapePath` / `pathFit`): the subject's outline at eight moments across the shot, compared by dynamic time warping within a two-step band, combined with the typical-shape fit.
  - **Weights from measured discrimination** (`scripts/action-feature-confusion.mjs`): on the two gym cases, outline shape ranked the right exercise first in 14/15 shots, movement regions 10/15, the combined geometry 11/15, the frame embedding 7/15 (2/9 in the dark multi-clip gyms). Regions and subject carry most of the movement weight; look counts less than action and pose in Close Match.
- **Retrieval** (`footage-index.ts`): stage A scores every candidate cheaply (look inside the segment only, movement level, framing, composition, tone, quality, duration feasibility) and keeps 50 per shot; stage B reranks them on movement geometry and pose; the best 12 per shot enter the sequence search.
- **Duration feasibility:** a candidate's usable stretch is its cut-safe segment. A shot is filled only from a stretch at least as long; up to 15% short is bridged by a constant mild retime (`sequence.speed`, folded into any reference speed dip); otherwise `infeasibleShots` reports "No source interval can faithfully fill reference shot N" and the shot is flagged low-confidence. Frozen stretches (held stills) play only held reference shots.
- **Action phase:** the shot's moment is its strongest linked audio event, else its own movement peak when clearly peaked (peak source "reference motion"); the trim puts the source's movement peak there. Audio-anchored peaks weigh fully, movement-anchored ones at 0.6.
- **Shot roles** (`shotRole`): establishing, action peak, detail, close-up, wide movement, setup, transition, rest/hold, from measured movement, framing, camera and the peak source. Each role reweights terms (an action peak leans on action and peak, a hold on movement level and look, a close-up on framing and pose).
- **Global sequence:** beam search of width 40. Score plus progression (+0.01 forward, −0.015 backward within a clip: a tie-breaker only), diversity (+0.01 for an unused stretch), stutter penalty (−0.25 for same-clip neighbours within 3 s), no overlapping reuse unless the reference repeats a shot (same look *and* movement similarity ≥ 0.9; two moments of one take look alike but move differently).
- **Explanations:** every choice carries its role, confidence (high / medium / low), reasons (strongest terms, movement match detail, feasibility, peak placement), per-term meters (action trajectory, pose, movement level, framing, look, composition, tone, audio/action peak, quality, plus movement over time, where it moves, camera move, body trajectory, duration fit), and distinct alternatives (another clip first, then another stretch; never within 2.5 s of the choice) each with what it lost on. Low-confidence shots are named in the warnings.
- **Choose another take:** before Apply it rebuilds the preview; after Apply it edits the recreated sequence's clip (source, in point, speed curve) as one undoable edit, "Choose another take".
- **Persistent incremental index:** each clip's segments, frame cuts and candidates are stored under `footage-index-<version>:<vision model>:<people|no-people>:<dense|sparse>:<file identity>`. Every per-clip cache (dense frames, person masks, aperture, tone) is now keyed by file identity (path, size, modified time) rather than project asset id, so a second recreation, a new project holding the same files, or one more clip reuses all of it. The derived store holds 512 MB / 4096 entries (was 64 MB / 512).
- **Analysis speed and progress:** profiling (`scripts/profile-footage-analysis.mjs`) showed 2.3 s of analysis per footage second, half of it person masks in the unoptimised dev build. `supp-media` now compiles at `opt-level = 3` even in dev builds (3.1× faster), and each clip's stages run concurrently, two clips at a time (6.5× in total on the profiled clip). The progress line reports footage analysed, clips done, the stages running per clip and cache reuse; the preview reports per-stage totals and matching times.

## Long-footage selection (footage index)

Raw footage may be far longer than the reference. `packages/ai/reference/footage-index.ts` treats every supplied clip as one searchable pool and never assumes a clip's first seconds are the useful part.

- **Index:** `buildFootageIndex` works from the cached analysis of each whole clip: quality every 500 ms (motion, luma, sharpness), scenes, vision embeddings, layout, people. Nothing is decoded again, so the reference can be rematched cheaply.
  - **Candidates:** it proposes *action* windows around motion peaks, refined between samples, and *hold* windows across calm stretches, inside every scene.
  - **Quality:** each window gets a quality share (sharp, exposed, stable, not black) with named issues (blur, exposure, black, shake or transition). Coverage is reported: clips, supplied and analysed duration, candidate count.
- **Requirements:** each reference shot carries its wanted duration, look (embedding), framing, pose (subject shape), motion, layout and luma. It also carries the moment that matters inside it: its strongest linked audio event from the event graph (impact > drop > bass hit > downbeat > kick > snare > beat), as a fraction of the shot.
- **Scoring:** `scoreCandidate` first trims the candidate so its action peak lands at the shot's peak fraction inside the scene; there is no centring. It then scores look, pose, framing, motion, peak alignment, composition, tone and quality, with mode weights.
  - **Close Match** follows the stated priority: action/pose, framing, motion, audio-event alignment, composition, tone, quality.
  - **Creative Remix** leans on action.
  - Windows that are mostly unusable lose 70% of their score, so better footage always wins.
- **Global choice:** `selectShots` runs a beam search over the whole edit (width 10, top 12 candidates per shot).
  - **Reuse:** overlapping use of the same source interval is forbidden unless the reference itself repeats a shot (near-identical look). Reuse is recorded as `{ intentional, reason }`.
  - **Neighbours:** same-clip moments within 3 s are penalised as a stutter, and going backwards within one clip slightly.
  - **Alternatives:** the best three are kept per shot.
- **Planner:** the global choice is each shot's first option, and the existing local matcher remains the fallback. Caption-led edits keep each source's chronology with the local matcher. Matches record `selection`, `match`, `alternatives`, `reuse` and `peak`, and the plan reports coverage.
- **Preview:** "Why each source moment was chosen" lists per shot the source moment, the action-peak placement, per-criterion bars and overall match. Up to three alternatives each offer *Choose another take*, which swaps that shot's source in the plan and re-previews without re-analysis.
- **Long-footage fixes found on real media** (a 90 s clip of held frames and planted action):
  - **Missed cuts:** scene detection misses cuts between similar material. The index splits scenes at isolated one-sample frame-difference spikes (≥ 0.05 and ≥ 2.5× their neighbours), so no candidate straddles a cut and no cut spike counts as action. Segment edges are conservative: the last sample before the spike, and the spike sample.
  - **Motion gate:** when the reference shot moves, a candidate's score is scaled by its motion fit, so static footage cannot play an action shot.
  - **Look:** look uses vision embeddings only within ±1.5 s of the window. Otherwise it falls back to the dense per-frame colour signature (luma, contrast, saturation, temperature).
  - **Dense vision sampling:** native vision analysis samples long scenes (over 7.5 s) every 2.5 s and analyses up to 160 scenes, within 400 frames per clip, instead of three frames in at most 32 scenes. The cache key revision `dense-long-scenes-1` forces recomputation. The 90 s case went from 6 to 38 embeddings.
- **File dialogs:** every native file dialog runs on one long-lived `file-dialogs` thread that keeps STA COM initialised for the process lifetime (`src-tauri/src/dialogs.rs`). Before this, dialogs ran on short-lived blocking-pool threads. Their final COM teardown unloaded the shell dialog component (`explorerframe.dll`) while its callbacks were pending, and the app crashed with an access violation about 90 s after the Deliver save dialog (Windows Error Reporting, BEX64 in `explorerframe.dll_unloaded`).

## Recreate-workflow UI

The Recreate panel is now organised for the task:
- **Layout:** a header with progress steps (Sources → Style → Preview → Apply), then Sources and Style cards side by side, collapsing by container width. The style options sit in a compact two-column grid.
- **Actions:** one primary *Recreate This Style* button in an action bar that summarises the choices; after preview, an *Apply recreation* bar.
- **Results:** stat cards (shots, BPM, matched ranges, editable titles) and the raw-footage coverage line. Notes are grouped in one callout, and evidence uses chevron sections, compact tables and confidence meters, with tags for unmatched audio events.
- **Elsewhere:** audio-event markers on the timeline have their own colour, a stem and a drag cursor. In AI Studio the timeline is capped at 220 px so the planning panel has room.

All accessible names used by the automated Windows driver are unchanged.

## Structural recreation of audio (3.1)

*Recreate audio structure* no longer moves each reference event to the nearest replacement event within 150 ms. It aligns the two soundtracks' structures globally and then solves the edit's relationships (`packages/ai/reference/structural-alignment.ts`).

- **Structure** (`packages/ai/audio/structure.ts`):
  - **Sections:** `segmentsOf` divides a timeline at drops, silence edges, sweep peaks and starts, section changes and fade-outs, collapsing boundaries closer than 0.6 s. It labels each section by function and energy: intro, build, drop, energetic, phrase, breakdown, outro, silence, dialogue. Dialogue means speech over sparse drums; sung words over a groove remain music.
  - **Beat clock:** `beatClock` gives fractional beat, bar, beat-in-bar and phrase (4 bars) coordinates. The beat list is regularised, so a gap of about *k* median beats is filled.
- **Normalised coordinates:** every event-graph link stores section label and progress, beat position and phase, beat-in-bar and phrase progress (`measured`). It also stores its association (beat, phrase boundary, transient, impact, section change, sweep, silence edge, vocal word, no audio event) and an explicit constraint such as `title_in BEFORE impact -73 ms` (`inferred`).
- **Alignment, in the beat domain:** one reference beat maps to ½, 1 or 2 replacement beats, whichever keeps the beat length nearest the reference.
  1. **Start.** The start beat is chosen by global agreement of linked event types, section labels and downbeat phase.
  2. **Landmarks.** Matching drops, sweep peaks and silence edges within four beats become control points.
  3. **Events.** Linked reference anchors are mapped by an order-preserving dynamic programme. Its cost combines type similarity (anchor families, closest first), same predicted section, bar phase, strength and position against the structural prediction, with a skip cost. No later event can map before an earlier one.
  4. **Constraints.** Each visual event is placed at its mapped anchor plus its measured offset. Offsets up to 120 ms stay in milliseconds; longer ones scale with the beat length.
  5. **Unmapped anchors.** When an anchor has no counterpart, the event follows the beat map and is reported as *No suitable replacement event found* (`status: "no-replacement"`). Final times are kept monotonic.
- **Diagnostics:** the plan records where every visual event went and why: reference → adapted time, trigger → replacement, kept relation and offset, per-term reasons and confidence. This goes into `ai.audioMapping` (TypeScript and native schemas) and the preview's Audio events table. `ai.audioEventFrames` stores the detected events of the audio actually played, as snap targets.
- **Detectors:**
  - **Tempo:** tempo is octave-aware. Local periods are folded to one octave. The tracked pulse, half and double are scored as hypotheses: do in-between pulses lack the sub-bass attack and strength of the main ones (subdivisions)? Do midpoints carry them (a missed level)? A broad prior also contributes. Medians are taken within continuous runs, and `tempoHypotheses` and `tempoAmbiguous` are stored.
  - **Downbeats:** chosen from the linear sub-bass accent per bar phase plus votes from impacts and drops on a beat.
  - **Drops:** a sustained sub-bass and level rise. The before-level counts audible frames only. The after-level skips impact tails and must still hold 1.5 s later. A rise within 1 s of a silence ending is re-entry, not a drop. The time is refined to the steepest sub-bass rise and snapped to an attack.
- **Generated effects:** `plannedSounds` measures each reference effect's peak over the music just before it, plus attack, release and band balance. The clip gain reproduces that relation over the replacement's bed at the mapped time plus the music gain, against the synthesised sound's measured peak, and never exceeds −3 dBFS. Attack and release become ordinary gain keys. Ducking of the reference music is not measured separately from the effect's tail, so the music is not ducked.
- **Timeline output:** the default audio track carries the audio actually used: named "Reference audio" in reference mode and "Music" otherwise. It is omitted when nothing lands on it. The SFX track exists only when a sound is placed.
- **Interaction and limits:**
  - Audio-event markers can be dragged. They snap to `audioEventFrames` within about 8 px; Alt moves the marker alone. Each drag is one history entry.
  - Focused intervals may now run up to ten minutes; title tracing is streaming and linear in duration. Audio analysis decodes up to 600 s.
- **Text evidence:** a line read identically in at least five sampled frames, with three or more letters and nothing dubious, counts as consensus even when only one OCR preprocessing pass reads it (temporal aggregation). Short words still need both passes.

## Audio fidelity and the shared audio/visual event clock (3.0)

**One clock.** `packages/ai/audio/features.ts` decodes any soundtrack (natively through `decode_audio_pcm` in the desktop app, through Web Audio elsewhere) to 22.05 kHz stereo and measures it every 10 ms: RMS (mono, left, right, side), log energy and half-wave spectral flux in five bands (sub < 120 Hz, low, mid, high, air), spectral centroid, and spectral flatness between 300 Hz and 8 kHz. Reference visual analysis already reports milliseconds of the same file, so every audio and visual event shares one millisecond clock.

**Typed audio timeline.** `packages/ai/audio/timeline.ts` turns those features into `AudioTimeline` (`dna.audio`):
- onsets, refined to the steepest linear-energy rise and classified by band shares, decay rate, sub-band ring and flatness (kick, snare, hat, impact, bass hit, plain onset);
- beats by dynamic programming over the onset envelope with a locally estimated period (tempo may drift; nothing is quantised to a grid), with an octave check on alternating beat strength;
- downbeats from the sub-bass accent phase (4/4 assumed, withheld when the phase evidence is weak);
- sections and drops, risers and whooshes (the anchor is where the sweep peaks), filter sweeps, silences, gradual fades, persistent level changes, stereo width changes;
- transcript words with their measured timing.

Every event keeps `measured` values (dB, decay, shares, flatness) apart from `inferred` labels. `capabilities.notMeasured` states what is not analysed: reverb, distortion, pitch, reverse, stutter, general EQ, source separation and other time signatures.

**Event graph.** `packages/ai/reference/event-graph.ts` lists visual events (cuts with their transition kind, title in/out, colour pulses, subject flashes) and audio anchors (beats, downbeats, typed events, word starts and ends, sweep peaks, silence edges). It links each visual event to its most plausible trigger by an affinity table × anchor strength × distance. The measured offset is kept, and the relation is classified as on (within about a frame), before, after, offbeat (half a beat between) or unanchored. `grammar` summarises the fractions per visual kind (on transients, on downbeats, on lyrics, beats per shot). The graph is stored in `dna.eventGraph`. Nothing in it names a reference, a word or a genre.

**Audio modes** (`Controls.audio`, the *Audio* control in Recreate an edit):
- *Supplied music*: as before.
- *Use reference audio*: the native `extract_reference_audio` command writes the reference soundtrack as a 48 kHz WAV in app data and imports it as an ordinary audio asset. The planner places it on a "Reference audio" track with Source In = the interval start, so pictures and sound share the reference clock. Raw clip audio drops to −60 dB and supplied music is left out. The reference video itself never enters the timeline.
- *Recreate audio structure*: the supplied music is measured with the same analysis. `alignReplacement` scans offsets (10 ms) for the one where the replacement's events best stand in for the reference's linked anchors: same kind first, an equivalent family member at a clear discount, best match not first match. Each linked visual event moves onto its stand-in (keeping its measured offset). `retimer` makes a monotonic piecewise-linear retime pinned at the interval start, and Close Match applies it to the whole DNA before shots are matched. Sounds the reference ties to visual events but the replacement lacks (impacts, bass hits, whooshes, risers) become locally synthesised WAV assets (`synth.ts` → `import_generated_audio`) on a "Recreated SFX" track. Rising sounds are trimmed from their start so they still peak on the event. Smart Adaptation and Creative Remix snap to the measured beats of the audio actually used.

**Editable events.** Each linked anchor becomes a sequence marker; `ai.referenceEvents` records the layers it drives (cut clips, titles, pulses) with relation and measured offset. `sequence.moveEvent` moves a marker alone, or with its layers: a linked cut is rolled so both shots stay in sync with their sources; titles, pulses and their companion layers (`-ink`, `-blur`) move without changing length. In the timeline, an audio-event marker takes ←/→ (Shift: 10 frames, Alt: marker only); every move is one history entry. `audioMode` and `audioNotes` record what the plan did and why. Both TypeScript and native schemas validate and round-trip these fields.

**Multimodal shot evidence and content aperture.** The matcher now returns each scoring term's contribution (length, visibility, look, composition, framing, subject, pose, motion, action, reserve, repeat and continuity penalties); the preview's shot table shows why each range was chosen. Outside portrait delivery, the reference's own content box is measured with the raw-footage aperture analysis. Footage covers that box rather than the full frame, and `sequence.letterbox` reproduces the bars as editable black rectangles, one top-of-stack track per bar so no track holds overlapping clips. Deliver no longer waits indefinitely on media-resource cleanup (an `AudioContext.close()` that never settled held a finished export in "Rendering…").

**Verification tools.**
- `scripts/make-reference-corpus.mjs` generates structurally different references from ffmpeg generators and synthesised sound, with exact ground truth (`truth.json`); no copyrighted or downloaded media is involved.
- `scripts/measure-av-fidelity.mjs` scores a render against its reference per category: onset/beat/transient F-measures, loudness envelope correlation, A/V lag and drift, cut and flash agreement, cut-to-audio relation agreement, and detector accuracy against ground truth.
- `scripts/inspect-audio-events.mjs` prints what the analysis finds in any file.

## Measured typography and depth reconstruction

The `reference-text-v8` local OCR result carries bounded, timestamped normalized glyph boxes and 32×16 ink samples. Installed-font matching adds measured ink extents and centers. Close Match transforms those boxes through the visible foreground footage rectangle, aperture crop and animated parent transform, then creates ordinary text size/position/scale keys through the existing command history. Reviewed word changes remeasure the selected font. Saved style profiles strip wording and observed/template glyph pixels; projects retain editable text and provenance, not reference video frames in the render graph.

Reference-depth inference compares expected and observed glyph retention inside/outside synchronized person contours. It requires repeat observations with sufficient visible ink, rather than inferring occlusion from bounding-box overlap. Unknown depth stays in front; confirmed behind-subject or explicit manual mode uses muted foreground copies with editable masks. Current final fixtures confirm a front-layer decision for REASON; no difficult automatic behind-subject title has passed. Small-model contour quality is still insufficient around equipment and limbs.

All analysis remains local. Person-model installation is explicit with bounded size and a pinned digest; neither project loading nor reference generation silently downloads a model. Existing provider, cloud-consent and credential boundaries remain in force. See `docs/REFERENCE_FIDELITY_BREAKTHROUGH.md` for observed limitations and verification provenance.

Local reference analysis stores normalized OCR ink, observed intervals and word agreement across frames and preprocessing passes. When a matching project transcript or installed speech model supplies timed words, the planner compares their exact normalized text in a bounded time window. It retains uncertain observations for review. The font matcher compares rendered glyphs from available system fonts with the observed ink and records the chosen family and weight on the editable text layer.

Portrait generation measures persistent paired black bands in independent source footage. The planner maps each detected aperture into composition crop coordinates. For wide shots with equipment outside the person bounds, it preserves the full active picture and adds an editable blurred copy below it. Both layers sample the same source time and only the original contributes audio.

Optional person occlusion runs the explicitly installed PP-HumanSeg ONNX model locally at 10 Hz. The planner aligns successive contour vertices and maps them through the source time-remap curve into editable mask keys. A muted foreground video layer carries the mask above the titles. The largest exterior contour can omit limbs or include equipment. Current evidence supports editing and rendering these masks, with review required for difficult poses.

The local reference service schedules evidence extraction and source matching. A stage count stays monotonic while its detail identifies the actual operation. Style DNA stores shot timing, measured luma and color, framing, motion, cadence holds, OCR geometry and music evidence. Reference media is a read-only analysis input. The matcher allocates disjoint source windows inside real raw scenes. It scores visibility, local motion, subject/framing compatibility, timing and continuity. Smart Adaptation varies holds with measured relative motion. Creative Remix changes rhythmic contrast and favors visible action. Plans insert only selected raw and audio assets into an independently editable composition through guarded editor commands.

The matching engine, compositor and native encoder can be tested independently. `scripts/capture-reference-analysis.mjs` measures local files, `tests/e2e/reference-edit.spec.ts` exercises the UI, and `scripts/render-reference-sequence.mjs` round-trips a project through native storage before exporting it. `scripts/compare-reference-edit.mjs` decodes frames and maps them to corresponding reference times. Exact original time-remap curves, fonts, proprietary graphic assets and unobserved transitions cannot be recovered from these measurements.

Reference wording is selected independently of recreation mode. Original mode reads OCR words from the active reference even when a reusable profile is selected. Adapted mode prioritizes quoted user wording, then source-bound transcript words, then sufficiently confident action labels. Omit mode excludes reference titles. Recognition measures glyph position, size, bright neutral foreground, saturated emphasis and changes over consecutive samples. A word-prefix expansion becomes editable word build. Native OCR uses a versioned cache. These measurements estimate appearance and motion. Precise font identification and arbitrary caption rewriting remain future work.

Reference text creation passes measured ink and a cap-height size limit into the ordinary typography command. Existing canvas/GPU typography, editable emphasis, safe-band placement and native persistence remain the render path. Generated media layers reference only selected raw inputs and permitted audio. The verification renderer receives those assets alone, then compares actual exported pixels at titles, cuts and speed keys.

The precise command agent resolves the active composition before constructing its allowlisted context. Project identity and composition identity remain distinct. Preview executes the ordinary command against a history snapshot, Apply checks the original project/revision, and Undo/Redo use shared history. A missing composition or an outside-scope selected layer fails before applying changes. Native acceptance verifies a single brightness revision survives full exit/reopen and reaches exported pixels.

The accepted gym fixture covers real four-shot detection, three source-selection modes, hard cuts, one measured motion accent, bounded color treatment, editable OCR-derived text and supplied-music synchronization. The three modes have real Windows Deliver exports. Travel, talking-head/lifestyle, five-input and unsupported-transition acceptance remain open. Per-shot visual matching, exact transition recovery and reference-conditioned sound design need further implementation.

# Editable kinetic typography

The local typography planner intersects source-fingerprinted transcript or music events with source trim and the inverse speed curve. Timing can also come from cut boundaries, speed keys and the opening shot. The planner scores safe bands against transformed, sampled person boxes and weights the upper 35 percent of each box as a conservative head-region estimate. A review flags residual overlap. Transcript words retain their local frame offsets when changing presets.

The text.create command authors standard text clips. Layout, active-word emphasis, rounded background, stroke and shadow share a glyph surface across Canvas and WebGL. Twenty treatments use ordinary editable animation channels. Preview is revision-guarded. Apply, manual edits and Undo use project history, and Rust project IO persists the same text fields and curves. The reference engine should reuse these commands for editable generated text.

# AI Studio foundation

## Editable portrait reframing

`reframe/service.ts` runs a normal LOCAL background job over selected source ranges. Native `sample_subjects` reuses installed YOLOX with bounded 100–1000 ms sampling, canonical session path grants, content/metadata fingerprint checks, cancellation and atomic SHA-keyed caching. It never downloads a model automatically. Browser acceptance can consume captured real native evidence; it cannot pretend to perform unavailable inference.

`reframe/tracking.ts` associates measured boxes conservatively using overlap, displacement and size, holds uncertain detections, interpolates centers, applies a dead zone and smoothing, protects margins and reduces linear keys within an explicit pixel tolerance. Scale remains conservative per shot; wide poses/groups retain letterboxing. Locked/Smooth/Responsive and main/both/bright-neutral-torso selection are explicit. The torso option is a measured color heuristic, not clothing classification or person re-identification. Distant ambiguous motion holds the previous track instead of inventing a match.

The pure planner produces `sequence.duplicate` and `sequence.reframe` calls. A detached normal History transaction constructs the playable preview. Apply checks the snapshot/revision and executes one ordinary history entry. Default landscape conversion preserves the source composition and remaps internal IDs. Source fingerprints, timing, locks, parent/matte/rotation/crop dependencies and overlay resizing are checked again by the command adapter. The result contains only ordinary editable Position X/Y and Scale keys, plus descriptive revision metadata. No special AI render path exists; manual Inspector changes, preview and export use the same animation evaluator.

Native acceptance includes a manual first-key override, full application restart, exact graph equality and all 600 frames exported at 1080×1920 H.264/AAC. Decoded pixels distinguish the override from the original camera. See [REFRAME_ACCEPTANCE.md](docs/REFRAME_ACCEPTANCE.md). This completes the supported portrait milestone, not the aesthetic-gym/time-remapping roadmap.

## Existing-sequence revisions

`revisions/service.ts` routes supported local requests to `planRevision`, inspecting the current composition and reusing source-bound analysis when needed. `sequence.revise` is a bounded changeset of existing clip IDs, source/range patches, removals and marker movements. The shared command adapter preserves retained masks/effects/animation and validates locks, source handles and dependencies. Detached preview, explicit Apply and one-step normal history Undo/Redo are mandatory. Descriptive revision records persist on the composition; they are never executable project data. The UI provides real sequence playback, per-layer changes, Cancel and persisted revision history. See [REVISION_ACCEPTANCE.md](docs/REVISION_ACCEPTANCE.md).

Project and native analysis share an opaque asset-ID contract; UUID format is not required. See [IDENTITY_CONTRACT.md](docs/IDENTITY_CONTRACT.md). Native session path grants remain independent of IDs.

## Editable rough-cut execution

`rough-cut/service.ts` runs bounded local analysis directly within a shared background job, with source-bound results and real monotonic progress. Models install only on explicit request. `model.ts` parses bounded edit briefs; `planner.ts` retains component evidence, diversifies non-overlapping source windows and proposes measured-onset-aligned cuts. Multiple music sources require selection or unambiguous context. `beats.ts` uses measured events only.

Strict `sequence.create/insert/marker` calls pass through the normal registry and detached-history preview. `resultCompositionId` selects the actual new sequence. Apply is one normal undoable transaction with stale-snapshot checks; the original sequence remains intact. Edit/Export expose sequence selection. An export snapshot wraps the selected composition, retaining globally unique IDs; native grants cover reachable nested media. Persisted v9 provenance is descriptive data, never executable commands.

`RoughCutReview` provides real source frames, scores/reasons, remove/reorder/replace, temporary playback/seek and Apply/Undo. Unsupported caption/speed requests explicitly report their limitations. See [GYM_ACCEPTANCE.md](docs/GYM_ACCEPTANCE.md) for passed first-prompt acceptance and remaining work.

Status: local media analysis includes real CPU transcription, measured silence/scenes/music, source transcripts, sampled ONNX vision and paired text embeddings. Explicit verified installers and model removal exist; results remain data until normal command preview/Apply. See [MEDIA_UNDERSTANDING.md](docs/MEDIA_UNDERSTANDING.md) and [VISION_VALIDATION.md](docs/VISION_VALIDATION.md). The fp32 image encoder replaces the failed quantized candidate; exact exercise/rep recognition is not claimed. Supported rough cuts/revisions/portrait framing pass native acceptance; aesthetic finishing, segmentation, general object tracking and cloud execution remain unfinished.

## Providers and models

`packages/ai/providers.ts` defines `AIProvider<K>`: descriptor, capabilities, validation, and asynchronous typed `run`. Providers receive immutable context and a JobContext, never the editor store, mutable project or filesystem access. Provider types distinguish Local, Remote API and Custom / OpenAI-compatible. Custom endpoints are conservatively CLOUD; a future trusted local-endpoint policy needs explicit treatment.

AIModelManager tracks ID, name, task, provider ID, size (null means unknown), installed state, execution device, supported devices, version and download state. Devices include CPU, CUDA, DirectML, Core ML, Metal and remote. The foundation registry includes a built-in caption utility; MediaAnalysisService registers installed Whisper and MobileCLIP/YOLOX runtimes. Only the explicit native installers download pinned artifacts. The metadata registry itself performs no inference. Unsupported device selection fails. Vision session setup attempts available CUDA/DirectML providers before CPU, recording actual successful setup; the installed pack currently includes CPU only. No GPU runtime is silently downloaded.

## Operations and project results

| Operation                         | Result contract                            | Executor / apply adapter                                |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Transcribe                        | Timestamped transcript                     | Local whisper.cpp CPU; source-bound words/segments      |
| DetectSilence                     | Source pauses mapped to timeline ranges    | Local PCM/RMS analysis; shared ripple commands          |
| GenerateCaptions                  | Transcript and timed caption cues          | Local SRT backend; real text clips                      |
| SegmentSubject / RemoveBackground | Clip/frame mask proposals                  | No inference executor; compositor supports Bezier masks |
| TrackObject                       | Existing animation channels and keyframes  | Unavailable                                             |
| EnhanceSpeech                     | Opaque native artifact handle and duration | Unavailable                                             |
| SemanticSearch                    | Asset IDs, ranges and scores               | Local paired embeddings over analyzed source ranges     |

These are extension contracts, not claims that unsupported processing has run. Segmentation needs a real validated inference executor and command adapter. No provider result is interpreted as chat text saying an edit was completed.

`transcript.ts` defines a standalone Zod persistence contract mirrored in Rust. Project schema v8 stores source-bound transcripts and words; v3 introduced SRT transcript storage. SRT import validates 2 MiB / 10,000-cue bounds, timestamps, text and nonoverlapping order. Imported timestamps are sequence-relative milliseconds. Caption boundaries round to nearest sequence frames; overlapping or sub-frame cues fail.

## Context, planning and history

`snapshotContext` explicitly projects project ID/name/revision, sequence ID/dimensions/rate/duration, selected clip/layer IDs, media metadata, transcript summaries, masks and effects. It excludes native paths, media contents, credential values and transcript text. The snapshot is deeply frozen. CompositionContextAdapter defines the active-composition extension. Source caption and revision commands target the active sequence; AI Studio retains that sequence.

Flow: command input → allowlisted intent → typed operation/source digest → background job → validated result → preview → explicit Apply → one ordinary History Edit → save/reopen/export.

The caption resolver and separate bounded editor-agent, rough-cut, revision and reframe resolvers produce validated plans, never JavaScript, shell commands or arbitrary project patches. Providers compute data only. The caption adapter independently verifies text, timing, source, count and schema, and creates actual text-clip proposals.

Apply requires both the original project identity and revision, rechecks the Immer draft origin, then atomically imports a transcript, adds a Captions track and inserts text clips. Changes made during execution, loading another project, or undo/redo invalidate old previews. Normal editor undo/redo reverses the entire application. No provider modifies state outside commands/history.

## Jobs and shell

`packages/jobs` is a shared bounded queue used by AI Studio and MP4 export. It implements Queued, Running, Paused, Completed, Failed and Cancelled. Progress is actual cues/frames; absent progress is indeterminate. Pause is cooperative at checkpoints and only exposed by supporting executors. Export cannot pause. Cancellation aborts the signal, discards late results and holds the concurrency slot until the worker actually stops. Capacity is 100; concurrency is one. Jobs and operation history are session memory, not crash-resumable persistent tasks.

AI Studio exposes command input, context/locality, the supported quick action, SRT paste/import, offset, model metadata, job progress/cancel/pause, history, result timing/text preview, Apply and normal project Undo. Completed processing means a validated preview exists; it does not mean changes were applied.

## Privacy and credentials

Processing is LOCAL. Explicit pinned model installers may download weights; no media upload, external API-key input or remote execution transport exists.

CloudAuthorizationGate is a tested contract for a future transport. Before upload, show CLOUD, provider, HTTPS endpoint origin, operation, source count and data categories. Explicit confirmation issues a short-lived, single-use token bound with SHA-256 to operation, context, provider, model, source digests and disclosures. Media and transcript text require separate disclosures. Missing, rejected, expired, reused or changed grants fail closed.

This frontend gate is not an OS security boundary. A future native transport must enforce the same binding and confirmation before reading/uploading media, including redirects/retries. No such transport ships here.

NativeCredentialStore is an opaque-handle interface only. Implement setup/access in the native host with Windows Credential Manager, macOS Keychain or Linux Secret Service before adding external execution. The webview receives only configured state and references. Never store keys in frontend source, browser storage, project files, logs, presets or job payloads. No credentials or insecure fallback store are introduced here.

## Aesthetic editing and source-time model (in development)

Seven gym profiles feed evidence ranking, ranked hooks, bounded shot scheduling, measured onset/energy events and editable effects. `rough-cut/service.ts` orchestrates cached vision/music analysis, initial source-bound planning, separate five-frame RGB shot matching and dense person-aware camera planning in one shared background job. `sample_color` is LOCAL, reads only session-authorized media, checks source stability and stores small fingerprint/mtime/range-keyed results without invalidating expensive vision/transcript caches. Low-chroma RGB cast is a white-balance proxy, not skin isolation or a measured color temperature; conservative global corrections take precedence when evidence is weak.

Schema v10 adds optional positive speed curves, analytically integrated into source time. All normal edits and silence/caption mappings use this source-time mapping. Native audio resampling follows it; pitch changes with speed. Slow motion repeats decoded frames. No optical flow, synthesized frames or pitch-preserving processing is claimed. The model bounds remapped clips to five minutes and 128 keys. A future pitch-preserving audio stage must be a separate validated runtime.

Framing remains the base clip camera animation. `sequence.punchIn` adds an ordinary null parent/controller, leaving the clip's camera keys intact and exposing independent easing/scale/position/timing through normal editing. All generated operations use the allowlisted command registry and the same atomic preview/History boundary. Review rebuilding is asynchronous and disables Apply until a complete current preview exists.

Ordered finishing effects include deterministic monochrome grain with size/softness, restrained vignette, neighbor-clamped sharpening, signed temperature and endpoint-preserving tonal contrast, with matching native persistence and CPU/GPU render paths. These are real graph data, not flattened AI assets. Speech-aware mix, captions and audio revisions have passed native acceptance. Full aesthetic transitions, remaining revision intents and complete one-prompt acceptance remain open.

## Future runtime

Speech-aware finishing uses real cached Whisper transcription plus classical silence/energy analysis. Word timestamps remain approximate and are intersected with measured non-silence for ducking; bracket-only non-verbal annotations produce a structured no-speech result. Spoken source ranges retain normal speed. Music-led non-speech source audio is suppressed through editable gain. Normalization is bounded active-RMS gain, not certified LUFS mastering. Gain/fades/ducking are normal keyframes; captions are ordinary text clips. No chat text substitutes for media or timeline state.

The audio channel uses the shared animation contract and history guards. Native export evaluates envelopes on timeline time while resampling source time, then applies static ancestor/clip gain exactly once. Decode-before-trim avoids AAC priming loss from input seeking. Playback uses a hard peak guard; export uses FFmpeg lookahead limiting without automatic makeup. Their peak behavior is deliberately not described as sample-identical. Pitch-preserving time stretch remains a separate future runtime.

Bounded `ai.generated` treatment snapshots record generated gain/scale/speed/effects. They contain no executable commands. Revision planners compare these to current values and retain manual key changes; the baseline is updated only with the next generated proposal, so a manual edit is not silently reclassified as AI-owned. Every revision previews and applies an allowlisted normal History command. The current five audio intents operate on the active sequence and reuse source caches. The newer Universal Reel Engine roadmap continues through typography, reference characterization and sound/tracking/masks; these are not yet advertised as implemented.

Inference belongs in bounded native workers off the UI thread. Explicit model installation must disclose size/license/source, verify a trusted manifest and digest, support cancellation and atomically publish installation state. Distinguish advertised acceleration from a successful runtime probe. Providers must declare supported tasks/memory, validate result artifacts and preserve provenance. Build compositor masks/layers/effect commands before enabling AI tasks that require them. There is no automatic installation path.

Context now projects selected Bezier mask IDs, modes, enabled/inverted flags, vertex/key counts and scalar properties, plus matte references and blend modes. This allowlist is frozen independently of project objects; it excludes full paths/vertices and never initiates transport.

## Autonomous editor command boundary

`packages/ai/editor-agent` adds a strict allowlisted tool registry for move/trim/delete, ordered effect add/update and scalar keyframes. Every adapter invokes the ordinary manual-edit command. Plans accept no arbitrary code or property paths. Preview executes a detached History transaction, validates the complete project and renders a proposed frame; Apply repeats the same commands in the normal history as one atomic action. Preview origins bind to project identity and revision, including a final guard inside the command transaction. Forged, stale, locked, out-of-range and unsupported plans fail without partial application.

The precise LOCAL interpreter handles effect/move/trim requests. “Set contrast to 1.5” revises a unique existing contrast effect or adds one if absent; multiple matches require an explicit manual choice. Specialized rough-cut/revision/reframe routes use actual source analysis. Unsupported instructions reject or disclose unimplemented portions; no resolver claims generative reasoning or exact exercise-phase recognition. Job progress reports actual work. Future providers remain behind the existing privacy boundary; no transport or credentials have been added.

Context now also includes selected layer timing and the requested frame. AI Studio displays the plan, a rendered preview, Create edit, normal Undo and actual job state. The original SRT caption workflow remains functional. The full autonomous-editor acceptance scenario in docs/AUTONOMOUS_AI_EDITOR.md remains open.

The native MediaAnalysisService now executes real speech/audio/video analysis; the model registry receives actual installation and download events from the native host. The original generic provider/credential contracts remain available for future runtimes. No cloud transport exists.

## Advanced reference evidence and editable reconstruction

Reference Editor can revise proposed title wording before Apply. Updating the preview replaces or removes the affected `sequence.text` commands in the plan and revalidates it against the same project and revision. Equal-length word lists keep their individual cue times. Changes in word count use the treatment's built-in timing within the same title interval. The live project receives one history transaction when the user applies the reviewed result.

Reference analysis now joins 30 Hz color/detail/spatial-luminance/block-flow measurements with scene boundaries, sparse semantic embeddings, local OCR and audio events. Evidence is fingerprint-bound and local. CLIP similarity and spatial layout are separate matching signals; neither establishes identity or guarantees an aesthetically equivalent shot. The planner uses only explicitly selected independent raw assets. The exporter verification recursively checks nested source references against the permitted inventory.

Flash and blur become ordinary animated shapes/effect stacks. Zoom, whip and motion bridges become editable null controllers; subject bounds limit displacement/scale and unsafe motion falls back to animated blur. These controllers do not bake or copy reference frames. Color gain is bounded with a neutral-chroma floor to avoid amplifying compression artifacts. Duplicate generated names receive a suffix while composition IDs remain authoritative.

Reference OCR has bright, chromatic and grayscale preprocessing with temporal grouping. Text appearances retain measured position, dimensions, color and timing, including simultaneous short intervals. Persistent edge-label candidates are distinguished from creative copy and excluded with a preview warning. OCR is not a language model: ornate, occluded, textured and fast-moving words remain unreliable. Original/adapted/omitted wording still uses editable text commands and the normal atomic History boundary. No arbitrary font-identification, silhouette segmentation or behind-subject type capability is claimed.

At 30 Hz the local analyzer measures the mean RGB of the darkest and brightest luminance deciles. A short polarity reversal followed by a return to the previous layout yields a timed `colorPulses` entry with those two colors and a rule confidence score. The planner maps the interval to the selected raw shot in each mode. Through `sequence.colorPulse`, it creates two ordinary editable color layers, one driven by a luma matte from the raw clip. The matte's optional `keepSourceVisible` flag preserves the source picture outside the pulse. Older mattes retain their original behavior. A missing palette produces a preview warning. This approximates a negative duotone and cannot recover an exact LUT or a masked subject effect.

Close Match evaluates how much of the current shot and the longest remaining hold can fit after each candidate trim. It then ranks equally feasible candidates by the existing appearance, timing and continuity scores. This prevents an early high-scoring trim from splitting the only suitable long take. Shortened Close Match shots are disclosed in Preview. On the first supplied Reel, five independent exercise takes cover all eight reference intervals in 506 frames.

All video frames now pass through a shared sRGB Canvas2D surface before either compositor backend applies effects. This fixes a real CPU/GPU mismatch on BT.2020 HLG footage while retaining editable grades and source files. The cache preserves alpha, closes discarded bitmaps, releases per-decoder surfaces and updates animated canvas uploads. This is an SDR working pipeline, not HDR mastering certification. Local AAC analysis trims decoded encoder padding to the source presentation duration; the accepted export/mix timing path is unchanged.

Verification artifacts distinguish actual Windows Deliver exports from browser compositor plus native encoder tests. Reports include decoded frame count, black/side-bar scans, source isolation, color/layout differences and sampled pixel comparisons. See docs/REFERENCE_STYLE_CAPABILITIES.md for supported boundaries and unresolved acceptance work.

## Accepted speech-aware audio boundary

Speech-aware audio acceptance PASSED on 3 November 2026. Full native Preview → Apply → Undo → Redo → Save → complete process exit → relaunch/reopen → resave → Deliver export. All compositions/transcripts survived exactly. Five captions, one transcript, eleven music gain keys and manual frame-90 −17.25 dB key remain. Ducking was removed and restored around three measured speech regions. Actual UI export test-results/audio-mix/render.mp4 (copied to NATIVE_AUDIO.mp4) has 300 frames/10s, H.264/AAC, zero black frames, channel peak 0.96236. Its decoded stereo audio is byte-identical to the independently verified timeline mix. Early and late source-only speech have zero lag and >0.99999 correlation. No tolerance relaxation or hardcoded offset. See scripts/verify-native-audio.mjs and test-results/audio-mix/native-verification.json. No pitch-preserving time stretching is claimed.

Active-RMS normalization and peak protection are bounded editing tools, not LUFS mastering certification. Next subsystem: kinetic typography must use ordinary editable layers/animation and guarded History commands, timing from actual transcripts or measured musical events, and explicit social-safe bounds. Background text placement does not imply segmentation or text behind a person. Native rendered animation and full close/reopen are required for acceptance.
