2 November 2026 native revision acceptance PASSED: cafcc83 executable, Make it 20 seconds then Replace the second shot, actual preview/play/Apply, individual Undo/Redo, Save, app close/relaunch, reopen same sequence. GYM_EDIT.supp contains AI Gym Edit 02 at 600 frames with two records. Native Deliver export test-results/gym/NATIVE_REVISED.mp4: H.264/AAC, 180x320, exactly 20 seconds / 600 frames, zero entirely black decoded frames, audio RMS 0.02189297. Report: test-results/revisions/native-verification.json. This completes native revision/save/reopen acceptance; person-aware reframe is the next active work, followed by aesthetic finishing.

# Current state — native gym export and existing-sequence revisions

1 November 2026. Rough-cut baseline 6d824d4 remains accepted. Real local CPU vision/speech/audio analysis creates editable source-bound gym sequences; nested compositor, masks/mattes, blend modes and ordered effects remain intact. Schema v9 reads versions 1–9 and now optionally preserves descriptive composition revision records.

Current revision work supports in-place shortening, numbered shot replacement/removal, alternate/strongest opening, faster opening cuts, measured music alignment and semantic preference revisions. Retained IDs, masks, effects and animation survive; dependency-breaking requests reject. Real preview, Apply, exact Undo/Redo and two-revision browser save/close/reopen pass. AI Studio scroll controls pass effective laptop 100/125/150% viewport tests. Shared frontend/native asset identity accepts opaque non-UUID and Unicode IDs. See docs/REVISION_ACCEPTANCE.md and docs/IDENTITY_CONTRACT.md.

Native Windows local analysis, Apply, toolbar Undo/Redo, Save and real MP4 export have been exercised. NATIVE_UI.mp4: H.264/AAC, 180×320, 825 frames, 27.5s, no black frames, audio RMS .02191. Native revisions and final reopen verification are still underway. 106 TS tests, 29 Rust tests, workspace Clippy and production build pass.

Immediate priority: finish native revisions/save/reopen, then implement and validate smooth, editable 9:16 person reframing. Next comes the Aesthetic Gym Reel system requested in bea3514e-470d-41f4-b52a-84172e24456c: actual speed ramps, restrained editable motion, measured color/audio finishing and style profiles, then full-suite Photo/Color/Audio/tracking/roto/RAW/3D/plugins. No fake capabilities, cloud upload or automatic model downloads.

Open limits: no auto-reframe/time-remap backend yet; no physical-GPU/4K/cross-platform certification. Ten-layer 1080p SwiftShader profile still times out at 120 seconds. Distribution manifest and source ZIP still need refresh.

