# Context Window Inspector

## Purpose

This repository explains the observable composition of Codex context windows. Context transparency is the primary product; retention guidance is secondary and must remain conditional.

## Product language

- Prefer “context composition,” “observable items,” “reconstructed,” and “unresolved.”
- Use “potentially not useful to keep carrying” only for the optional retention lens.
- Do not turn the interface into a judgmental score, alarm, or workflow grade.
- Distinguish official request counters from estimated item-level values everywhere.

## Technical rules

- Codex rollout JSONL is the only supported input.
- Analysis must remain local with no upload path.
- Keep the project dependency-free unless a dependency materially improves accuracy.
- Every context view must reconcile exactly to its official `input_tokens`.
- Add tests for parser or classification changes.
- Preserve accessible labels and non-color category cues.

## Verification

```bash
npm run check
```
