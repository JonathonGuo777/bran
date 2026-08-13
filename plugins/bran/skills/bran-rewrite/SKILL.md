---
name: bran-rewrite
description: Convert owned, licensed, or verified public-domain PDF, FDX, Fountain, text, novel, ScriptBreak, or LangExtract source material into an evidence-backed Story DNA, sealed clean-room brief, independently designed script draft, and pre-review Bran handoff. Use when adapting scripts or fiction for another market while preserving abstract audience appeal, emotional rewards, genre mechanics, and pacing targets without carrying over source-specific names, dialogue, scene expression, distinctive event sequences, or other protected expression.
---

# Bran Rewrite

Build the adaptation stages that precede human Taste review. Keep source analysis, writer-visible material, generated expression, and review authority separate.

Read [rewrite-contract.md](references/rewrite-contract.md) before creating or auditing a project.

## Enforce the boundary

Allow analysis for any declared rights status. Allow brief sealing and generation only for `owned`, `licensed`, or `public-domain` sources with a non-empty rights basis. Treat `unknown` and `internal-research` as analysis-only.

Do not describe a percentage changed, similarity score, or machine receipt as legal clearance. Machine checks identify risk signals. A qualified human remains responsible for rights and release decisions.

Use the directories as access boundaries:

```text
analyst/   raw text, evidence ledger, source names, exclusions, Story DNA
writer/    abstract clean-room brief and independently generated draft
handoff/   Bran input, compiled package, and Taste-review handoff
receipts/  hashes, diagnostics, and non-legal originality checks
```

Never copy `analyst/` artifacts into a writer prompt. For production work, generate the draft in a fresh agent or context that receives only `writer/clean-room-brief.json`.

## Run the pipeline

Create an immutable workspace from the source:

```bash
node scripts/bran-rewrite.mjs ingest /absolute/path/to/source.fdx \
  --out /absolute/path/to/rewrite-workspace \
  --rights licensed \
  --rights-basis "Contract ID and permitted adaptation scope" \
  --title "Source title" \
  --language en
```

The ingester supports `.pdf`, `.docx`, `.fdx`, `.fountain`, `.txt`, `.md`, and text-bearing JSON. PDF ingestion requires `pdftotext`; DOCX ingestion requires `unzip`. It creates structural scene and dialogue candidates without claiming semantic completeness.

Pipe pasted source through standard input when no source file exists:

```bash
pbpaste | node scripts/bran-rewrite.mjs ingest - \
  --format text \
  --out /absolute/path/to/rewrite-workspace \
  --rights owned \
  --rights-basis "Internal original source"
```

Enrich the evidence ledger using native structured extraction, ScriptBreak JSON, or LangExtract JSON/JSONL:

```bash
node scripts/bran-rewrite.mjs extract /absolute/path/to/rewrite-workspace \
  --input /absolute/path/to/extraction-ledger.json
```

Every character, relationship, event, scene, and emotion node must carry a source span or an explicit unresolved status. Preserve exact source wording only inside the analyst evidence ledger.

Create Story DNA with abstract functions:

- audience promise and target audience;
- genre envelope and market constraints;
- emotional rewards and their timing;
- character and relationship functions;
- pressure, reveal, reversal, climax, and payoff mechanics;
- pacing targets and independent redesign requirements.

Do not include source names, signature dialogue, unique props, scene wording, or the source's distinctive event chain. Seal it:

```bash
node scripts/bran-rewrite.mjs seal-dna /absolute/path/to/rewrite-workspace \
  --input /absolute/path/to/story-dna.json

node scripts/bran-rewrite.mjs brief /absolute/path/to/rewrite-workspace
```

Give only `writer/clean-room-brief.json` to the writing context. Require new character identities, relationship topology, world rules, causal chain, key events, reversals, climax, ending, and dialogue.

Package the independent draft:

```bash
node scripts/bran-rewrite.mjs generate /absolute/path/to/rewrite-workspace \
  --draft /absolute/path/to/rewrite-draft.json

node scripts/bran-rewrite.mjs audit /absolute/path/to/rewrite-workspace
```

Generation writes a `BranInputBundle`, invokes the sibling `$bran` deterministic compiler, runs its compile audit, and creates `handoff/taste-review-handoff.json` with status `awaiting-taste-review`.

For an interactive draft, add `interactiveDesign` with an entry scene, registered state fields, typed choices, target scenes, conditions, effects, costs, and at least two settlement endings. When `project.hodorProjectId` is present, generation also writes `handoff/hodor-interactive-story-target.json`.

## Stop conditions

Stop before generation when rights are unresolved, evidence spans fail verification, Story DNA leaks source-specific expression, the writer brief contains analyst-only fields, or required independent design targets are missing.

Stop before Taste review when the generated draft reuses source character names, distinctive terms, long exact phrases, unresolved IDs, or lacks a new causal chain and ending. Report warnings separately from blockers and preserve the audit receipt.
