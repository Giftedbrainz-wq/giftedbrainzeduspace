# Gifted Brainz EduSpace v11.9.14 — Final Deployment Notes

Deploy `public/` as the static Student site and `node-functions/` as EdgeOne Pages Node Functions.

## Required Student environment
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` (server-side only)
- `AUTH_SECRET`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `GROQ_API_URL`
- VAPID variables when Web Push is enabled

## Central storage
Run `supabase/schema.sql` first. Keep RLS enabled. Supabase Postgres (`public.gb_kv`) is the sole production application-data store. Do not deploy against an empty database when migrating an existing production installation.

## Authentication
The browser uses an HttpOnly Secure SameSite session cookie. `AUTH_SECRET` must be identical on Student and Admin server runtimes. No browser storage is an authentication authority.

## Password reset
Configure Supabase Auth recovery email delivery with sender display name exactly `Gifted Brainz EduSpace` and allow `/reset.html` as a recovery redirect.

## Service worker / API
The service worker does not cache `/api/*` responses. API responses are server-authoritative and use `no-store`.

## Final pre-cutover validation
1. Run `node scripts/final-audit.mjs`.
2. Run `node scripts/final-qa.mjs`.
3. Run `node scripts/verify-edgeone.mjs`.
4. Confirm the deployed `/api/status` reports `supabase-postgres` as the persistent source of truth.
5. Complete real Supabase Auth, email, AI and Web Push smoke tests in the production environment.
