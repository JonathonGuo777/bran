# Adapting narrative skills

Use character-distillation workflows for identity, Want, Need, fear, error habit, relationship leverage, voice, source confidence, and OOC constraints. Preserve their evidence and uncertainty fields.

Use novel-planning workflows for pressure curves, scene intent, conflict escalation, reversal, and character decision consistency. Count a beat as playable only when a player action changes information, resources, permissions, relationships, or world state.

Use adversarial story review for causality, dialogue differentiation, false choices, repeated beats, degeneration, and templated prose. Run its punctuation and AI-pattern checks on player-facing text when available.

Convert all useful outputs into game contracts:

| Narrative output | Game contract |
| --- | --- |
| Want and Need | Goal, temptation, cost, repair action |
| Relationship pressure | Proposal, refusal, counterproposal, trust evidence |
| Character arc beat | Player action and state effect |
| Mystery clue | Visible evidence, limit, decision unlock |
| Emotional consequence | Carryover action, resource, visibility, or reachability delta |
| Ending paragraph | Settlement truth fragments |

Do not copy chapter-scoring formulas into a live game without adaptation. Measure action density, cross-seat dependency, evidence sufficiency, strategic distance, Agent information gain, and settlement consistency.

## Adapt production workflows

Use structured-output workflows for script division, entity extraction, dialogue extraction, semantic shot defaults, and consistency checks. Prefer native schema-constrained output. Normalize common field drift, validate against a closed schema, and allow one correction retry when required entities or output rules are missing. Cache by source input hash, extractor schema version, and extractor profile hash; invalidate the result when any input changes.

Keep AI extraction provisional. Write extracted entities and dialogue into candidate records, then require `linked / ignored` for asset candidates and `accepted / ignored` for dialogue candidates before the shot can become prepared. Reopen a candidate when its linked entity or dialogue line is removed.

Translate production concepts into Bran contracts:

| Production output | Bran media contract |
| --- | --- |
| Script division | Stable chapter and shot ordering with narrative scene references |
| Extracted character, scene, prop, or costume | Reviewable candidate, then reusable entity asset |
| Extracted dialogue | Reviewable dialogue candidate, then stable dialogue line |
| Camera suggestion | Shot semantics: framing, angle, movement, duration |
| Action list | Ordered action beats with `trigger / peak / aftermath` phase hints |
| Prompt preview | Derived preview with warnings, quality checks, and debug context |
| Model call | Submission payload plus template, model, reference, and input hashes |
| Generated image or video | Media asset with task provenance and selection state |
| Timeline or delivery file | Export manifest with ordered accepted media and integrity hash |

Keep the production extension optional. A branching-story audit must continue to work when no media files exist. Once `media-production-manifest.json` is present, require the full production contract and run its independent auditor.
