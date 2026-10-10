# Gifted Brainz EduSpace Student v12.1.4 — Deep Audit Corrections

- Admin-facing student records now include subject IDs derived from the selected subject names.
- Administrator password reset revokes sessions exactly once after changing the local password hash.
- Subject rename migration also updates nested CBT/section/question-pool and 1-v-1 question subject metadata.
- Static release and service-worker version references were bumped to 12.1.4.
- Live production transactions were not executed in this environment.
