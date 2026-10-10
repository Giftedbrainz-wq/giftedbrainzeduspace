QA — Gifted Brainz v11.3.10

Change verified:
- Question-bank practice selection groups questions by passageId (single questions remain individual groups).
- Complete linked groups are selected atomically and presented contiguously.
- makePresentedSession is called without question shuffling for question-bank practice so group order is preserved while option shuffling remains enabled.
- Shared passage/image fields continue to travel with each question.
- Existing CBT/question-bank submission paths still use the session item IDs and optionOrder, so scoring remains unchanged.

Static checks:
- node --check node-functions/lib/api-core.js: PASS
- EdgeOne deployment structure verification: PASS
- node_modules excluded from release archive.
