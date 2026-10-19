# Architecture

The production direction is native media/GPU processing with a reusable UI. This implementation establishes a functional CPU baseline and a shared project graph. It deliberately does not add empty crates for every future subsystem.

| Boundary           | Current implementation                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| UI                 | `apps/desktop`, React controls, workspace views, keyboard commands                       |
| Project graph      | `packages/project-schema`, Zod validation; `supp-project`, independent native validation |
| Reversible editing | `packages/commands`, Immer structural patches; no binary media in history                |
| Editor state       | `packages/editor-state`, Zustand; playback clock is an independent external store        |
| Compositor         | `packages/engine`, Canvas2D and a bounded media-element pool                             |
| Platform adapter   | `packages/platform`, typed Tauri IPC or IndexedDB/browser file handling                  |
| Persistence        | `supp-project`, atomic temporary-file replacement and previous-save backup               |
| Media              | `supp-media`, scoped local paths and FFprobe/FFmpeg subprocesses                         |
| Export             | `supp-export`, owned encoder lifecycle, frame validation, audio mix, atomic completion   |
| Desktop shell      | `src-tauri`, file dialogs, session grants, recovery, IPC orchestration                   |

UI -> reversible command -> immutable graph -> preview and project serialization. Export freezes a validated snapshot and uses the same visual processors. Asset bytes are external, addressed by IDs; video/image/audio/text/shape clips share transform, timing, masking, effect, and animation properties.

Timeline playhead movement does not update the graph or rerender every clip through React. A separate clock updates the playhead element and requests compositor work. Only the latest pending preview request is retained. Offline export awaits every source seek and frame. Playback is clock-based and can skip visual frames when slow; this is documented, not presented as a professional decoder pipeline.

FFmpeg runs without a shell, with fixed argument arrays. Long native jobs run on Tauri's blocking pool. Frontend IPC offers task-specific commands, never arbitrary command execution. A native session grants asset-protocol access only after file import or explicit project opening. Files are canonicalized, restricted to supported media extensions, and checked before encoding. Remote protocols are excluded from media inspection and audio inputs. The browser has no raw filesystem permission.

## Extension decisions

Future render processors should implement a typed render graph independent of workspace layout. A native wgpu renderer can replace the Canvas2D backend while preserving the graph and export job contract. Introduce nested compositions with a schema migration, a dependency DAG and cycle validation, rather than overloading asset paths. Add native audio time as the authoritative playback clock when implementing sample-accurate sync. Add proxy assets as derived resources with original-source provenance.

AI operation nodes and plugins must produce validated reversible commands and derived assets. Do not add network access to a UI component to bypass these boundaries. Credentials belong in the OS credential store. The proposed contracts in AI_ARCHITECTURE.md and PLUGIN_API.md are designs, not implemented runtimes.
