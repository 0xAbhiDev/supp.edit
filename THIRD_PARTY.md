# Third-party components and distribution notes

The application uses original source code and UI styling. It does not include Adobe code, branding, assets, fonts, or proprietary project formats. Typography uses system generic families. Lucide provides open-source icons; the supp.edit mark is an original SVG.

| Component                                    | License / notes                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| React, Vite, TypeScript, Zustand, Immer, Zod | MIT                                                                                                                         |
| Lucide                                       | ISC                                                                                                                         |
| Tauri                                        | MIT OR Apache-2.0                                                                                                           |
| serde, serde_json, tempfile, uuid            | MIT OR Apache-2.0 (see resolved crate manifests)                                                                            |
| thiserror                                    | MIT OR Apache-2.0                                                                                                           |
| rfd                                          | MIT                                                                                                                         |
| Playwright                                   | Apache-2.0; test tooling only                                                                                               |
| FFmpeg                                       | LGPL/GPL depending on configuration and linked components; not bundled                                                      |
| libx264                                      | GPL / commercial licensing; used only from the user's external FFmpeg                                                       |
| Gyan FFmpeg essentials build                 | GPLv3 external Windows tools, downloaded only by explicit local setup; not included in source ZIP or application executable |

`setup:media` is an explicit local developer convenience and downloads external binaries from the [Gyan Windows provider](https://www.gyan.dev/ffmpeg/builds/) linked by [FFmpeg](https://ffmpeg.org/download.html), checking its published SHA-256. It is not a license grant for commercial redistribution. The supplied application executable does not embed FFmpeg, codec binaries, AI models or fonts. Patent and codec licensing vary by deployment. Review the precise FFmpeg configuration, corresponding-source obligations and codec distribution rights before packaging a professional release. No conclusion about legal clearance is implied by this engineering inventory.

Package-lock.json and Cargo.lock pin the resolved dependency graph. Dependency audit results for this build are recorded in docs/VALIDATION.md. A production release still needs a full transitive license audit, vulnerability triage, platform signing and an SBOM. Refer to [FFmpeg's licensing page](https://ffmpeg.org/legal.html) and [FFprobe documentation](https://ffmpeg.org/ffprobe.html) for the media integration.
