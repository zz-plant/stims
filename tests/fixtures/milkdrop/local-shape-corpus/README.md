# Local custom-shape corpus

These fixtures complement the vendored `projectm-upstream` regression slice.
The upstream fixtures currently cover parser/compiler behavior for waves,
shader text, and alias normalization, but they do not include presets that
exercise custom shape slots.

This local corpus keeps shape coverage in a corpus-style form by focusing on:

- shape scalar fields,
- shape init and per-frame programs,
- legacy slot spellings such as `shapecode_32_*`,
- border, thick outline, and additive flags.
