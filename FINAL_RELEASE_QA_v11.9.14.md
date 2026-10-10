# Gifted Brainz EduSpace Student — Final Release QA v11.9.14

## Release fixes
- Exported `GBUI.mySubjects` from the shared Student UI module.
- Student subject-based pages now receive a real iterable subject list.
- AI responses always pass through the Markdown/LaTeX renderer; raw-text streaming bypass removed.
- AI server response normalization collapses duplicated TeX delimiters/commands and escaped numbered-list punctuation without stripping mathematical meaning.
- Client LaTeX normalization handles doubled opening/closing delimiters and common escaped punctuation.
- Mathematical fallback resolves nested square roots and fractions inside-out, preserving readable meaning.
- MathJax 3 CHTML component and required font assets are bundled locally; no runtime dependency on cdn.jsdelivr.net remains for mathematical rendering.
- AI history reopening explicitly triggers math typesetting.

## Verification
- JavaScript syntax: PASS
- Student project audit (`npm run audit`): PASS
- EdgeOne verification (`npm run verify`): PASS
- npm dependency audit: 0 vulnerabilities
- `GBUI.mySubjects()` export and return semantics: PASS
- Exact reported AI quadratic response normalization: PASS
- Escaped numbered-list rendering: PASS
- Nested `\\frac` + `\\sqrt` readable fallback: PASS
- Server Tutor response normalization: PASS
- Local MathJax payload and 23 CHTML font assets: PASS
- No active `cdn.jsdelivr.net/npm/mathjax@3` reference: PASS
- MathJax bundled under Apache-2.0 LICENSE.txt: PASS

## External/live verification limitation
A live production browser/device could not be exercised in this environment because Chromium navigation is blocked by the execution environment. Production AI, SMTP, Supabase, and Web Push behavior still depends on deployed service configuration and credentials.
