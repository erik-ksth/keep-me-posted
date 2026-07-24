# Product

## Register

product

## Platform

web

## Users

Individual developers inspecting their own Codex sessions locally. They want to understand what the model is carrying without needing to read raw rollout logs or learn the provider’s event schema.

## Product Purpose

Context Window Inspector reconstructs a clear, turn-by-turn view of a Codex context window from a local rollout JSONL file. It shows official request-level token counters alongside estimated item-level composition, explains what each category contains, and lets the developer inspect every locally observable item.

Success means a developer can answer “what is in my context window right now?” quickly, then move from the overview to exact messages, file reads, commands, changes, images, and reasoning metadata without losing orientation.

## Positioning

The most transparent local view of what a Codex session is carrying into each model request.

## Brand Personality

Observational, precise, and explanatory. The interface should feel like a quiet measurement instrument: comprehensive enough for expert inspection, but written so the information remains understandable.

## Anti-references

Do not frame the product as a scorecard, optimizer, cleanup alarm, or judgment of the developer’s workflow. Avoid red-heavy warning dashboards, gamified health scores, and interfaces that collapse the context window into a single “good” or “bad” number.

## Design Principles

1. Composition before judgment: lead with what is present and how much space it occupies.
2. Official and estimated numbers remain visibly distinct.
3. Start with an understandable overview, then preserve every available detail.
4. Explain uncertainty at the point where it appears.
5. Keep all analysis local and make that privacy boundary obvious.

## Accessibility & Inclusion

Meet WCAG AA contrast, support keyboard navigation, use color-blind-safe category distinctions with text labels, and respect reduced-motion preferences.
