# Contributing

Contributions should preserve Bran's central property: every declared narrative difference must compile into an observable change in player information, action availability, cost, counterplay, world state, carryover, or ending reachability.

## Before opening a pull request

Run the repository validator:

```bash
node scripts/validate-repo.mjs
```

If the change affects the package contract or auditor, also run the auditor against a complete fixture:

```bash
node plugins/bran/skills/bran/scripts/audit-package.mjs /absolute/path/to/upstream_handoff
```

For media-production contract changes, run the production regression test and audit a complete handoff:

```bash
node scripts/test-audit-production.mjs
node plugins/bran/skills/bran/scripts/audit-production-package.mjs /absolute/path/to/upstream_handoff
```

The pull request should explain which contract changed, why the old behavior was insufficient, and which trace or golden vector proves the new behavior.

## Scope

Good contributions include new deterministic checks, clearer artifact contracts, portable schema adapters, evidence-grounded decision tests, settlement contradiction vectors, and playtest protocols that preserve seat visibility.

Keep project-specific story text and private source material outside this repository. Fixtures must use original or redistributable content and must not contain API keys, personal paths, production data, or unpublished scripts.
