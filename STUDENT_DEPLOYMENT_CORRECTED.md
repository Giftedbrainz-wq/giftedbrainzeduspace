# Gifted Brainz EduSpace — Student-only corrected build

## Deploy exactly this project
This package contains the Student platform only. It keeps Student EduSpace pages, CBT Arena, Question Bank, Gifted Brainz AI, AI conversation history, Performance, Leaderboards, 1-v-1 Challenge, Announcements, Notifications, Feedback, Help & Support, My Account and Account Activation.

### EdgeOne Pages
- Project root: this directory
- Static output directory: `public`
- Node Functions directory: `node-functions`
- Catch-all API: `node-functions/api/[[default]].js`
- API routes used by the Student site include `/api/login`, `/api/register`, `/api/dashboard`, `/api/duel/*`, `/api/ai/*`, `/api/materials`, `/api/announcements`, `/api/notifications`, `/api/feedback`, `/api/leaderboard`, `/api/question-bank` and `/api/tests`.
- Do not deploy only `public/`; the Node Functions directory must be deployed with the project.

### Required server environment
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` (new `sb_secret_...` or legacy `service_role` key)
- `AUTH_SECRET`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `GROQ_API_URL`
- VAPID variables when Web Push is enabled

The Supabase Secret key is server-side only.

### Authentication corrections
- New accounts are created with Supabase Auth `email_confirm: true`; students can sign in immediately without mandatory email confirmation.
- Student self-service password changes are disabled.
- Password reset is administrator-controlled after identity verification.
- Authentication uses the HttpOnly `gb_session` cookie and is not dependent on browser storage.

### Routing corrections
- `public/signup.html` is supplied as a real registration page alias to prevent the previous Page Not Found error.
- Student login uses the existing `/api/login` endpoint supplied by the Student Node Function.
