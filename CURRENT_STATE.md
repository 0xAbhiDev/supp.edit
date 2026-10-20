# Current state — GPU/media and NLE milestone, 20 October 2026

Baseline inspected: commit `6503eca`, 19 October 2026. The existing architecture and UI are retained. The Windows executable was launched before editing. Its process/window startup succeeds. Native dialog interaction remains unverified because the Computer Use runtime is unavailable in this session. Browser interaction evidence is recorded separately; it is not a substitute for WebView2/IPC acceptance.

## Baseline audit

| Area        | Observed state                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects    | Creation, browser download/reopen, native atomic write/backup and recovery are implemented. Existing round-trip and recovery tests pass. Single sequence, schema v1.                                                                                                                        |
| Library     | Real import/metadata, preview, Insert, drag, search/filter/grid/list and relink are wired. Preview click opens a modal; its double-click Insert handler conflicts with that modal. Native thumbnails block completion of the import batch.                                                  |
| Timeline    | Selection, move, bounded trim, split, track-local ripple delete, snap, track controls, text/shape creation, marker creation and zoom are implemented. Razor icon splits the selection at playhead; it is not a razor tool. Marker double-click deletion is broken by ruler pointer capture. |
| Inspector   | Transform, four color/blur parameters, simple masks, title/shape controls, gain and four animated properties change graph data and render pixels. No editable stack or graph editor.                                                                                                        |
| Workspaces  | Composite/Color/Audio expose subsets of the same inspector. They are partial workspaces, not separate mature engines. AI Studio is explicitly disabled; no model execution.                                                                                                                 |
| Transport   | Frame stepping, J/K/L, loop, safe areas and fullscreen are wired. Webview decode, wall-clock timing, silent reverse. No native decode scheduler or audio master clock.                                                                                                                      |
| Output      | PNG and native H.264/AAC MP4 render real frames and audio. One export at a time; fixed format/encoder. Cancellation cannot interrupt final muxing after the encoder is taken from its session slot.                                                                                         |
| Preferences | Theme, accent, panel sizes, reset layout, shortcuts and command palette are functional. Hardware list reports compile-time FFmpeg APIs, not tested hardware.                                                                                                                                |

Baseline regression: 16 TypeScript tests and all 3 Chromium integrations passed again. These cover imports, edits, masks/keyframes, save/reopen, recovery, pixels and a mixed-media frame sequence. A broader browser control audit exercises typography, shapes, effects, track controls, zoom/snap, markers, transport/display, workspaces, preferences, library controls, source monitor, delete/undo/redo, PNG and command palette. Native file-picker, save destination, MP4 dialog/cancel, and every platform-specific behavior are not claimed as click-tested.

## Architectural weaknesses and bottlenecks observed at baseline

- Every layer is drawn through Canvas2D at full project resolution. No GPU backend or runtime renderer selection.
- Resource entries are insertion-ordered promises, not a bounded LRU. `pauseInactive` awaits pending loads, so unrelated slow media can stall preview. No decoded-frame cache or prefetch budget.
- Timeline scans all clips for every track, allocates every ruler tick before culling, and recomputes snap candidates for each pointer move. No vertical virtualization.
- Every edit/undo/redo JSON-stringifies the entire project to determine dirty state. Immutable history already provides enough information for a revision token.
- Native thumbnail cache uses an asset ID rather than a source fingerprint and has no size budget. Browser waveform generation scans samples on the UI thread, has no persistent cache, and does not notify the timeline when ready. Native waveforms are absent.
- Native FFmpeg probes have no deadline. Advertised NVENC/QSV/AMF is not proof of a usable encoder/decoder. No GPU/VRAM/RAM inventory.
- Preview and export share the compositor, but renderer failure/recovery and GPU/CPU parity are untested. The suite lacks large-project benchmarks, lost-context tests and background-load stress cases.
- Native and TypeScript models validate independently; schema additions require matching migration/contract tests. Recovery reads need a bounded input size. Relink does not yet preserve historical source bytes for undo.

## Implementation decision

The current renderer now uses WebGL2 texture compositing inside the existing webview with Canvas2D fallback, explicit renderer and preview-resolution controls, bounded resource/frame caches, asynchronous source prefetch, playback counters and hardware diagnostics. A native wgpu surface would require another decode/texture-sharing bridge; no unused crate was added. The interface and existing schema were extended in place.

## Still missing

Native GPU texture sharing and sample-accurate decode/audio scheduling; proxy generation/attachment; persistent job queue; the full professional NLE toolset; graph editor and extended animation; nested compositions, parenting/mattes/blend/effect stacks; Bezier masks; raster photo documents/tools; grading/scopes/color management; audio buses/effects; transitions; RAW; AI/transcript editing; tracking/roto; 3D; plugins; multicam; expressions; broad export formats; docking; cross-platform and production certification. The supplied follow-up brief defines these future stages, not completed features.

## Delivered this cycle

- Real shader transforms, opacity, simple masks, color and Gaussian blur; bounded textures and frame snapshots; lost-context CPU fallback. Full/half/quarter preview resolution persists while exports remain full size.
- A strict 24-resource media pool with idle LRU pruning, at most two upcoming-source preloads, and nonblocking inactive-source cleanup. Webview decode remains system-controlled; native decode workers and sample-accurate scheduling are not implemented.
- Asynchronous native thumbnails and 400-bin waveforms with fingerprinted disk caching; browser waveform worker and persistent derived cache. Memory/disk budgets are documented in RENDER_ENGINE.md. Source changes invalidate previews; browser relink undo restores original bytes and thumbnails.
- Native Windows GPU/dedicated/shared memory/RAM inventory and bounded, real H.264 codec probes. On this host: Intel Iris Xe, 128 MiB dedicated and approximately 7.9 GiB shared graphics memory, 15.8 GiB RAM, eight logical CPUs. QSV encode/decode and D3D11 decode passed; NVENC/CUDA/AMF were unavailable. The active exporter remains software libx264; active webview hardware decode is not observable.
- Indexed timeline/render interval queries, visible ruler allocation, owner-aware sorted snapping, and O(1) dirty-state comparison using history versions. The 100,000-clip interval-query test passes; complete large-project UI performance is not certified.
- Track-local ripple trim, roll, slip and slide tools with drag handles; source In/Out, target track, Insert/Overwrite, previous/next edit. Every new editing command has source-bound/history/serialization tests, UI interaction coverage, frame generation, and native encoded output coverage. Source marks themselves are temporary monitor state.
- Fixed marker removal under pointer capture, conflicting library preview/double-click behavior, and preferences accessibility labels. Erroring commands report their reason without partially committing history.

## Verification and unresolved limitations

30 TypeScript tests, six Rust tests and 12 Chromium integrations pass. Native workspace Clippy passes with warnings denied. GPU/CPU shape/effect comparisons measured 0.175–0.240 mean RGB error on a 0–255 scale; forced context loss falls back correctly. Browser tests used SwiftShader, so they establish shader correctness, not physical GPU throughput. Video cache repeat-seek and relink/undo/reopen pixel checks also pass.

Six actual H.264/AAC encodes pass: the mixed-media composition (60 frames), ripple (100), roll/slip/slide (90 each), and source insert/overwrite (102). Native waveform analysis produced 400 nonzero bins; one cold thumbnail+waveform run took 5,214 ms and its waveform cache hit took 19 ms. These timings are observations under development load, not performance guarantees.

The uncompleted requirements are itemized by phase in ROADMAP.md. Within the delivered subsystem, remaining debt includes structural commands on the UI thread, no vertical timeline virtualization, generic system font differences, overview-only waveforms, unmeasured webview decode memory, metadata-based rather than content-hash fingerprints, recovery input-size hardening, and export finalization that cannot yet be canceled. Native file dialogs/WebView2 IPC interaction, installer acceptance, long/VFR/4K stress tests and non-Windows platforms remain unverified. Do not describe this milestone as the completed professional suite.

Final build handoff: the embedded Windows executable is `bin/supp-edit-gpu.exe`, selected by the existing launcher. It was rebuilt and launched successfully with a responsive window titled `supp.edit`. The earlier executable is retained. The 16-group control audit also passes with no page errors. See docs/VALIDATION.md and the sibling verification folder for measured results.
