# Visual Rules

Use this file for fast visual QA.

## Core Tokens

- Base background: `#121212` (default dark mode).
- Accent 1: `#00FFCC` (Neon Mint).
- Accent 2: `#8A2BE2` (Seoul Purple).
- English UI fonts: `Inter` or `Outfit`.
- Korean subtitle font: `Pretendard`.

## Mandatory Pass Checks

- Keep the primary surface dark and cinematic.
- Use accent colors for highlighted words and key states only.
- Preserve clear subtitle readability on dark surfaces.
- Keep layout minimal and distraction-free.

## Automatic Fail Conditions

- Use bright default backgrounds that break immersion.
- Use random primaries or Korea-flag red/blue motifs as brand base.
- Overuse accent colors until highlights lose meaning.
- Replace approved type system with mismatched novelty fonts.

## Remediation Pattern

1. Restore base dark tokens.
2. Reduce accent density and map accents to semantic highlight roles.
3. Reapply typography stacks by language context.
4. Remove decorative noise and ad-like panels.
