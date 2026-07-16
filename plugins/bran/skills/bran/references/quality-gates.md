# Quality gates

Use these defaults unless the user supplies stricter thresholds.

| Gate | Default |
| --- | --- |
| Mechanically changed scenes per recipe | At least 3 |
| Adjacent compiled action-graph Jaccard distance | At least 0.30 |
| Fixed decision-cue reuse | At most 0.40 |
| Universal dominant strategy | None within a recipe |
| Evidence statements before a decision | At least 2 per seat decision |
| Agent effective information gain | At least 0.80, target 1.00 for fixtures |
| Waiting contracts | One per scene and seat, at least 3 local actions, recipe-specific state and risk summary |
| Settlement golden vectors | 100% pass |
| State-effect paths | 100% registered |
| Canon references | 100% resolved |
| Distinct carryover consequence classes | At least 4 |
| Deterministic simulated runs | At least 3 per recipe |
| Scene coverage per simulated run | Every scene in order |
| Merge receipts | Both seats pass every scene |
| Invalid precondition or cost runs | 0 |
| Ending reachability | Every declared target equals the reducer result; package covers all intended ending classes |
| Draft and escrow integrity | Non-empty draft hash; signatures match; active escrow has same-revision signatures and a cost receipt |
| Quality receipt freshness | Artifact hash matches current package |

The settlement renderer must preserve independent truths. A failed broadcast does not imply failed protection. An authorization revocation invalidates dependent draft signatures. A draft revision invalidates signatures bound to an older hash.

For human testing, use new players and seat-visible information. Track whether players can explain the crisis, their unique leverage, the cost of the current choice, and the next unlock. Machine novelty metrics support this test and do not replace it.
