# Hodor target contract

Bran owns the source-to-executable-story half of the pipeline. Hodor owns project storage, canvas interaction, node-bound production workspaces, and downstream media execution.

Use this boundary:

```text
source
  -> Bran Rewrite evidence and authoring stages
  -> BranInputBundle
  -> deterministic NarrativePackage
  -> Hodor interactive-story target
  -> Hodor import receipt
  -> canvas and production workbench
```

## Export

Export a compiled package only after the compile audit passes:

```bash
node scripts/bran.mjs export-hodor /absolute/path/to/handoff \
  --project-id 1785137013680 \
  --out /absolute/path/to/hodor-target.json
```

Use `--recipe <recipe-id>` to export a recipe-specific action graph. The default target uses baseline actions.

The target contains:

- a numeric Hodor project ID;
- stable Bran node, edge, and variable keys;
- Hodor-compatible graph status, node kind, node status, positions, scripts, choices, conditions, effects, and priorities;
- a deterministic mapping from dotted Bran state paths to Hodor-safe variable names;
- original condition ASTs beside Hodor condition strings;
- the Bran package version, package artifact hash, recipe ID, and target hash;
- exact Hodor interactive-story tool names and required mutation order.

Every Bran scene becomes one node with a complete `o_script` candidate. A scene with multiple actions becomes a `branch` node. Terminal actions enter a Bran settlement hub. Settlement rules become prioritized edges from that hub to explicit ending nodes.

Derived state is expanded into executable source-field expressions before export because Hodor variables do not currently carry derived-field reducers. Unsupported state types, operators, action targets, effects, dead ends, unreachable nodes, and stale hashes block the export.

## Stable bindings

Hodor creates UUID node and edge IDs plus integer `o_script` IDs. It does not currently accept Bran IDs as database primary keys. The importer must therefore preserve the mapping in a receipt:

```text
Bran nodeKey -> Hodor nodeId + scriptId
Bran edgeKey -> Hodor edgeId
Bran variableKey -> Hodor variableId
```

The receipt also records the applied graph ID, final revision, Hodor validation report, target hash, and application time. Incremental editing must use these bindings instead of matching titles.

Verify it with:

```bash
node scripts/bran.mjs verify-hodor /absolute/path/to/hodor-target.json \
  --receipt /absolute/path/to/hodor-import-receipt.json
```

Verification fails when any binding is missing or extra, the target hash changed, the project differs, graph validation contains issues, or a node lacks its bound script.

## Mutation order

The Hodor adapter applies mutations serially:

```text
initialize graph
  -> define variables
  -> create nodes and bound scripts
  -> connect edges
  -> set entry
  -> mark graph ready
  -> validate graph
```

After each mutation, read the returned revision and use it as the next `expectedRevision`. A revision conflict stops the import. Do not retry by recreating nodes with matching titles.

Apply a target through the Hodor REST contract:

```bash
export HODOR_TOKEN="local bearer token"
node scripts/bran.mjs apply-hodor /absolute/path/to/hodor-target.json \
  --base-url http://127.0.0.1:10588 \
  --receipt /absolute/path/to/hodor-import-receipt.json
```

The token is read from `HODOR_TOKEN` by default and is never written to the target or receipt. Use `--token-env <name>` to select another environment variable.

The adapter writes an `applying` receipt after initialization and updates bindings after every successful mutation. Re-running the command with the same target and receipt resumes missing operations. A non-empty Hodor graph without a matching receipt is rejected to prevent duplicate or title-matched imports.

This path does not call Hodor `scriptAgent` or depend on `scriptAgent:decisionAgent`. Creative generation and review happen before Bran compilation; Hodor receives an already compiled, audited graph.

## Incremental sync

Compare two immutable targets before changing an existing graph:

```bash
node scripts/bran.mjs diff-hodor \
  /absolute/path/to/base-target.json \
  /absolute/path/to/candidate-target.json
```

Synchronize the candidate with stable bindings from the validated base receipt:

```bash
node scripts/bran.mjs sync-hodor \
  /absolute/path/to/base-target.json \
  /absolute/path/to/candidate-target.json \
  --base-receipt /absolute/path/to/base-receipt.json \
  --base-url http://127.0.0.1:10588 \
  --receipt /absolute/path/to/candidate-receipt.json
```

The sync marks the graph draft, upserts changed variables, creates or updates nodes and scripts, deletes obsolete edges, creates or updates candidate edges, sets the entry, removes obsolete nodes and variables, marks the graph ready, and validates it. It preserves the base target and receipt, writes a new candidate receipt after every mutation, and stops on revision drift.

Hodor's current React canvas reloads after its chat agent finishes and also provides a refresh button. A direct Bran REST apply or sync does not emit that chat event, so an already open canvas must use its refresh button once after the command reports success.

## Authority

Bran remains authoritative for source grounding, scene and choice structure, state paths, typed effects, settlement rules, endings, package lineage, and review receipts.

Hodor remains authoritative for project IDs, database IDs, canvas coordinates after user edits, production status, assets, storyboards, images, videos, and composition tasks.

A Hodor chat edit creates a new Bran input revision or structured patch, recompiles it, and exports a new target. Direct database edits do not silently become Bran canon.
