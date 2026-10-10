# Gifted Brainz EduSpace Student v12.1.6 — Deep Audit Corrections

- Core-subject normalisation now reactivates the compulsory Use of English record if malformed legacy data marked it archived.
- Subject-catalog migrations are persisted on the first read after repair, so missing/duplicate subject metadata is not repeatedly reconstructed in memory.
- Removed a duplicate internal storage error assignment.
- Active assets and service-worker cache floor are bumped to v12.1.6.

Live production transactions were not executed in the build environment.
