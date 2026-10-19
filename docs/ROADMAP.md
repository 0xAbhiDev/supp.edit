# Implementation status and next milestones

The brief is retained as the product direction. This release is an early vertical slice, not completion of all 111 sections.

| Stage                 | Implemented                                                                   | Remaining before professional release                                                                             |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Foundation            | Tauri/Rust workspace, React/TS UI, design tokens, local adapter               | signed cross-platform CI/release, diagnostics bundle, configurable accessibility scale                            |
| Project/media         | schema v1, native atomic saves/backups/recovery, import/probe/preview/relink  | recent-project browser, bins/tags, folder ingest, hashing, robust cache budgets                                   |
| Editing               | multitrack media, split/trim/move, snap, markers, locks/mute/solo, patch undo | insert/overwrite/ripple tools across tracks, roll/slip/slide, nesting, multicam, proxies, native decode scheduler |
| Visual composition    | transforms, title/shape, four animated properties, simple masks, four effects | GPU graph, editable/reorderable effect stacks, arbitrary masks, blend modes, curves, track mattes                 |
| Output                | real H.264/AAC MP4, source audio mix, PNG, progress/cancel                    | persistent queue, pause/retry, codec presets, hardware encode, alpha/HDR outputs                                  |
| Photo / color / audio | shared layer graph and basic adjustments                                      | painting, selections, RAW, OCIO, scopes, audio buses/effects/sample clock                                         |
| AI                    | documented provider/operation boundaries; unavailable UI                      | local transcription first, provider execution, consent, secure credentials, verified results                      |
| Advanced              | architectural boundaries documented                                           | tracking/roto, stabilization, 3D, particles, plugins, collaboration                                               |

The next cycle should replace preview's clock/seeking baseline with native asynchronous decode and an audio master clock, add a proxy path for unsupported source codecs, and establish GPU/CPU render parity tests. Do not expand the button count before completing these engine foundations.
