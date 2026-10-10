# Gifted Brainz EduSpace Student v12.1.8

This release is a deep QA correction build following v12.1.7.

- Fixed single-object upload reads where `parts: 0` could be misinterpreted as a chunked upload, breaking small uploaded-document imports.
- Hardened direct upload signing and completion to 700 KB; larger files continue through the chunked uploader.
- Prevented content-pack upgrades from replacing administrator-created CBTs and question-bank records; bundled records are now upserted by ID.
- Preserved collection subject labels when an administrator renames a subject.
- Retained all earlier v12.1.x authentication, shared Admin/Student routes, dynamic subjects, CBT launch screen, AI math fallback, duel responsiveness, leaderboard-name, and routing fixes.

Static validation and mock end-to-end integration checks were run against the packaged source. Production EdgeOne/Supabase services were not directly exercised in this environment.
