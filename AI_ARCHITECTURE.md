# Reference-to-Edit

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
