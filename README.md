# Bran

[简体中文](README.zh-CN.md)

Bran is a pair of Agent Skills and a zero-dependency Node.js compiler for clean-room script rewriting, executable branching-story compilation, and reproducible narrative audits.

It is designed for a recurring production failure: a story package may contain many branches on paper while giving players the same strategy, the same dominant choice, or an ending that contradicts the final world state. Bran turns narrative intent into typed actions and checks the resulting behavior.

```text
source material + reviewed SourceEvent ledger
        |
        v
BranInputBundle: canon + characters + scenes + world rules
        |
        v
bran compile -> NarrativePackage + RuntimeContract + ProductionRequest
        |
        v
bran export-hodor -> nodes + choices + variables + endings + binding contract
        |
        v
deterministic reducer -> world state -> settlement receipt -> ending projection
```

Bran is Hodor's narrative-compilation layer. It owns source grounding, story and interaction structure, typed actions, world-state rules, character Agent boundaries, and deterministic settlement. Downstream material production receives semantic asset slots and may fill asset references without changing narrative state or endings.

`bran-rewrite` is the pre-review child skill. It accepts authorized source material, stores evidence in an analyst-only area, seals abstract Story DNA into a writer-only clean-room brief, packages an independently designed draft, and stops at `awaiting-taste-review`.

```text
PDF / DOCX / FDX / Fountain / Markdown / novel text
        |
        v
ScriptBreak + LangExtract compatible evidence ledger
        |
        v
Story DNA -> sealed clean-room brief -> independent draft
        |
        v
BranInputBundle -> bran compile/audit -> awaiting Taste review
```

## What Bran checks

- Every replay recipe changes the decision layer in at least three scenes.
- Every action has a seat, precondition, effect, cost, counteraction, and public echo.
- Evidence decisions show what is known, what remains uncertain, and what each option changes.
- Agent answers provide usable facts, precise information gaps, risks, conditions, or next actions.
- Waiting players retain visible state, local actions, and a clear next unlock.
- Ending text is projected from reduced world state instead of fixed dialogue.
- Deterministic traces cover every scene, merge, cost, signature, settlement, and carryover consequence.

The default quality gates include a compiled action-graph Jaccard distance of at least `0.30`, fixed decision-cue reuse of at most `0.40`, complete scene coverage, full state-path registration, and settlement golden vectors with a `100%` pass rate.

## Install in Codex

Add this repository as a plugin marketplace:

```bash
codex plugin marketplace add JonathonGuo777/bran
```

Restart the ChatGPT desktop app, open Plugins, select the Bran marketplace, and install Bran.

To install only the Agent Skill, ask Codex:

```text
$skill-installer install https://github.com/JonathonGuo777/bran/tree/main/plugins/bran/skills/bran
$skill-installer install https://github.com/JonathonGuo777/bran/tree/main/plugins/bran/skills/bran-rewrite
```

After a direct skill install, restart Codex so it can discover the new skill.

## Install manually

```bash
git clone https://github.com/JonathonGuo777/bran.git
mkdir -p ~/.codex/skills
cp -R bran/plugins/bran/skills/bran ~/.codex/skills/bran
cp -R bran/plugins/bran/skills/bran-rewrite ~/.codex/skills/bran-rewrite
```

The skill follows the portable `SKILL.md` convention. Other compatible agents can install the same `plugins/bran/skills/bran` directory in their own skill path.

## Use

Run the rewrite pipeline up to the human Taste-review boundary:

```bash
node plugins/bran/skills/bran-rewrite/scripts/bran-rewrite.mjs ingest \
  /absolute/path/to/source.fdx \
  --out /absolute/path/to/rewrite-workspace \
  --rights licensed \
  --rights-basis "Contract and adaptation scope"

node plugins/bran/skills/bran-rewrite/scripts/bran-rewrite.mjs extract \
  /absolute/path/to/rewrite-workspace \
  --input /absolute/path/to/extraction-ledger.json

node plugins/bran/skills/bran-rewrite/scripts/bran-rewrite.mjs seal-dna \
  /absolute/path/to/rewrite-workspace \
  --input /absolute/path/to/story-dna.json

node plugins/bran/skills/bran-rewrite/scripts/bran-rewrite.mjs brief \
  /absolute/path/to/rewrite-workspace

node plugins/bran/skills/bran-rewrite/scripts/bran-rewrite.mjs generate \
  /absolute/path/to/rewrite-workspace \
  --draft /absolute/path/to/rewrite-draft.json
```

Pipe pasted source through standard input:

```bash
pbpaste | node plugins/bran/skills/bran-rewrite/scripts/bran-rewrite.mjs ingest - \
  --format text \
  --out /absolute/path/to/rewrite-workspace \
  --rights owned \
  --rights-basis "Company-owned original source"
```

Generation is blocked for `unknown` and `internal-research` rights states. Machine similarity and provenance checks produce risk signals and do not provide legal clearance.

Invoke Bran with a concrete source boundary and target package:

```text
Use $bran to compile this story source into a two-human, two-Agent replayable handoff package.
```

```text
Use $bran to audit this handoff. Recompute action-graph distance, settlement results, Agent information gain, waiting interactions, and receipt freshness.
```

Compile a reviewed structured input bundle:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs compile \
  plugins/bran/skills/bran/fixtures/harbor-signal/bran-input.json \
  --out /tmp/harbor-signal-handoff
```

Audit the compiled package and independently recompute its rules:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs audit \
  /tmp/harbor-signal-handoff \
  --level compile
```

Export a compile-audited package to the Hodor interactive-story contract:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs export-hodor \
  /tmp/harbor-signal-handoff \
  --project-id 1785137013680 \
  --out /tmp/hodor-target.json
```

The exporter produces Hodor-compatible node kinds, bound script candidates, positions, choice conditions, variable effects, a settlement hub, and explicit endings. After Hodor persists the graph, require a stable-ID binding and validation receipt:

```bash
export HODOR_TOKEN="local bearer token"
node plugins/bran/skills/bran/scripts/bran.mjs apply-hodor \
  /tmp/hodor-target.json \
  --base-url http://127.0.0.1:10588 \
  --receipt /tmp/hodor-import-receipt.json

node plugins/bran/skills/bran/scripts/bran.mjs verify-hodor \
  /tmp/hodor-target.json \
  --receipt /absolute/path/to/hodor-import-receipt.json
```

`apply-hodor` refreshes the revision after every mutation and continuously saves node, script, edge, and variable bindings. Reusing the same target and receipt resumes an interrupted import. A non-empty graph without a matching receipt is rejected to prevent duplicate imports.

Use `diff-hodor` and `sync-hodor` for a revised Bran package:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs diff-hodor \
  /tmp/hodor-target.json /tmp/hodor-target-v2.json

node plugins/bran/skills/bran/scripts/bran.mjs sync-hodor \
  /tmp/hodor-target.json /tmp/hodor-target-v2.json \
  --base-receipt /tmp/hodor-import-receipt.json \
  --base-url http://127.0.0.1:10588 \
  --receipt /tmp/hodor-import-receipt-v2.json
```

The sync uses stable receipt bindings to create, update, and remove graph records under Hodor revision guards. Direct REST apply or sync requires one click on the Hodor canvas refresh control when the canvas is already open.

Record a hash-bound author review for one stage:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs review \
  /tmp/harbor-signal-handoff \
  --stage narrative \
  --status accepted \
  --reviewer author-name
```

Available stages are `source-events`, `canon`, `characters`, `narrative`, `agents`, `runtime`, and `production-request`. Every stage must have a fresh accepted review before the lifecycle becomes `reviewed`.

Compare two immutable package versions by stable ID:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs diff \
  /absolute/path/to/base-handoff \
  /absolute/path/to/candidate-handoff
```

The diff reports added, removed, changed, and unchanged source events, characters, scenes, actions, recipes, and endings, plus lineage validity and breaking removals.

Evaluate a world state through the package's declarative settlement rules:

```bash
node plugins/bran/skills/bran/scripts/bran.mjs settle \
  /tmp/harbor-signal-handoff \
  --state /absolute/path/to/world-state.json
```

For packages that follow Bran's artifact contract, run the independent auditor directly:

```bash
node plugins/bran/skills/bran/scripts/audit-package.mjs /absolute/path/to/upstream_handoff
```

The auditor exits with code `0` on a pass and code `1` when a gate fails. Its JSON output can be stored as a CI artifact or release receipt.

## Package lifecycle

- `compiled`: static references, typed actions, state paths, derived expressions, settlement vectors, authority boundaries, and artifact hashes pass.
- `reviewed`: authors have accepted the event ledger, canon changes, character boundaries, playable scenes, and production requests.
- `release`: deterministic traces, Agent fixtures, carryover, receipts, and human playtest evidence also pass.

Compilation does not manufacture release evidence. This keeps creative authoring, deterministic compilation, runtime execution, and human approval independently inspectable.

Each author review is bound to the current hash of its stage. Editing a reviewed artifact makes the review receipt fail until that stage is accepted again.

Package versions are immutable. Rollback selects an older version, while forks and revisions compile to a new version linked through `lineage.parentPackageVersion`.

Packages produced before `0.2.0` may contain prose-only derived-state formulas. Add a machine-readable `expression` to each derived field before using the generic settlement auditor; Bran deliberately rejects settlement logic it cannot independently recompute.

## Core contracts

- `SourceEvent` grounds an event in source spans and records participants, action, result, causes, canon status, confidence, and review state.
- `BranInputBundle` is the reviewed compiler input.
- `NarrativePackage` is the stable intermediate representation consumed by audit and runtime integration.
- `RuntimeContract` defines typed actions plus `WorldEvent`, `RelationshipEventCandidate`, and `ContentFeedback` envelopes.
- `ProductionRequest` declares semantic asset slots. It contains no image, video, audio, provider, or generation-task implementation.
- `HodorTarget` projects Bran scenes, actions, state, and settlement into the Hodor canvas contract.
- `HodorImportReceipt` binds stable Bran keys to Hodor node, edge, variable, and `o_script` IDs.

## Repository layout

```text
.
├── .agents/plugins/marketplace.json
├── plugins/bran/
│   ├── .codex-plugin/plugin.json
│   └── skills/bran/
│       ├── SKILL.md
│       ├── agents/openai.yaml
│       ├── fixtures/harbor-signal/
│       ├── references/
│       ├── schemas/
│       └── scripts/
├── scripts/test-core.mjs
├── scripts/validate-repo.mjs
├── package.json
└── README.md
```

The public repository and the runtime skill are deliberately separated. Repository documentation, contribution files, and CI stay outside the skill folder so the installed skill remains focused.

## Artifact contract

Bran expects a versioned handoff with source provenance, canon and visibility partitions, character contracts, scene scripts, typed choice contracts, recipe overrides, baseline actions, a state-field registry, Agent evaluation fixtures, waiting interactions, settlement rules, carryover contracts, replay traces, and a fresh quality receipt.

The exact responsibilities and default gates live in:

- [`compiler-contract.md`](plugins/bran/skills/bran/references/compiler-contract.md)
- [`artifact-contract.md`](plugins/bran/skills/bran/references/artifact-contract.md)
- [`quality-gates.md`](plugins/bran/skills/bran/references/quality-gates.md)
- [`skill-adaptation.md`](plugins/bran/skills/bran/references/skill-adaptation.md)
- [`hodor-target-contract.md`](plugins/bran/skills/bran/references/hodor-target-contract.md)

## Design boundary

Machine gates can prove internal consistency, mechanical variation, reachability, and reproducibility. They cannot prove that a game is emotionally engaging. Bran therefore treats fresh-player, seat-visible playtests as a separate release requirement and asks teams to report machine-validated mechanics and human-validated fun independently.

The compiler architecture is informed by [Ink](https://github.com/inkle/ink), the compiler diagnostics and metadata discipline by [Yarn Spinner](https://github.com/YarnSpinnerTool/YarnSpinner), and the portable-rule approach by [JsonLogic](https://github.com/jwadhams/json-logic-js). Bran implements its own package model and dependency-free evaluator; it does not vendor their source code.

## Why the name

Bran represents the script-generation layer of the Hodor content system. Its job is to see the available timelines, compile the branch that can actually occur, and hand a stable story package to the downstream Weirwood media pipeline.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports should include the smallest reproducible package, the auditor output, and the expected state or ending.

## License

MIT. See [LICENSE](LICENSE).
