# Project identity contract

Asset IDs are opaque, case-sensitive JSON strings of 1–128 UTF-16 code units, matching JavaScript string length. UUIDs are a generation convention, not a validation requirement. Existing imported/legacy IDs and Unicode IDs remain supported; identities are neither trimmed nor normalized. Empty strings, wrong JSON types and longer values are invalid. IDs must be unique within the project graph.

`packages/project-schema/identity.ts` defines the frontend contract. `supp_project::valid_id` implements the same contract in Rust using `encode_utf16()`, and is shared by project validation, media inspection and the native analysis bridge. Analysis result serialization preserves the exact ID. Regression tests include ASCII, Unicode and supplementary-plane length boundaries.

IDs are never filenames, paths or filesystem grants. Analysis incorporates them in a SHA-256 cache key. Source file access still uses the independently canonicalized, session-authorized media path. A path-looking ID is only an opaque identity and cannot authorize access to that path.
