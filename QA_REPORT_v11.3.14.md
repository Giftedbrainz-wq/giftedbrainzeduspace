# Gifted Brainz v11.3.14 Final QA Report

## Concurrency and server hardening
- Production storage remains EdgeOne Pages Blob; no per-instance production fallback is enabled.
- Node request environment/client IP is isolated with AsyncLocalStorage so concurrent requests in one warm function process cannot overwrite each other's context.
- Read-heavy GET/HEAD traffic uses a 300 ms per-instance cache of the central data record; write requests bypass the cache.
- Successful saves refresh that cache immediately.
- Student CBT/practice sessions remain per-session Blob records rather than living only in browser memory.
- The existing atomic completion claims prevent duplicate one-attempt CBT submissions.
- The browser API client retries transient gateway failures only where safe, with longer timeouts for uploads.
- A `scripts/load-test.mjs` utility is included for deployment-side concurrency testing.

## Functional checks
- Student names/usernames are included in admin submission records and displayed in Recent Submissions.
- WhatsApp is required during registration, validated with country code, stored on the account, and shown as a clickable `wa.me` link to admins.
- Username/email reservations are released after student self-deletion or admin deletion.
- Passwords are hashed and are not uniqueness keys; a password can be reused after account deletion.
- Extractor editor exposes superscript/subscript controls and the server-side extractor preserves DOCX superscript/subscript and converts common caret/underscore notation into semantic markup.

## Automated verification
- EdgeOne project structure check: PASS
- Node syntax checks: PASS
- Extractor/admin/registration source checks: PASS
- ZIP/archive integrity: PASS

## Capacity note
The architecture is designed for serverless horizontal scaling, but a source-code review cannot honestly certify a guaranteed 300-concurrent-student SLA. Final capacity should be confirmed against the deployed EdgeOne project with the included load test, using realistic login/dashboard/session/submission traffic and observing p95 latency, 5xx/429 rates, Blob throttling, and function concurrency.
