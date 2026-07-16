# Bran

[简体中文](README.zh-CN.md)

Bran is an Agent Skill for compiling and auditing executable branching-story packages for replayable, multi-seat AI games.

It is designed for a recurring production failure: a story package may contain many branches on paper while giving players the same strategy, the same dominant choice, or an ending that contradicts the final world state. Bran turns narrative intent into typed actions and checks the resulting behavior.

```text
source and world rules
        |
        v
canon + characters + seat visibility
        |
        v
typed actions + recipe overrides + costs + counterplay
        |
        v
deterministic reducer -> world state -> settlement receipt -> ending projection
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
```

After a direct skill install, restart Codex so it can discover the new skill.

## Install manually

```bash
git clone https://github.com/JonathonGuo777/bran.git
mkdir -p ~/.codex/skills
cp -R bran/plugins/bran/skills/bran ~/.codex/skills/bran
```

The skill follows the portable `SKILL.md` convention. Other compatible agents can install the same `plugins/bran/skills/bran` directory in their own skill path.

## Use

Invoke Bran with a concrete source boundary and target package:

```text
Use $bran to compile this story source into a two-human, two-Agent replayable handoff package.
```

```text
Use $bran to audit this handoff. Recompute action-graph distance, settlement results, Agent information gain, waiting interactions, and receipt freshness.
```

For packages that follow Bran's artifact contract, run the independent auditor directly:

```bash
node plugins/bran/skills/bran/scripts/audit-package.mjs /absolute/path/to/upstream_handoff
```

The auditor exits with code `0` on a pass and code `1` when a gate fails. Its JSON output can be stored as a CI artifact or release receipt.

## Repository layout

```text
.
├── .agents/plugins/marketplace.json
├── plugins/bran/
│   ├── .codex-plugin/plugin.json
│   └── skills/bran/
│       ├── SKILL.md
│       ├── agents/openai.yaml
│       ├── references/
│       └── scripts/audit-package.mjs
├── scripts/validate-repo.mjs
└── README.md
```

The public repository and the runtime skill are deliberately separated. Repository documentation, contribution files, and CI stay outside the skill folder so the installed skill remains focused.

## Artifact contract

Bran expects a versioned handoff with source provenance, canon and visibility partitions, character contracts, scene scripts, typed choice contracts, recipe overrides, baseline actions, a state-field registry, Agent evaluation fixtures, waiting interactions, settlement rules, carryover contracts, replay traces, and a fresh quality receipt.

The exact responsibilities and default gates live in:

- [`artifact-contract.md`](plugins/bran/skills/bran/references/artifact-contract.md)
- [`quality-gates.md`](plugins/bran/skills/bran/references/quality-gates.md)
- [`skill-adaptation.md`](plugins/bran/skills/bran/references/skill-adaptation.md)

## Design boundary

Machine gates can prove internal consistency, mechanical variation, reachability, and reproducibility. They cannot prove that a game is emotionally engaging. Bran therefore treats fresh-player, seat-visible playtests as a separate release requirement and asks teams to report machine-validated mechanics and human-validated fun independently.

## Why the name

Bran represents the script-generation layer of the Hodor content system. Its job is to see the available timelines, compile the branch that can actually occur, and hand a stable story package to the downstream Weirwood media pipeline.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports should include the smallest reproducible package, the auditor output, and the expected state or ending.

## License

MIT. See [LICENSE](LICENSE).
