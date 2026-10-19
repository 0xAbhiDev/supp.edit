# AI integration contract — planned, unavailable

No model, API key, cloud call, or fake assistant is implemented. AI Studio is visibly disabled. The application works locally without account setup. These boundaries document the next implementation rather than claiming an operational provider.

Providers should implement `capabilities()`, `validateInput()`, `estimate()`, and `run(input, progress, cancellation)`. Run returns derived assets and a typed reversible project command proposal. Capabilities enumerate supported operations, model/version, locality, required hardware and input formats. Credentials are opaque native credential-store references, never frontend values or project fields.

Operation nodes should contain a UUID, operation kind, source asset IDs plus fingerprints, model/provider version, parameters, status, result asset IDs, cache key, and provenance. The first candidate is local transcription with timestamped segments and SRT/VTT export. No operation may transition to completed without verified artifacts. Failed and canceled jobs preserve originals.

Remote inference must require explicit provider selection and per-workflow disclosure of which media leaves the device. Multi-gigabyte local models require an opt-in download. Natural-language plans may only call registered editor commands; broad changes show a preview and have grouped undo. Do not expose filesystem, arbitrary JavaScript, or shell execution to a generated plan.
