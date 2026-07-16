# Artifact contract

The minimum package contains these responsibilities. Filenames may vary when the manifest maps them explicitly.

| Responsibility | Required content |
| --- | --- |
| Source manifest | Version, sources, rights, artifact index, counts, compile status |
| Canon and visibility | Stable facts, source references, public and private partitions, new-player briefing |
| Character contracts | Want, Need, conflict, voice, OOC boundaries, scene arc, provenance |
| Relationship pressure | Surface conflict, deep pressure, leverage, cost, visible change evidence |
| Scene scripts | Scene and beat IDs, views, world text, actions, merge gates, waiting references |
| Choice contracts | Evidence, belief, gain, cost, uncertainty, effect, cross-seat impact, counterplay |
| Recipe overrides | At least three changed scenes, structured actions, strategies, ending reachability |
| Baseline actions | Complete-scene fallback actions, completion profiles, costs, merge contribution for both seats |
| State registry | Every writable path, type, default, authorized writer, derived-field rules |
| Evidence decisions | Prompt, visible evidence, limits, options, state effects, unlocks, feedback |
| Agent contract | Knowledge boundary, refusal boundary, response schema, information-gain tests |
| Waiting interactions | Blocking condition, visible state, local actions, amendment window, next unlock, recipe-specific risk summary |
| Settlement | Rule priority, reason codes, truth projection, golden vectors |
| Carryover | Condition, consequence class, action/resource/visibility/reachability changes, revoke condition |
| Replay evidence | Complete-scene deterministic traces, cost receipts, merge receipts, actual settlement, state hashes |
| Quality receipt | Machine-generated status, checks, blockers, warnings, execution evidence, current artifact hash |

Stable IDs must survive downstream asset production. Public world text uses third-person factual narration. Operational instructions stay in action objects.

## Optional media-production extension

Add a `production/` directory only when the handoff continues into storyboard preparation, image or video generation, media selection, or export. Its files and status semantics are defined in [media-production-contract.md](media-production-contract.md).

The extension must preserve the narrative package as its source of truth. Reference narrative scene, action, character, and canon IDs instead of copying or renaming them. Keep production-specific state outside `WorldState`; generation tasks and media selection cannot rewrite narrative settlement.
