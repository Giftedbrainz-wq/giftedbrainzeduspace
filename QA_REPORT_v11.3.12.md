# QA Report — v11.3.12

## Extractor smart-cleaning
- HTML entities are repeatedly decoded, including `&gt;`, `&amp;gt;`, and `&nbsp;` variants.
- Source-only URLs, download lines, page counters, subject/year headers, and standalone figure labels are filtered from extracted question content.
- Figure labels such as `Fig. 2` are removed from questions/options/reasons when they are source labels, while the linked image/passage relationship remains in structured fields.
- Shared passage/group content receives the same cleanup.
- Genuine mathematical operators such as `>` remain intact after decoding.

## Existing extractor behavior preserved
- Linked question groups via passageId.
- Shared images for linked groups.
- Comprehension and cloze group detection.
- A–E to A–D conversion.
- Roman-numeral detection.
- Answer/reason extraction.

## Final checks
- All JavaScript files pass `node --check`.
- EdgeOne deployment structure verification passes.
- ZIP integrity test passes.
- `node_modules` excluded from release archive.
