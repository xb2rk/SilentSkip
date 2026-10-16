# @craftland-qa/ai

The AI review pipeline (Insea) — **currently an empty shell**: implementation starts at E4.

## Planned scope

- **Insea client**: stateless single-shot calls (`multipart` of `{Prompt, Manifest, DataList}` →
  `{result}`);
  timeout probing + canary checks land here, results recorded in `docs/INSEA.md` (E4).
- **Passes**: `digest_read → [dig] → synthesize` with a versioned prompt registry
  (`docs/PROMPTS.md`, golden snapshots in tests).
- **Citation verifier (mandatory)**: every claim must reference evidence-anchor IDs from the
  context manifest; unanchored claims are stripped and counted (stats surface in the UI).
- **Deterministic fallback**: when the model times out or fails verification, the deterministic
  engine output is presented instead — the UI never depends on a flaky call.

## Hard rules

- The LLM is **never a fact source**: it reads digests, writes prose, and cites anchors. Facts
  come from `packages/engine`.
- No user project content leaves the machine except the digested context the user explicitly ran.
- Prompts live in the registry, not inline in code; changes get snapshot tests.
