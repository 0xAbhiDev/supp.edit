# Current state — editable portrait acceptance complete

2 November 2026. Continue this repository and working tree. Latest brief: `aadd39d0-2959-4f92-9a49-853a0be8ae1c/Pasted text.txt`.

The bounded gym workflow has passed native Windows acceptance:

- AI rough cut: COMPLETE for the supported local source-selection/onset-alignment workflow.
- AI revisions: COMPLETE for the implemented guarded existing-sequence requests.
- 9:16 AI auto-reframe and editable framing: COMPLETE for the supported video-shot layout.
- Preview, Apply, Undo/Redo, full app close/reopen, exact framing persistence and native 1080×1920 export: COMPLETE.

The last native test sampled seven shots locally, applied a separate portrait copy, undid/redid it, then manually changed the first Position X key from 189.08830378666667 to 249.088 in the ordinary Inspector. The preview visibly shifted. Save, complete app exit, relaunch, reopen and resave preserved every composition, transform and keyframe exactly. `test-results/reframe/NATIVE_MANUAL.mp4` is H.264/AAC, 1080×1920, 20 seconds, 600 decoded frames, no entirely black frames, audio RMS 0.02189297. Its first-frame error against the edited compositor reference is 1.534/255 versus 19.650/255 against the unedited reference. See `docs/REFRAME_ACCEPTANCE.md` and `test-results/reframe/native-manual-verification.json`.

Local dense YOLOX sampling, source-fingerprinted caching, conservative association, uncertainty holds, safe margins, smoothing/dead zone, Locked/Smooth/Responsive modes and reduced ordinary x/y/scale keys are implemented. Default landscape conversion duplicates the sequence with remapped internal IDs. Wide subjects/groups may retain letterboxing. Unsafe parent/matte/crop/rotation dependencies and unplanned overlay resizing reject. White-shirt requests use a disclosed bright-neutral torso pixel heuristic, not identity recognition. Fast ambiguous displacement holds position; this is not general re-identification.

Validation: 122 TypeScript tests passed across the full run plus an isolated rerun of the 100,000-clip performance test (the parallel run timed out under simultaneous native inference/build load). Sixteen focused framing tests include actual gym inference and controlled translated/duplicated/occluded/edge footage, plus low confidence, stationary, rapid displacement and nonfinite inputs. Browser Preview/Apply/Undo/Redo/manual Inspector edit/save/close/reopen passes. Native media tests, workspace Clippy, production frontend and embedded Windows build pass. Native thumbnail/relink paths now accept the same opaque asset IDs as project/analysis.

Active next milestone: Aesthetic Gym Reel Editing. Add actual style decisions, hook/music-structure ranking, editable time remapping, restrained zooms, measured shot color matching/looks, grain/vignette/sharpen, captions and audio finishing, integrated preview and existing-sequence revisions. The exact 25-second aesthetic prompt is NOT complete yet. Do not expose unsupported controls or claim fake exercise-phase recognition.

Existing compositor, nested compositions, masks/mattes, blend modes, effect stacks and normal command/history boundary remain intact. No cloud upload or automatic model download. Known limits: natural independent two-person footage/identity crossings, physical-GPU/4K/cross-platform certification remain open; controlled two-person stress footage duplicates a licensed source. Ten-layer 1080p SwiftShader stress still times out at 120 seconds. Distribution manifest/source ZIP need an accurate refresh.
