# Plugin boundary — planned, unavailable

This release does not load or execute third-party plugins. There is no plugin sandbox or SDK runtime to advertise yet.

Proposed manifest: plugin ID, publisher, version, API version, entry point, declared capabilities, requested permissions, and integrity/signature data. Future effect processors should consume typed frame/audio buffers with declared pixel/sample formats and bounded memory. Workflow plugins propose validated project commands. AI providers follow AI_ARCHITECTURE.md. Custom panels get restricted message APIs rather than raw native IPC.

Before enabling plugins: define an isolated execution model (prefer WASM for bounded processors), deterministic cancellation and resource budgets, permission approval/revocation, compatibility negotiation, fault isolation, signature verification and tests proving a plugin cannot read arbitrary user files or call native shell commands. A local project file must never cause plugin code to execute just by opening it.
