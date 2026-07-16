---
name: bran
description: Build, repair, compile, or audit executable branching story packages for the Bran script-generation system. Use when work involves TextWorker, narrative operators, multi-seat visibility, replay recipes, evidence-grounded choices, Agent information gain, waiting interactions, world-state settlement, carryover consequences, multi-run simulation, or a downstream handoff to the Weirwood media pipeline.
---

# Bran

Turn source material and world rules into a story package whose branches, actions, state, Agent behavior, and endings can be compiled and replayed. Treat declarations, prose plans, and intended outcomes as hypotheses until a validator reproduces them.

## Start from the source boundary

Read the project instructions and the current handoff package before editing. Preserve user-owned changes and source locks. Separate retained source wording, grounded adaptation, and demo invention with explicit provenance.

Read [artifact-contract.md](references/artifact-contract.md) before changing package structure. Read [quality-gates.md](references/quality-gates.md) before accepting a result. Read [skill-adaptation.md](references/skill-adaptation.md) when adapting story, character, or novel workflows.

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
node scripts/audit-package.mjs /absolute/path/to/upstream_handoff
```

Use adversarial player perspectives after static validation. Give fresh testers only seat-visible information. Ask them to complete multiple recipes without exposing intended answers. Record clarity, agency, negotiation value, repeated dominant paths, and replay novelty.

Treat a generated quality receipt as the release authority only while its artifact hash matches the current package. A prose report or stale cached receipt cannot override a failed machine gate.

## Deliver

Provide a versioned handoff directory, package files, schemas, reproducible tools, quality receipts, playtest evidence, and a concise downstream field contract. State the difference between machine-validated content mechanics and human-validated fun.
