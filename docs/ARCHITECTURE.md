# Architecture

The production direction is native media/GPU processing with a reusable UI. The current implementation retains its shared project graph and adds WebGL2 compositing, bounded media caches, native hardware probes, background derived-media analysis, and source-aware editing commands.

| Boundary           | Current implementation                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| UI                 | `apps/desktop`, React controls, workspace views, keyboard commands                       |
| Project graph      | `packages/project-schema`, Zod validation; `supp-project`, independent native validation |
| Reversible editing | `packages/commands`, Immer structural patches; no binary media in history                |
| Editor state       | `packages/editor-state`, Zustand; playback clock is an independent external store        |
| Compositor         | `packages/engine`, WebGL2 shaders, Canvas2D fallback, bounded media/frame/texture LRUs   |
| Platform adapter   | `packages/platform`, typed Tauri IPC or IndexedDB/browser file handling                  |
| Persistence        | `supp-project`, atomic temporary-file replacement and previous-save backup               |
| Media              | `supp-media`, scoped local paths and FFprobe/FFmpeg subprocesses                         |
| Export             | `supp-export`, owned encoder lifecycle, frame validation, audio mix, atomic completion   |
| Desktop shell      | `src-tauri`, file dialogs, session grants, recovery, IPC orchestration                   |

UI -> reversible command -> immutable graph -> preview and project serialization. Export freezes a validated snapshot and uses the same visual processors. Asset bytes are external, addressed by IDs; video/image/audio/text/shape clips share transform, timing, masking, effect, and animation properties.

Timeline playhead movement does not update the graph or rerender every clip through React. A separate clock updates the playhead element and requests compositor work. Only the latest pending preview request is retained. Offline export awaits every source seek and frame. Playback is clock-based and can skip visual frames when slow; this is documented, not presented as a professional decoder pipeline.

Immutable clip arrays have interval indices shared by the renderer and timeline. Viewports query overlapping clips; ruler tick allocation is restricted to the visible interval. Snapping uses sorted owner-tagged boundaries. Dirty state uses history revision tokens, including undo/redo and an asynchronous save of an older snapshot. Commands still run on the UI thread and large structural edits are not performance-certified. Vertical virtualization and an audio master clock remain future work.

Ripple trim, roll, slip, slide, insert and overwrite operate on existing timing/source fields, so schema v1 and the native audio exporter need no duplicate edit implementation. Ripple and source insertion target one track; there is no cross-track sync-lock system. Drag previews evaluate a local edit neighborhood, then commit one reversible command on release. Roll/slide reject ambiguous overlaps. Source marks are monitor state; the resulting source range is persisted on clips. Tests drive controls, save/reopen, render every output frame and pass those frames to the native encoder.

FFmpeg runs without a shell, with fixed argument arrays. Long native jobs run on Tauri's blocking pool. Frontend IPC offers task-specific commands, never arbitrary command execution. A native session grants asset-protocol access only after file import or explicit project opening. Files are canonicalized, restricted to supported media extensions, and checked before encoding. Remote protocols are excluded from media inspection and audio inputs. The browser has no raw filesystem permission.

## Extension decisions

Future render processors should implement a typed render graph independent of workspace layout. A native wgpu renderer can replace the Canvas2D backend while preserving the graph and export job contract. Schema v3 now implements nested composition sources, a bounded dependency DAG and cycle validation. See ../RENDER_ENGINE.md. Add native audio time as the authoritative playback clock when implementing sample-accurate sync. Add proxy assets as derived resources with original-source provenance.

AI operation nodes and plugins must produce validated reversible commands and derived assets. Do not add network access to a UI component to bypass these boundaries. Credentials belong in the OS credential store. AI contracts and the LOCAL SRT caption executor are implemented in packages/ai; other AI runtimes and the plugin runtime remain deferred. The shared packages/jobs queue serves captions and MP4 export. See ../AI_ARCHITECTURE.md.
