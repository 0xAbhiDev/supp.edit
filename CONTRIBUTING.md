# Contributing

Implement vertical slices: input -> reversible command -> validated project data -> actual processing -> visible output -> serialization/reopen -> tests. A button without a processor must be disabled and explain its unavailable state.

Keep UI, schema, command, rendering, platform and native boundaries separate. Use strong types; avoid arbitrary JS evaluation, shell strings, media buffers in project state, secrets in frontend source, and implicit network operations. Every new graph field needs frontend/native validation and serialization fixtures. Schema changes require an explicit migration and unknown-version tests.

Check `npm run check`, `npm test`, `cargo test --workspace --exclude supp-desktop`, and relevant Playwright/render integration tests. Use `npm run format` and `cargo fmt --all`. Explain limitations in the UI and corresponding docs. Test failure, cancellation, missing sources and locked tracks, not only the happy path. Do not claim GPU acceleration or AI inference from a decorative interface.
