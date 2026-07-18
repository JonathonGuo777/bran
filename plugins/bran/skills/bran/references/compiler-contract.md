# Compiler contract

Bran is the narrative-compilation half of Hodor. It owns source grounding, story structure, typed interaction, world-state rules, character Agent boundaries, deterministic settlement, and package diagnostics. Material generation remains downstream.

## Compilation boundary

Use this pipeline:

```text
source material
  -> reviewed SourceEvent ledger
  -> BranInputBundle
  -> deterministic Bran compiler
  -> NarrativePackage + ProductionRequest + CompileReceipt
  -> downstream review, simulation, and release
```

Creative Agents may propose events, scenes, dialogue, and actions before compilation. Their outputs remain provisional until they use stable IDs, resolve source and canon references, register every state path, and pass the compiler diagnostics.

The compiler does not call an LLM. It converts reviewed structured authoring output into a stable intermediate representation. This keeps model choice and prompt orchestration outside the executable package and makes repeated compilation reproducible.

## SourceEvent ledger

Every source event needs:

- a stable `eventId` and total ordering key;
- one or more source spans with `sourceId` and locator;
- participants, action, result, and causal predecessors;
- canon status, confidence, and review status.

A chapter summary is not enough. Separate events when they have different participants, causes, results, visibility, or downstream scene uses. Mark adaptation inventions explicitly instead of attaching them to source-confirmed spans.

## Machine-readable state and settlement

Every writable field belongs in `stateModel.fields` with its type, default value, and authorized writers. Every derived field needs a serializable `expression`; a prose formula may accompany it but cannot replace it.

Bran supports a safe JSON expression subset for conditions and derivations:

- data access: `var`, `missing`;
- logic: `and`, `or`, `!`, `!!`, `if`;
- comparison: `==`, `===`, `!=`, `!==`, `>`, `>=`, `<`, `<=`, `in`;
- arithmetic: `+`, `-`, `*`, `/`, `%`, `min`, `max`;
- text composition: `cat`.

Settlement rules are evaluated by priority. The first matching predicate produces the ending code and reason codes. Golden vectors must cover every intended ending class and important contradiction boundary.

## Package lifecycle

`compiled` means source references, graph references, action paths, derived expressions, settlement vectors, authority boundaries, and artifact hashes pass static audit.

`reviewed` means authors have accepted the event ledger, canon changes, character contracts, playable scenes, and production requests.

Reviews are hash-bound by stage. When a reviewed artifact changes, the review receipt reports that stage as stale and the package must return to `compiled` until the stage is accepted again.

Treat package versions as immutable. A content change compiles to a new package with `lineage.parentPackageVersion` and optional fork metadata. Use `bran diff` to inspect stable-ID additions, removals, and changes. Rollback selects an older package version; it does not mutate history.

`release` additionally requires deterministic replay traces, evidence decisions, waiting interactions, Agent fixtures, carryover classes, settlement receipts, human playtest evidence, and a fresh quality receipt.

Do not label a compiled draft as release-ready.

## Downstream material handoff

`production-request.json` describes semantic asset slots. It may state scene and beat IDs, purpose, required characters, continuity references, runtime cues, fallback behavior, and constraints.

The downstream material workflow may attach generated asset references to those slots. It cannot rewrite source events, canon facts, actions, `WorldState`, or settlement rules. A released StoryPackage is the reviewed narrative package plus accepted downstream asset references.

## Runtime handoff

`runtime-contract.json` defines the operations and event envelopes expected from the runtime. Natural-language intent is resolved to a typed action before state mutation.

The three event boundaries are:

- `WorldEvent`: accepted runtime action and state transition;
- `RelationshipEventCandidate`: evidence-backed proposal for private relationship memory;
- `ContentFeedback`: runtime evidence that a scene, action, explanation, or content slot needs revision.

Bran defines these envelopes. The runtime owns the current run, and the relationship system owns accepted private relationship truth.

## Design influences

Bran follows the proven separation used by [Ink](https://github.com/inkle/ink) between authored source, compiled intermediate JSON, and runtime execution. Its structured diagnostics and stable node metadata follow the compiler discipline demonstrated by [Yarn Spinner](https://github.com/YarnSpinnerTool/YarnSpinner). Serializable rule expressions follow the portability principle of [JsonLogic](https://github.com/jwadhams/json-logic-js).

Bran implements its own package model and zero-dependency expression evaluator. No upstream source code is vendored.
