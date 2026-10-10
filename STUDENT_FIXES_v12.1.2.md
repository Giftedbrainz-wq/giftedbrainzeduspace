# Gifted Brainz EduSpace Student v12.1.2 — Restoration & Fixes

SOURCE OF TRUTH
- Student-only package.
- Based on the supplied Student v12.1.2-CORRECTED package/worktree.
- Admin Console and 1-v-1 Arena are NOT bundled into this Student package.

FIXES IN THIS RELEASE
1. EdgeOne deployment/routing
   - No SPA catch-all rewrite that swallows direct .html pages or /api routes.
   - Keeps the /api bare route plus the catch-all API function.
   - Deployment verification checks the Student pages and Node Function entry point.
2. Gifted Brainz AI mathematics
   - Delimited LaTeX is rendered with MathJax.
   - Bare TeX commands returned without delimiters are converted to readable Unicode maths rather than exposed as raw source.
   - AI conversation history uses the same safe rendering path.
3. 1-v-1 Challenge performance
   - Polling reduced to 1 second.
   - Answers render optimistically before the server round-trip completes.
   - Student API retries/backoff and timeouts tightened for faster recovery.
4. CBT launch
   - Every CBT now opens a branded pre-start assessment page with the Gifted Brainz icon, CBT title, assessment details and a glowing gold Start Assessment button.
5. WhatsApp channel placement
   - The channel-follow banner is no longer injected throughout the EduSpace.
   - The banner remains on login, signup and registration only.
6. Leaderboard names
   - Leaderboards use the real student name, then username/email as a safe fallback.
7. Subject catalog
   - Student API normalises dynamic subjects and returns subject objects/icons.
   - Subject/collection data is persisted in the central Student store.
   - Registration subject selectors can use the current catalog.
8. Supabase Secret key
   - sb_secret_... keys are sent with apikey only; legacy service_role JWTs remain supported with Authorization.
9. Existing EduSpace features preserved
   - Dashboard, Subjects/Collections, Learning Materials, CBT/Assessment Hub, Results/Performance, Leaderboards, Gifted Brainz AI, AI History, 1-v-1 Challenge, Announcements, Notifications, Feedback, Help, My Account, Activation and authentication pages remain present.

DEPLOYMENT
- Deploy the package root, not only public/.
- Keep node-functions/ at the project root.
- Configure SUPABASE_URL and SUPABASE_SECRET_KEY on the Student server function.
- Do not expose the secret key in browser code.
