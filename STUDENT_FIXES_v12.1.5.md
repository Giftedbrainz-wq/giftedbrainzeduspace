# Gifted Brainz EduSpace Student v12.1.5 — Deep Audit Corrections

- Catalog normalisation now restores missing core subjects even when a legacy/custom subject array already exists.
- Duplicate subject names are collapsed case-insensitively during normalisation so registration and dropdowns cannot become ambiguous.
- CBT submission now rejects a broken/mutated session rather than silently scoring a shortened question list.
- Shared Admin-backend diagnostics now references Student v12.1.4, matching the deployed Student line immediately before this patch.
- Active assets and service-worker cache floor are bumped to v12.1.5.

Live production transactions were not executed in the build environment.
