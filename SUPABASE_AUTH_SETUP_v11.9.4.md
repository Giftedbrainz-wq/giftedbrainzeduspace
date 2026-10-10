# Gifted Brainz EduSpace — Supabase Setup (final release v11.9.13)

## 1. Create the Supabase project
Create/open the Supabase project for Gifted Brainz EduSpace.

## 2. Enable Email/Password Auth
In Supabase: Authentication -> Providers -> Email. Enable Email/Password.

## 3. Run the application schema
Open SQL Editor and run the complete file:

`supabase/schema.sql`

This creates `public.gb_kv`, the server-side application data store used by the Student API. Browser roles have no access.

## 4. Existing production data
Do **not** deploy the final Student build against an empty Supabase database when an older production store contains live application data. Before cutover, perform a reviewed, server-side migration/export of the existing application records into `public.gb_kv` and verify counts and representative records.

The v11.9.13 release intentionally does not ship a legacy EdgeOne Blob runtime adapter or migration script. This keeps the production runtime single-source and prevents an accidental second data store from becoming authoritative.

## 5. Student EdgeOne environment
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (Supabase Publishable key)
- `SUPABASE_SECRET_KEY` (Supabase Secret key; server only)
- `AUTH_SECRET` (new high-entropy secret)
- `GROQ_API_KEY`
- `GROQ_MODEL=openai/gpt-oss-120b`
- `GROQ_API_URL=https://api.groq.com/openai/v1/chat/completions`

## 6. Password reset and verification email
Configure Supabase Auth email delivery and set the sender display name exactly:

`Gifted Brainz EduSpace`

Allow the Student site's `/reset.html` recovery URL in the Supabase Auth redirect configuration.

## 7. Production behavior
The Student API fails closed if Supabase Postgres is not configured or the `gb_kv` schema is unavailable. It will not silently create or select a second application-data store.
