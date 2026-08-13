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

Apply these gates when a Hodor target is exported.

| Hodor target gate | Default |
| --- | --- |
| Entry node | Exactly one resolved entry |
| Node scripts | 100% non-empty and within the `o_script` contract |
| Branch targets | 100% resolved |
| State variables | 100% mapped to supported Hodor types and safe identifiers |
| Conditions | 100% derived fields expanded and source paths resolved |
| Effects | 100% operation/type compatible |
| Reachability | Every node reachable from the entry |
| Ending nodes | At least 2, with no outgoing edges |
| Target freshness | Target hash matches current content and Bran artifact hash |
| Import bindings | 100% of nodes, edges, variables, and scripts bound |
| Hodor validation | `valid: true` with zero issues |
| Source event grounding | Every accepted event has a resolved source span and causal references |
| Derived state executability | Every derived field has a machine-readable expression |
| Compile receipt freshness | Compiler artifact hash matches the current compiled package |
| Runtime authority | Natural language resolves to a typed action before state mutation |
| Production authority | Asset-slot fulfillment cannot mutate narrative world state or settlement |

The settlement renderer must preserve independent truths. A failed broadcast does not imply failed protection. An authorization revocation invalidates dependent draft signatures. A draft revision invalidates signatures bound to an older hash.

For human testing, use new players and seat-visible information. Track whether players can explain the crisis, their unique leverage, the cost of the current choice, and the next unlock. Machine novelty metrics support this test and do not replace it.
