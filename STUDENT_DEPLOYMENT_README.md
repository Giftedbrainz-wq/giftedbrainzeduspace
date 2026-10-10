# Gifted Brainz EduSpace — Student-only corrected build

## This package contains only the Student platform

Student sections include Dashboard, Subjects, Learning Materials, CBT Arena, Question Bank, Gifted Brainz AI, AI conversation history, My Performance, Leaderboards, 1-v-1 Challenge, Announcements, Notifications, Feedback, Help & Support, My Account and Account Activation.

## EdgeOne deployment

Deploy the project root as an EdgeOne Pages project.
- Static output directory: `public`
- Node Functions directory: `node-functions`
- `node-functions/api/[[default]].js` handles `/api/*`.
- Do NOT deploy only the contents of `public` without the Node Functions directory.

## Required server environment
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SECRET_KEY (`sb_secret_...` or legacy service_role)
- AUTH_SECRET
- GROQ_API_KEY
- GROQ_MODEL
- GROQ_API_URL
- VAPID variables when Web Push is enabled

The Supabase Secret key is server-side only.

## Authentication changes
- New student accounts are created with `email_confirm: true`; email confirmation is not required before login.
- Student password changes from My Account are disabled. Password resets are administrator-controlled after identity verification.
