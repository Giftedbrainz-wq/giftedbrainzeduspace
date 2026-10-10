# Gifted Brainz EduSpace v11.9.12 — Final Engineering QA

## Source baseline
Built from the uploaded v11.9.9 Student and Admin ZIPs. This release contains targeted second-pass corrections after the first v11.9.9 audit.

## Implemented and rechecked
- Central Supabase Postgres (`public.gb_kv`) remains the single authoritative application-data store; localStorage/sessionStorage are not authentication authorities.
- Student sessions use an HttpOnly Secure SameSite=Lax cookie and server-side session records.
- Admin sessions use an HttpOnly Secure SameSite=Lax cookie and server-side signing secret. Admin role is verified in the shared Student API.
- Storage failures are surfaced as central-database failures instead of being silently converted into authentication failures.
- A linked Supabase student account can no longer authenticate with a wrong password because an old `authUserId` is present.
- Successful password changes revoke the existing EduSpace session token version and require the new password for subsequent login.
- Account activation remains centrally stored and server enforced at ₦3,000.
- CBT/material publishing creates centrally stored notifications and Web Push attempts without duplicate publish events.
- MathJax 3 renders authored LaTeX in CBT, explanations, review screens, previews and AI responses.
- AI conversation history is server-stored and filtered by authenticated student id.
- Global UI typography uses Source Serif 4 with Georgia/Times New Roman fallbacks in Student and Admin portals.
- Admin overview metrics are sourced from central data, and the “active” fallback count now consistently uses account status rather than activation state.
- Password recovery handles recovery query/hash parameters and validates the Supabase recovery session before updating the password.
- Service-worker push handling, notification click routing and in-app notification read state are retained.

## Automated checks
- Student source syntax audit: PASS.
- Admin EdgeOne structure audit: PASS.
- JavaScript syntax check across both projects: PASS.
- Authentication storage scan: PASS; no auth token/session authority in localStorage/sessionStorage.
- Shared-admin health/role invariant: PASS.
- Student stateful authentication regression: PASS — initial login 200; session 200; wrong current password 401; password change 200; old password 401; new password 200; old session 401; new session 200.
- ZIP archive integrity: verified with `unzip -t`.

## Deployment requirements
Production still requires the real server environment values and deployed services: Supabase URL/keys, identical Student/Admin `AUTH_SECRET`, Admin credentials, `GB_STUDENT_API_URL`, Supabase Auth recovery email delivery with sender display name exactly `Gifted Brainz EduSpace`, and VAPID configuration for push. These values are intentionally not embedded in the ZIP.
