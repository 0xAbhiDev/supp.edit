# Implementation status — 25 October 2026

The existing repository, main sequence and animation tools are retained. Schema v3 adds nested sources and transcripts. COMPLETE below means the stated slice has command/history, persistence, rendering and tests where applicable; the broader suite is unfinished.

| Subsystem              | Status and delivered scope                                                                                              | Remaining                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GPU/media              | COMPLETE earlier slice: WebGL2, Canvas fallback, bounded caches, native analysis/probes                                 | Native decode/texture sharing, audio master clock, proxies, physical GPU and sustained-load certification |
| NLE                    | PARTIAL: move/trim/split/ripple/roll/slip/slide/insert/overwrite, source In/Out, locks                                  | Linked editing, sync lock, speed/remap, full trim and range tools                                         |
| Animation              | COMPLETE numeric slice: 17 channels, eight interpolation modes, editable value/speed graphs, shared render/export       | Path/spatial animation, marquee selection, large-curve performance                                        |
| Compositions           | COMPLETE nesting slice: definitions, instances/precompose, mixed-rate DAG, scoped edits, save/reopen/render/export      | PARTIAL layer panel; full layer timeline, parenting/Null controllers, canvas handles                      |
| Masks/mattes/blends    | PARTIAL: rectangle/ellipse masks and normal source-over                                                                 | Bezier paths, feather/expansion/opacity, alpha/luma mattes, 17 blends                                     |
| Effects/adjustments    | PARTIAL: animated blur/brightness/contrast/saturation                                                                   | Ordered stacks, expanded effects, curves, presets/search and adjustment layers                            |
| Photo/color            | NOT STARTED independent engine; basic shared color controls exist                                                       | Raster documents, groups, selections, brushes, fills, layer masks, adjustments and color management       |
| Audio/transitions      | PARTIAL: source gain/mute/solo and recursive trimmed/delayed native mix                                                 | Sample-accurate transport, envelopes, buses, meters/effects and transition engine                         |
| Jobs/export            | COMPLETE session queue foundation: real caption/MP4 jobs, progress/cancel, cooperative caption pause                    | Persistent jobs/retry, finalization cancellation, broad export formats/hardware selection                 |
| AI Studio              | COMPLETE foundation: provider/model/operation/context/privacy contracts and actual SRT captions with preview/Apply/Undo | Inference, external transport, secure OS credential implementation and explicit model install             |
| Proxies/RAW/3D/plugins | NOT STARTED runtime; some design documents exist                                                                        | Derived proxy pipeline, LibRaw, cameras/lights, safe extension host                                       |
| UX/release             | PARTIAL: resizable panels, themes, shortcuts, unsigned Windows embedded build                                           | Docking, accessibility/scale audit, installers/signing, macOS/Linux and long/VFR/4K/corrupt-media matrix  |

Exact next subsystem: parenting plus Null controllers with affine transforms and cycle prevention, alongside the composition layer timeline. Continue masks/mattes/blends and ordered effects before Photo. Large AI features remain deferred.

Verification: 54 TypeScript tests, 10 Rust tests, 18 browser integration cases, nested real-footage parity/reopen/native encoding. See VALIDATION.md and ../CURRENT_STATE.md for measurements and limits.
