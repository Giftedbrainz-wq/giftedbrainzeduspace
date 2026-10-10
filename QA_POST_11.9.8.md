# Gifted Brainz EduSpace v11.9.8 — Post-ZIP QA

Implemented/verified: central Supabase-only application data storage; no local/per-instance storage demotion after Supabase failure; Admin identity from HttpOnly session; live Admin Overview metrics; honest partial-failure reporting; AI academic serif typography; Markdown rendering; robust double-escaped LaTeX normalisation; password reset page/session handling; version/cache-busting consistency.

External configuration still required at deployment: Student SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY, AUTH_SECRET, GROQ_*; Admin ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL, AUTH_SECRET (same value as Student), GB_STUDENT_API_URL, GROQ_*. Supabase Auth SMTP sender display name must be configured as `Gifted Brainz` in the Auth email/SMTP settings.

No application-data cache is used as a fallback for announcements/materials; authentication identity is session-derived.
