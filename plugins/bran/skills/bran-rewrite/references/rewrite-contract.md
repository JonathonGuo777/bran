# Bran Rewrite contract

## Pipeline boundary

```text
source file
  -> normalized analyst source
  -> evidence-backed extraction ledger
  -> abstract Story DNA
  -> sealed writer-only clean-room brief
  -> independent rewrite draft
  -> BranInputBundle
  -> compiled Bran package
  -> optional Hodor interactive-story target
  -> awaiting Taste review
```

`bran-rewrite` ends when the machine-audited handoff is ready for human Taste review. It does not record Taste acceptance, approve commercial release, or send the script to downstream media production.

## Rights gate

| Status | Analyze | Build brief | Generate |
| --- | --- | --- | --- |
| `owned` | yes | yes | yes |
| `licensed` | yes | yes | yes |
| `public-domain` | yes | yes | yes |
| `internal-research` | yes | no | no |
| `unknown` | yes | no | no |

Require a rights basis for every status. For `licensed`, record the contract or permission scope. For `public-domain`, record the jurisdiction, source edition, translation status, and verification note.

## Extraction ledger

Use stable IDs and evidence spans for:

- scenes and scene order;
- characters and aliases;
- relationships and state changes;
- events, participants, action, result, and causes;
- emotion nodes, trigger, subject, intensity, and payoff function;
- distinctive expressions that the writer must not receive.

A source span contains `start`, `end`, and `quoteHash`. Offsets use the normalized UTF-16 JavaScript string boundary. Verify that every range is within the normalized source and that every `quoteHash` matches.

ScriptBreak is a structural adapter. LangExtract is a semantic extraction adapter. Their results remain provisional until normalized into this ledger and grounded to the stored source.

## Story DNA

Story DNA may preserve abstract dramatic function:

- audience promise;
- target emotional reward;
- genre and format;
- pressure and release pattern;
- generic relationship dynamic;
- reveal and reversal function;
- pacing and hook targets;
- broad theme and market constraint.

Story DNA must exclude source-specific expression:

- original names and aliases;
- signature dialogue or narration;
- unique props and coined terms;
- exact scene descriptions;
- a distinctive sequence of concrete events;
- source-specific character biographies and relationship graph.

The DNA validator checks names and long phrase overlap. The agent must also perform a semantic review because lexical checks cannot identify every adaptation risk.

## Clean-room seal

Create `analyst/originality-baseline.json` from source-only information. Create `writer/clean-room-brief.json` from an allowlist of abstract DNA fields. Record both hashes in `receipts/clean-room-receipt.json`.

The writer-visible file list must contain only the clean-room brief. Source text, extraction records, exclusions, source names, and originality baseline stay in `analyst/`.

## Rewrite draft

Require:

- a new title, world, setting identifiers, and world rules;
- new character names, identities, goals, fears, flaws, voices, and arcs;
- a newly designed relationship topology;
- a causal chain whose scene references resolve and move forward;
- at least three scenes with ordered beats;
- original dialogue and scene expression;
- a climax and ending;
- mappings from Story DNA functions to new script evidence;
- explicit design decisions covering at least seven redesign categories.

Recommended redesign categories are `character-system`, `relationship-topology`, `world`, `causal-chain`, `key-events`, `reversals`, `climax`, `ending`, and `dialogue`.

### Interactive design

Use `interactiveDesign` when the draft will enter Hodor as an interactive story. Require:

- a valid `entrySceneId`;
- registered writable and derived state fields;
- at least one typed choice in every scene;
- at least one scene with multiple meaningful choices;
- explicit `targetSceneId` values for branching scenes;
- preconditions, effects, costs, decision cues, and public echoes;
- at least two prioritized settlement endings and matching golden vectors.

The generated `BranInputBundle` keeps these choices as typed actions. Bran then exports the compiled package to Hodor, where scenes become node-bound scripts and actions become conditional edges.

## Audit semantics

Block on:

- unresolved rights;
- invalid or stale stage hashes;
- ungrounded required extraction records;
- source names or distinctive expressions in writer-visible files;
- long exact source phrases in Story DNA, brief, or draft;
- missing independent design categories;
- unresolved character, scene, relationship, beat, or causal references;
- a failed Bran compilation or compile audit.
- a failed Hodor target export when the draft declares `project.hodorProjectId`.

Warnings are risk signals. They do not establish infringement or non-infringement. The receipt must state `legalConclusion: "not-provided"`.

## Human handoff

Write `handoff/taste-review-handoff.json` with:

- `status: "awaiting-taste-review"`;
- source rights status and rights-basis hash;
- Story DNA, brief, draft, Bran input, package, and receipt hashes;
- machine blockers and warnings;
- requested review dimensions for pace, target-market taste, emotional payoff, hook strength, character appeal, and localization.
