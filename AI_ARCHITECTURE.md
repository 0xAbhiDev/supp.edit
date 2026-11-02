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

| Operation                         | Result contract                            | Executor / apply adapter                                    |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Transcribe                        | Timestamped transcript                     | Local whisper.cpp CPU; source-bound words/segments          |
| DetectSilence                     | Source pauses mapped to timeline ranges    | Local PCM/RMS analysis; shared ripple commands               |
| GenerateCaptions                  | Transcript and timed caption cues          | Local SRT backend; real text clips                          |
| SegmentSubject / RemoveBackground | Clip/frame mask proposals                  | No inference executor; compositor supports Bezier masks     |
| TrackObject                       | Existing animation channels and keyframes  | Unavailable                                                 |
| EnhanceSpeech                     | Opaque native artifact handle and duration | Unavailable                                                 |
| SemanticSearch                    | Asset IDs, ranges and scores               | Local paired embeddings over analyzed source ranges         |

These are extension contracts, not claims that unsupported processing has run. Segmentation needs a real validated inference executor and command adapter. No provider result is interpreted as chat text saying an edit was completed.

`transcript.ts` defines a standalone Zod persistence contract mirrored in Rust. Project schema v8 stores source-bound transcripts and words; v3 introduced SRT transcript storage. SRT import validates 2 MiB / 10,000-cue bounds, timestamps, text and nonoverlapping order. Imported timestamps are sequence-relative milliseconds. Caption boundaries round to nearest sequence frames; overlapping or sub-frame cues fail.

## Context, planning and history

`snapshotContext` explicitly projects project ID/name/revision, sequence ID/dimensions/rate/duration, selected clip/layer IDs, media metadata, transcript summaries, masks and effects. It excludes native paths, media contents, credential values and transcript text. The snapshot is deeply frozen. CompositionContextAdapter defines the active-composition extension. Captions currently target the main sequence; entering AI Studio returns to it.

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

## Future runtime

Inference belongs in bounded native workers off the UI thread. Explicit model installation must disclose size/license/source, verify a trusted manifest and digest, support cancellation and atomically publish installation state. Distinguish advertised acceleration from a successful runtime probe. Providers must declare supported tasks/memory, validate result artifacts and preserve provenance. Build compositor masks/layers/effect commands before enabling AI tasks that require them. There is no automatic installation path.

Context now projects selected Bezier mask IDs, modes, enabled/inverted flags, vertex/key counts and scalar properties, plus matte references and blend modes. This allowlist is frozen independently of project objects; it excludes full paths/vertices and never initiates transport.

## Autonomous editor command boundary

`packages/ai/editor-agent` adds a strict allowlisted tool registry for move/trim/delete, ordered effect add/update and scalar keyframes. Every adapter invokes the ordinary manual-edit command. Plans accept no arbitrary code or property paths. Preview executes a detached History transaction, validates the complete project and renders a proposed frame; Apply repeats the same commands in the normal history as one atomic action. Preview origins bind to project identity and revision, including a final guard inside the command transaction. Forged, stale, locked, out-of-range and unsupported plans fail without partial application.

The precise LOCAL interpreter handles effect/move/trim requests. “Set contrast to 1.5” revises a unique existing contrast effect or adds one if absent; multiple matches require an explicit manual choice. Specialized rough-cut/revision/reframe routes use actual source analysis. Unsupported instructions reject or disclose unimplemented portions; no resolver claims generative reasoning or exact exercise-phase recognition. Job progress reports actual work. Future providers remain behind the existing privacy boundary; no transport or credentials have been added.

Context now also includes selected layer timing and the requested frame. AI Studio displays the plan, a rendered preview, Create edit, normal Undo and actual job state. The original SRT caption workflow remains functional. The full autonomous-editor acceptance scenario in docs/AUTONOMOUS_AI_EDITOR.md remains open.

The native MediaAnalysisService now executes real speech/audio/video analysis; the model registry receives actual installation and download events from the native host. The original generic provider/credential contracts remain available for future runtimes. No cloud transport exists.
