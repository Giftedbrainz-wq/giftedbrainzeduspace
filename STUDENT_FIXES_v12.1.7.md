# Gifted Brainz EduSpace Student v12.1.7 — Deep Audit Corrections

- Fixed direct-upload file metadata so `parts: 0` is treated as a single stored object rather than an empty chunked file. This restores correct reading/extraction of small uploaded documents.
- Active assets and service-worker cache floor are bumped to v12.1.7.

Live production transactions were not executed in the build environment.
