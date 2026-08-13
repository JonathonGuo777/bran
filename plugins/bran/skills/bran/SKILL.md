---
name: bran
description: Build, repair, compile, or audit executable branching story packages for the Bran script-generation system. Use when work involves TextWorker, narrative operators, multi-seat visibility, replay recipes, evidence-grounded choices, Agent information gain, waiting interactions, world-state settlement, carryover consequences, multi-run simulation, or a downstream handoff to the Weirwood media pipeline.
---

# Bran

Turn source material and world rules into a story package whose branches, actions, state, Agent behavior, and endings can be compiled and replayed. Treat declarations, prose plans, and intended outcomes as hypotheses until a validator reproduces them.

## Start from the source boundary

Read the project instructions and the current handoff package before editing. Preserve user-owned changes and source locks. Separate retained source wording, grounded adaptation, and demo invention with explicit provenance.

Use the sibling `$bran-rewrite` skill when the source still needs evidence extraction, Story DNA abstraction, clean-room rewriting, or a pre-Taste-review script draft. Return to `$bran` after `bran-rewrite` emits a `BranInputBundle`.

Read [compiler-contract.md](references/compiler-contract.md) before compiling a `BranInputBundle` or changing compiler schemas. Read [artifact-contract.md](references/artifact-contract.md) before changing package structure. Read [quality-gates.md](references/quality-gates.md) before accepting a result. Read [skill-adaptation.md](references/skill-adaptation.md) when adapting story, character, or novel workflows. Read [hodor-target-contract.md](references/hodor-target-contract.md) before exporting to Hodor or validating its import receipt.

## Compile reviewed authoring output

Keep creative generation separate from deterministic compilation. Convert reviewed source events, canon facts, characters, scenes, typed actions, state fields, settlement rules, Agent boundaries, runtime events, and semantic asset slots into a `BranInputBundle`.

Compile it with:

```bash
node scripts/bran.mjs compile /absolute/path/to/bran-input.json --out /absolute/path/to/handoff
```

Use machine-readable expressions for every derived state field and settlement predicate. A prose formula is documentation and cannot be independently recomputed.

Bind author approval to current artifact hashes one stage at a time:

```bash
node scripts/bran.mjs review /absolute/path/to/handoff --stage narrative --status accepted --reviewer author-name
```

The package becomes `reviewed` only after source events, canon, characters, narrative, Agents, runtime, and production request stages all hold fresh accepted reviews.

Compile content changes into a new immutable `packageVersion`, set `lineage.parentPackageVersion`, and inspect stable-ID changes before review:

```bash
node scripts/bran.mjs diff /absolute/path/to/base-handoff /absolute/path/to/candidate-handoff
```

Rollback means selecting an earlier immutable package version. Do not rewrite a prior reviewed or released package in place.

## Export the Hodor canvas target

Keep Bran upstream of the Hodor canvas and production workbench. Compile source grounding, scenes, typed choices, state rules, and endings in Bran, then export a Hodor-compatible target:

```bash
node scripts/bran.mjs export-hodor /absolute/path/to/handoff \
  --project-id 1785137013680 \
  --out /absolute/path/to/hodor-target.json
```

The exporter converts scene actions into player-choice edges, expands derived-state conditions, maps state paths to Hodor-safe variables, adds explicit settlement and ending nodes, renders node-bound scripts, and produces stable binding keys.

Require the Hodor importer to return a binding and validation receipt. Verify the receipt before calling the handoff complete:

```bash
export HODOR_TOKEN="local bearer token"
node scripts/bran.mjs apply-hodor /absolute/path/to/hodor-target.json \
  --base-url http://127.0.0.1:10588 \
  --receipt /absolute/path/to/hodor-import-receipt.json

node scripts/bran.mjs verify-hodor /absolute/path/to/hodor-target.json \
  --receipt /absolute/path/to/hodor-import-receipt.json
```

For an existing graph, compare and synchronize immutable targets using stable receipt bindings:

```bash
node scripts/bran.mjs diff-hodor /absolute/path/to/base-target.json /absolute/path/to/candidate-target.json
node scripts/bran.mjs sync-hodor \
  /absolute/path/to/base-target.json \
  /absolute/path/to/candidate-target.json \
  --base-receipt /absolute/path/to/base-receipt.json \
  --base-url http://127.0.0.1:10588 \
  --receipt /absolute/path/to/candidate-receipt.json
```

Treat Hodor chat edits as structured Bran patches that compile to a new package version. Do not accept title-matched database mutations as Bran source truth. After direct REST apply or sync, refresh an already open Hodor canvas once.

## Build the package in three layers

Create the character layer from Want, Need, fear, error habit, leverage, voice, OOC boundaries, relationship pressure, and visible evidence of change.

Create the narrative layer from canon facts, timeline, conflict axes, public and private visibility, scene units, evidence decisions, choice costs, counterplay, waiting interactions, and scene exits.

Create the game layer from registered state fields, executable recipe overrides, action preconditions, state effects, costs, counteractions, merge gates, carryover mutations, settlement rules, and replay traces.

Do not let a character or prose workflow write world state directly. Convert its result into a typed action contract first.

## Compile replay variation

For every recipe, replace the decision layer in at least three scenes. Give every action a stable instance ID, seat, precondition, effect, cost, counteraction, decision cue, and public echo. Define baseline actions for scenes the recipe does not replace, so every strategy can traverse the complete scene sequence.

Compile each recipe against the base scene graph. Compare compiled action graphs rather than recipe descriptions. Reject a recipe when its apparent difference comes only from text, item names, or ordering without strategic consequences. A replay trace must execute every scene, pay actual costs, satisfy both seats at each merge, generate a non-empty draft hash, and call the settlement reducer.

## Ground decisions and Agent answers

Before each evidence decision, show at least two visible evidence statements, what each statement supports, and what it does not prove. Attach state effects and next-action unlocks to every option. For value conflicts, show different costs without labeling one answer as morally correct.

Test each Agent on dates, sources, authorization or scope, the other seat's private information, proposals, and draft fields. Require a visible fact or a precise missing-evidence statement, plus a risk, condition, counterproposal, or executable next action.

## Reduce world state before rendering endings

Use this truth chain:

```text
ActionEvent[] -> deterministic reducer -> WorldState -> SettlementReceipt -> EndingProjection
```

Keep ending prose out of fixed dialogue assets. Project broadcast, protection, evidence, authorization, signatures, and result as separate truth fragments. Add a golden vector for every prior state-text contradiction.

## Validate and adversarially review

Run the package's own validator when present. Then run the independent auditor, which recomputes state paths, references, evidence-action links, action-graph distance, full traces, endings, dominance, and receipt freshness:

```bash
node scripts/bran.mjs audit /absolute/path/to/handoff --level compile
node scripts/bran.mjs audit /absolute/path/to/release-handoff --level release
```

Use adversarial player perspectives after static validation. Give fresh testers only seat-visible information. Ask them to complete multiple recipes without exposing intended answers. Record clarity, agency, negotiation value, repeated dominant paths, and replay novelty.

Treat a generated quality receipt as the release authority only while its artifact hash matches the current package. A prose report or stale cached receipt cannot override a failed machine gate.

## Deliver

Provide a versioned handoff directory, package files, schemas, reproducible tools, quality receipts, playtest evidence, and concise runtime and production-request contracts. The production request declares semantic asset slots only; downstream material production fills them without mutating narrative state or settlement. State the difference between compiled, reviewed, and release lifecycle states, and between machine-validated content mechanics and human-validated fun.
