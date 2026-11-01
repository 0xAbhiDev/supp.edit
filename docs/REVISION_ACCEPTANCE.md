2 November 2026 native revision acceptance PASSED: cafcc83 executable, Make it 20 seconds then Replace the second shot, actual preview/play/Apply, individual Undo/Redo, Save, app close/relaunch, reopen same sequence. GYM_EDIT.supp contains AI Gym Edit 02 at 600 frames with two records. Native Deliver export test-results/gym/NATIVE_REVISED.mp4: H.264/AAC, 180x320, exactly 20 seconds / 600 frames, zero entirely black decoded frames, audio RMS 0.02189297. Report: test-results/revisions/native-verification.json. This completes native revision/save/reopen acceptance; person-aware reframe is the next active work, followed by aesthetic finishing.

# Existing-sequence revisions

The revision path uses the current composition and existing layer IDs. It does not call the rough-cut builder. A strict `sequence.revise` changeset contains named range/source patches, explicit removals, marker movements and a descriptive revision record. The shared command registry validates source fingerprints, handles, locks and references. Preview uses detached history; Apply is one normal history transaction guarded against stale project snapshots.

Supported requests include shorter/exact shorter duration, numbered first–fourth shot replacement/removal, another opening, highest-ranked current shot first, faster opening cuts, measured-onset cut tightening/ending sync, more visually similar footage, less bench-like footage, and caption removal. Similarity is not a verified exercise identity. Requests with no suitable alternative or already-aligned cuts produce a clear no-change explanation.

Retained layers keep masks, effect stacks, scalar animation and parent/matte references. Contained overlays move with their shot; spanning/detached overlays and locked tracks reject the revision. Replacing footage under existing text rejects rather than leaving unrelated captions. Source analysis is fingerprint/settings/version cached; simple range revisions run without inference. Descriptive revision history (last 100 entries) survives save/reopen; executable Undo history remains session-local.

AI Studio shows the request, per-layer planned changes, retained property groups, real compositor playback and seek, Apply, Undo and Cancel. A revision cannot directly mutate the editor store. “Undo that revision” only undoes the latest AI revision, protecting intervening manual history.

Validation on 1 November 2026:

- 106 TypeScript tests pass, including six revision tests and the ID contract regression. Exact Undo/Redo, effects/masks/keys, stable IDs, stale previews, locks, parent dependencies and serialization are covered.
- 29 Rust tests pass (19 project, 8 media, 2 export). Native persistence round-trips two revision records. Workspace Clippy passes with warnings denied.
- Real-media browser workflow passes: create, preview/apply two revisions (20 seconds and replace second shot), exact Undo/Redo for each, save, close, reopen, unchanged IDs and two persisted records.
- AI Studio wheel scrolling and reachability pass at effective 1366×768 laptop viewports divided by 100%, 125% and 150% scale. These are browser viewport-equivalence tests, not certification of every Windows DPI configuration.
- Native rebuilt Windows app completed local analysis, displayed/applied seven-shot 27.5-second AI Gym Edit 02, and exported `test-results/gym/NATIVE_UI.mp4`. FFprobe confirms H.264/AAC, 180×320, 825 frames, 27.5 seconds. All decoded frames have nonblack content; mono decoded audio RMS is 0.02191. Native toolbar Undo/Redo and Save were exercised. Full native revision/reopen acceptance is still in progress; vertical auto-reframe is not yet implemented.

Next: finish the native revision/save/reopen workflow, then person-box association, safe margins, dead zone, smoothing and reduced editable x/y/scale keys; validate portrait export before aesthetic finishing work.

