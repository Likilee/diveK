---
name: divek-bi-governance
description: End-to-end brand identity governance for DiveK. Use when reviewing, approving, or remediating product UI, UX copy, marketing drafts, campaign assets, documentation, and prompts for compliance with DiveK brand core, visual identity, and tone of voice.
---

# DiveK BI Governance

## Run Governance Workflow

1. Identify the artifact and decision scope.
   - `screen-or-flow`: product screens, onboarding, player UI.
   - `copy-set`: microcopy, empty/loading states, tooltips, upsell.
   - `campaign`: landing pages, ad copy, social creatives.
2. Load sources in this order.
   - `docs/DiveK_Brand_Identity_Guidelines_EN.md`
   - `references/governance-checklist.md`
3. Choose review depth.
   - `fast-gate`: pre-merge and daily content checks.
   - `deep-audit`: launch blockers, campaign approvals, rebrand updates.
4. Score four dimensions.
   - `Brand Core Fit`: authenticity, immersion, context-first value.
   - `Visual Identity Fit`: dark premium look, accent use, typography.
   - `Voice Fit`: trendy helpful local buddy tone.
   - `Surface Fit`: copy and behavior match each UX surface.
5. Assign severity and owner.
   - `P0`: directly breaks core value or premium direction.
   - `P1`: strong user-facing inconsistency.
   - `P2`: polish-level mismatch.
6. Decide outcome.
   - `approve`
   - `approve-with-fixes`
   - `reject`
7. Produce a fix plan with acceptance criteria.

## Apply Artifact Matrix

- Use `UI review` when the request is a screen, style file, or component.
  - Prioritize `Visual Identity Fit`, then `Surface Fit`.
- Use `Copy review` when the request is text-only.
  - Prioritize `Voice Fit`, then `Brand Core Fit`.
- Use `Launch review` when request mixes design + copy.
  - Require all four dimensions to pass.

## Enforce Non-Negotiables

- Preserve "textbook to real life" direction.
- Avoid robotic/dictionary voice and cold system language.
- Keep immersion-first UI: no clutter, no noisy blocks, no ad-like interruptions.
- Keep English as primary UI language and add Korean flavor only when subtle.
- Keep color and typography within DiveK standards.

## Resolve Tradeoffs

1. Prefer `Context First` if clarity and style conflict.
2. Prefer `Immersion` if conversion widgets break focus.
3. Prefer `Authenticity` if generated examples sound synthetic.
4. Mark unresolved conflicts as `reject` with a single deciding reason.

## Return Governance Report

Use this format:

```markdown
## BI Governance Result
Decision: approve-with-fixes
Scope: player screen + tooltip copy

### Findings
- [P0][Visual Identity Fit] Background uses bright white panel; breaks theater-black immersion.
- [P1][Voice Fit] Tooltip copy sounds generic and instructional.

### Required Fixes
1. Replace high-luminance panel with #121212-based surface and preserve subtitle contrast.
2. Rewrite tooltip in local-buddy tone with simple English.

### Acceptance Criteria
- Theater-black base is restored.
- Accent colors are limited to highlight intent.
- Final copy matches DiveK voice checks.
```
