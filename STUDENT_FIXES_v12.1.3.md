# Gifted Brainz EduSpace Student v12.1.3 — Deep Audit Corrections

- Fixed MathJax failure handling so Unicode fallback is temporary rather than permanently disabling later rendering attempts.
- Coalesced in-flight subject-catalog requests and made CBT routing wait for the catalog before rendering subject-dependent views.
- Removed the 5-second materials polling loop; focus and visibility events remain for refresh.
- Bumped release/service-worker version to invalidate older cached Student assets.
- Retained Student/Admin separation and shared Admin backend compatibility routes.

Live EdgeOne/Supabase/GROQ production transactions were not executed in this environment. Validation covers static analysis, local integration tests, and package integrity.
