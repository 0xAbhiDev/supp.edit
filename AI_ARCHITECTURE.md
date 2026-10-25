# AI Studio foundation

Status: FOUNDATION IMPLEMENTED. Inference, transcription, segmentation, tracking and cloud execution are NOT STARTED. The installed executor converts an existing SRT transcript into actual text clips. It is labeled deterministic processing, not speech recognition or a generative model.

## Providers and models

`packages/ai/providers.ts` defines `AIProvider<K>`: descriptor, capabilities, validation, and asynchronous typed `run`. Providers receive immutable context and a JobContext, never the editor store, mutable project or filesystem access. Provider types distinguish Local, Remote API and Custom / OpenAI-compatible. Custom endpoints are conservatively CLOUD; a future trusted local-endpoint policy needs explicit treatment.

AIModelManager tracks ID, name, task, provider ID, size (null means unknown), installed state, execution device, supported devices, version and download state. Devices include CPU, CUDA, DirectML, Core ML, Metal and remote. The shipped entry is a zero-byte built-in CPU caption utility. The registry does not download models, probe hardware or perform inference. Unsupported device selection fails. Runtime metadata does not grant execution capability: a matching registered executor is required.

## Operations and project results

| Operation                         | Result contract                            | Executor / apply adapter                                    |
| --------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| Transcribe                        | Timestamped transcript                     | Unavailable                                                 |
| DetectSilence                     | Half-open timeline frame ranges            | Unavailable                                                 |
| GenerateCaptions                  | Transcript and timed caption cues          | Local SRT backend; real text clips                          |
| SegmentSubject / RemoveBackground | Clip/frame mask proposals                  | Unavailable; current model only has rectangle/ellipse masks |
| TrackObject                       | Existing animation channels and keyframes  | Unavailable                                                 |
| EnhanceSpeech                     | Opaque native artifact handle and duration | Unavailable                                                 |
| SemanticSearch                    | Asset IDs, ranges and scores               | Unavailable                                                 |

These are extension contracts, not claims that unsupported processing has run. Arbitrary path/raster segmentation needs the future compositor mask model and a validating command adapter. No provider result is interpreted as chat text saying an edit was completed.

`transcript.ts` defines a standalone Zod persistence contract mirrored in Rust. Project schema v3 stores transcripts. SRT import validates 2 MiB / 10,000-cue bounds, timestamps, text and nonoverlapping order. Imported timestamps are sequence-relative milliseconds. Caption boundaries round to nearest sequence frames; overlapping or sub-frame cues fail.

## Context, planning and history

`snapshotContext` explicitly projects project ID/name/revision, sequence ID/dimensions/rate/duration, selected clip/layer IDs, media metadata, transcript summaries, masks and effects. It excludes native paths, media contents, credential values and transcript text. The snapshot is deeply frozen. CompositionContextAdapter defines the active-composition extension. Captions currently target the main sequence; entering AI Studio returns to it.

Flow: command input → allowlisted intent → typed operation/source digest → background job → validated result → preview → explicit Apply → one ordinary History Edit → save/reopen/export.

The current intent resolver recognizes a small caption command vocabulary and rejects other requests. A future natural-language resolver must return this validated plan, never JavaScript, shell commands or arbitrary project patches. Providers compute data only. The caption adapter independently verifies text, timing, source, count and schema, and creates actual text-clip proposals.

Apply requires both the original project identity and revision, rechecks the Immer draft origin, then atomically imports a transcript, adds a Captions track and inserts text clips. Changes made during execution, loading another project, or undo/redo invalidate old previews. Normal editor undo/redo reverses the entire application. No provider modifies state outside commands/history.

## Jobs and shell

`packages/jobs` is a shared bounded queue used by AI Studio and MP4 export. It implements Queued, Running, Paused, Completed, Failed and Cancelled. Progress is actual cues/frames; absent progress is indeterminate. Pause is cooperative at checkpoints and only exposed by supporting executors. Export cannot pause. Cancellation aborts the signal, discards late results and holds the concurrency slot until the worker actually stops. Capacity is 100; concurrency is one. Jobs and operation history are session memory, not crash-resumable persistent tasks.

AI Studio exposes command input, context/locality, the supported quick action, SRT paste/import, offset, model metadata, job progress/cancel/pause, history, result timing/text preview, Apply and normal project Undo. Completed processing means a validated preview exists; it does not mean changes were applied.

## Privacy and credentials

The installed provider is LOCAL, with no network implementation, model downloads, media upload, API-key input or remote execution controls.

CloudAuthorizationGate is a tested contract for a future transport. Before upload, show CLOUD, provider, HTTPS endpoint origin, operation, source count and data categories. Explicit confirmation issues a short-lived, single-use token bound with SHA-256 to operation, context, provider, model, source digests and disclosures. Media and transcript text require separate disclosures. Missing, rejected, expired, reused or changed grants fail closed.

This frontend gate is not an OS security boundary. A future native transport must enforce the same binding and confirmation before reading/uploading media, including redirects/retries. No such transport ships here.

NativeCredentialStore is an opaque-handle interface only. Implement setup/access in the native host with Windows Credential Manager, macOS Keychain or Linux Secret Service before adding external execution. The webview receives only configured state and references. Never store keys in frontend source, browser storage, project files, logs, presets or job payloads. No credentials or insecure fallback store are introduced here.

## Future runtime

Inference belongs in bounded native workers off the UI thread. Explicit model installation must disclose size/license/source, verify a trusted manifest and digest, support cancellation and atomically publish installation state. Distinguish advertised acceleration from a successful runtime probe. Providers must declare supported tasks/memory, validate result artifacts and preserve provenance. Build compositor masks/layers/effect commands before enabling AI tasks that require them. There is no automatic installation path.
