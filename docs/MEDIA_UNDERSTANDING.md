# Local media understanding

The v8 project format reads versions 1–8. Speech transcripts retain source asset/fingerprint, language, segment and word times, optional confidence/speaker fields, runtime/model provenance and approximate timing status. Older SRT transcripts remain valid. Analysis cache data is separate from project history; importing a transcript or creating edits requires Preview and Apply.

## Implemented processing

- **Speech:** official [whisper.cpp b5454](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454), CPU, multilingual Tiny. An explicit AI Studio install downloads 86,620,353 bytes from GitHub and the publisher's [converted model repository](https://huggingface.co/ggerganov/whisper.cpp). Pinned SHA-256 checks and file sizes guard both downloads; temporary files publish only after verification. No startup download and no media upload. FFmpeg decodes the selected audio stream to mono 16 kHz PCM. Full JSON supplies actual detected language, segments, tokens and probabilities. Translation is a settings/provider option; diarization is unavailable.
- **Word timing:** whitespace/token grouping joins subwords and punctuation. Zero-duration tokens remain zero-duration rather than receiving invented times. Word confidence is the minimum supplied token probability, not a calibrated confidence in the whole word. Timings are approximate and may be coarse for scripts without spaces. Upstream VAD is deliberately disabled until its source-offset mapping is verified. Empty/no-speech output fails explicitly.
- **Silence:** 10 ms RMS windows, configurable dB threshold, minimum duration and retained padding. Full detected pauses and proposed padded removal ranges are separate data. No fabricated speech intervals.
- **Music:** positive amplitude-flux peaks with an adaptive baseline and 60–200 BPM autocorrelation. Stored beats are observed attacks, not a fabricated regular grid. Periodicity is an algorithmic score; half/double tempo, vocals and complex arrangements can be ambiguous. Silence produces no BPM or beat candidates. No downbeat detector is advertised.
- **Scenes:** FFmpeg's measured scene score above 0.30 on every frame downscaled to 160×90. Representative source times are scene midpoints. Quality samples at 2 Hz / 96×54 retain luma, dark/clipped fractions, Laplacian variance and normalized frame difference. Scene aggregates expose motion, sharpness, black/frozen fractions; missing sample evidence is null. These measure signals, not artistic value or exercise identity. Fade classification, camera shake decomposition, object/face detection and semantic vision remain open.

## Execution and persistence

Native work runs outside the UI thread, with local-protocol FFmpeg arguments, source access checked against the import/open-project grant, bounded output, maximum 30-minute sources, process timeout and real cancellation. Capture readers continue draining beyond their storage limit so a verbose child cannot deadlock its pipes. Native jobs are registered before execution so cancellation cannot race past an unknown job ID. Progress is completed processing stages or actual downloaded bytes, never elapsed-time estimates. No pause is advertised for inference.

The cache key includes canonical source identity, size/modification timestamp at nanosecond resolution, asset ID, algorithm/runtime version and settings. Source changes during processing reject the result. Timeline edits do not invalidate source analysis. Native JSON results survive application restarts; bounded browser derived storage holds recent result views. `AnalysisBackend`, `VisionProvider` and `DiarizationProvider` separate runtime contracts; cloud backends are rejected until an explicit privacy transport exists. No secret credential handling or insecure key storage was introduced.

## Commands and UI

AI Studio includes capability refresh, explicit speech installation, source preview, analysis jobs/cancellation, transcript search, word/sentence seek, shift-selection, copy, conservative/balanced/aggressive filler candidates, silence parameters and measured result ranges. Missing runtimes are visible and unavailable actions are not advertised as working.

`transcript.import`, `transcript.captions` and `timeline.rippleDelete` extend the existing strict registry. Caption creation maps source timestamps through the selected instance's source In and trim, using timed words when a segment is clipped. Ripple deletion uses the shared NLE piece/animation routines, affects the whole sequence, adjusts markers and rejects locked/dependent layers rather than damaging references. Plans preview on detached history and Apply as one ordinary undoable transaction. Revision and object-origin guards reject stale/forged previews. Source media is never modified.

## Verified evidence

The real Rust installer completed successfully. Native analysis of the upstream 11-second JFK speech sample recognized the speech, detected English, produced word timing, two pauses and 37 onset candidates. Existing five-second footage produced one scene and ten measured quality records. Evidence: `work/analysis-acceptance`; the actual runtime command is `cargo run -p supp-media --example analyze` with arguments described by its usage output.

Five new TS cases verify persistence, trim-aware captions, source/revision rejection, ripple timing/animation across tracks, atomic lock failure, filler candidates and beat snapping. Two new Rust tests verify measured pixel/PCM signals and the absence of beats on silence. The browser case consumes the actual native speech output, then seeks/selects words, previews/applies/undoes a ripple edit, creates captions and saves/reopens words. It requires the explicit local acceptance fixtures; it does not mock successful inference.

The next milestone is real visual semantics and a creative rough-cut planner creating a new editable composition through this command system. The gym acceptance prompts, multi-asset rough-cut export, speed ramps and full autonomous workflow are not yet claimed complete.
