# Gifted Brainz EduSpace — Final Release QA v11.9.12

Release: 11.9.12
Date: 2026-09-19

## Release scope
Final Student and Admin portal source after central-storage, authentication, authorization, activation, password-reset, notification, upload/download, Markdown/LaTeX, and UI/runtime hardening.

## Verified
- JavaScript syntax across all release JS files.
- Student project final audit and final QA.
- Student EdgeOne structure/deployment check.
- Admin EdgeOne structure/deployment check.
- Clean `npm ci --ignore-scripts --offline` on release copies.
- `npm audit --omit=dev --offline`: 0 vulnerabilities for Student and Admin.
- No production `localStorage`/`sessionStorage` authentication authority.
- No service-role or application auth secret exposed in public browser files.
- No legacy filesystem/memory/EdgeOne Blob production data adapter references.
- Supabase `public.gb_kv` remains the central application-data store with RLS enabled and browser roles revoked.
- Admin proxy token contains issuer, audience, identity, role and permissions and is checked server-side.
- Student sessions are server-side records referenced by an HttpOnly Secure SameSite cookie.
- Server-side activation restrictions and restricted-file authorization.
- Admin-specific notification routes and persistent read/unread state.
- Bounded retry behavior; deterministic 503 database responses are not treated as gateway retries.
- Registration central reservation failure propagation and atomic `onlyIfNew` REST semantics.
- Concurrent registration race test: one claimant succeeds and the competing claimant is rejected.
- Student registration -> verification-required -> verified login -> session persistence in a fake-Supabase integration harness.
- Student attempt to access an Admin endpoint rejected server-side.
- Admin login -> session refresh -> shared-backend health -> proxied Admin read in a fake-Supabase integration harness.
- Central database outage maps to the required database message.
- Password-reset page is recovery-session based and does not require the normal student session.
- Math pipeline source preserves LaTeX delimiters/meaning, supports AMS/math constructs, and provides readable fallback/copy conversion without raw control sequences in fallback text.
- Admin `mathToPlainText` runtime definition restored; both Student/Admin shared UI modules pass syntax checks.
- Media sanitizer allow-list includes figure/figcaption and authenticated file URLs are restricted to `/api/files/`.
- Local HTML `href`/`src` reference sweep: no broken local references.

## Important implementation fixes in this release
1. Admin shared-backend authentication contract fixed (issuer/audience/subject/role/permission claims).
2. Supabase PostgREST conditional inserts corrected to use `on_conflict=key` with `resolution=ignore-duplicates`.
3. Core storage read/confirm failures no longer collapse into null/empty reads, preventing silent data-loss behavior.
4. Registration uniqueness reservation no longer swallows central-store errors.
5. Password reset no longer silently reports success when post-reset central profile/session synchronization fails.
6. Student page authentication guard distinguishes central database 503 from expired sessions.
7. Admin notification centre no longer calls Student-only push/notification endpoints.
8. Admin fallback math renderer now has its plain-text converter implementation.
9. Markdown punctuation unescaping now occurs only outside recognized math delimiters, preserving LaTeX meaning.
10. Legacy production Blob/filesystem fallback code removed from the runtime; deployment documentation updated accordingly.

## External live-verification limitations
A real production Supabase project, SMTP provider, Groq API credential, VAPID keys/device, and deployed EdgeOne environment are required to verify live email delivery, AI responses, Web Push delivery, production RLS, and the live central database. The execution environment could not resolve `cdn.jsdelivr.net`, so live CDN delivery of MathJax 3 could not be independently tested here. The application retains a controlled MathJax failure fallback rather than exposing raw TeX.

The final ZIPs contain source/deployment files only and exclude `node_modules` and temporary QA harness files.
