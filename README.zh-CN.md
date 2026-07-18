# Bran

[English](README.md)

Bran 是一个面向可复玩 AI 游戏的 Agent Skill 和零依赖 Node.js 编译器，用于构建和审计可执行的分支剧本包。

它处理一种常见的生产问题：剧本在文档里看起来分支很多，玩家实际进入后仍会走向相同策略、相同支配选项，或者结局文案与最终世界状态互相矛盾。Bran 会把叙事意图转成带前置条件、状态效果、成本和反制的行动，再检查这些行动是否真的构成了不同玩法。

```text
原文 + 已审核 SourceEvent 事件账本
      |
      v
BranInputBundle：正典 + 角色 + 场景 + 世界规则
      |
      v
bran compile -> NarrativePackage + RuntimeContract + ProductionRequest
      |
      v
确定性结算器 -> 世界状态 -> 结算回执 -> 结局投影
```

Bran 是 Hodor 的叙事编译层，负责原文 grounding、故事与交互结构、类型化行动、世界状态规则、角色 Agent 边界和确定性结算。下游素材团队接收语义化资产槽位，可以回填素材引用，但不能修改叙事状态和结局规则。

## Bran 会检查什么

- 每套周目配方至少改动三幕的决策机制。
- 每个行动都具有席位、前置条件、效果、成本、反制和公开回声。
- 证据选择会说明已知事实、证据边界以及每个选项产生的状态变化。
- Agent 回答必须提供可用事实、准确的信息缺口、风险、条件或下一步行动。
- 等待中的玩家仍能看到当前状态、执行本席动作并理解下一项解锁。
- 结局文字由最终世界状态投影生成，不依赖固定台词猜测结果。
- 确定性试玩轨迹覆盖全部场景、汇合、成本、签名、结算和跨局后果。

默认门禁包括：相邻周目编译后行动图 Jaccard 距离不低于 `0.30`，固定决策提示复用率不高于 `0.40`，状态写入路径全部注册，结算黄金向量通过率为 `100%`。

## 在 Codex 中安装

将仓库添加为插件 marketplace：

```bash
codex plugin marketplace add JonathonGuo777/bran
```

重启 ChatGPT 桌面端，在 Plugins 中选择 Bran marketplace，然后安装 Bran。

如果只想安装 Agent Skill，可以在 Codex 中输入：

```text
$skill-installer install https://github.com/JonathonGuo777/bran/tree/main/plugins/bran/skills/bran
```

直接安装 skill 后需要重启 Codex，使其重新发现本地技能。

## 手动安装

```bash
git clone https://github.com/JonathonGuo777/bran.git
mkdir -p ~/.codex/skills
cp -R bran/plugins/bran/skills/bran ~/.codex/skills/bran
```

Bran 遵循可移植的 `SKILL.md` 约定。其他兼容 Agent 也可以将 `plugins/bran/skills/bran` 放入自己的 skill 目录。

## 使用

给 Bran 明确的原文边界和目标剧本包：

```text
使用 $bran，把这份故事原文编译成一个 2 Human 2 Agent、可以多周目复玩的上游交接包。
```

```text
使用 $bran 审计这个交接包，重新计算行动图距离、结算结果、Agent 信息增益、等待交互和质量回执新鲜度。
```

将已审核的结构化输入编译成剧本包：

```bash
node plugins/bran/skills/bran/scripts/bran.mjs compile \
  plugins/bran/skills/bran/fixtures/harbor-signal/bran-input.json \
  --out /tmp/harbor-signal-handoff
```

审计编译产物并独立复算规则：

```bash
node plugins/bran/skills/bran/scripts/bran.mjs audit \
  /tmp/harbor-signal-handoff \
  --level compile
```

为一个阶段记录绑定当前产物哈希的作者审核：

```bash
node plugins/bran/skills/bran/scripts/bran.mjs review \
  /tmp/harbor-signal-handoff \
  --stage narrative \
  --status accepted \
  --reviewer author-name
```

可审核阶段包括 `source-events`、`canon`、`characters`、`narrative`、`agents`、`runtime` 和 `production-request`。全部阶段的最新审核均为接受后，生命周期才会变成 `reviewed`。

按照稳定 ID 比较两个不可变剧本包版本：

```bash
node plugins/bran/skills/bran/scripts/bran.mjs diff \
  /absolute/path/to/base-handoff \
  /absolute/path/to/candidate-handoff
```

diff 会报告事件、角色、场景、行动、周目配方和结局的新增、删除、修改与未变数量，同时检查版本 lineage 和破坏性删除。

用剧本包中的声明式规则结算一个世界状态：

```bash
node plugins/bran/skills/bran/scripts/bran.mjs settle \
  /tmp/harbor-signal-handoff \
  --state /absolute/path/to/world-state.json
```

符合 Bran 产物契约的剧本包可以直接运行独立审计器：

```bash
node plugins/bran/skills/bran/scripts/audit-package.mjs /absolute/path/to/upstream_handoff
```

审计通过时退出码为 `0`，任何门禁失败时退出码为 `1`。JSON 输出可以进入 CI 或版本发布回执。

## 剧本包生命周期

- `compiled`：来源引用、类型化行动、状态路径、派生表达式、结算向量、权限边界和产物哈希通过静态审计。
- `reviewed`：作者已接受事件账本、正典变化、角色边界、可玩场景和素材需求。
- `release`：确定性轨迹、Agent 测试、跨局后果、质量回执和真人试玩证据也通过。

编译阶段不会伪造发布证据。创作、确定性编译、运行时执行和人工批准因此能够分别审查。

每次作者审核都绑定该阶段当前产物的哈希。已经审核的文件发生变化后，review receipt 会失败，直到该阶段重新审核通过。

剧本包版本保持不可变。回滚时选择旧版本；分叉或修改会编译成新版本，并通过 `lineage.parentPackageVersion` 关联父版本。

`0.2.0` 之前的剧本包可能只有文字形式的派生状态公式。使用通用结算审计器前，需要为每个派生字段补充机器可执行的 `expression`。Bran 会拒绝自身无法独立复算的结算逻辑。

## 核心合同

- `SourceEvent`：记录原文位置、参与者、行动、结果、因果、canon 状态、可信度和审核状态。
- `BranInputBundle`：经过审核的编译器输入。
- `NarrativePackage`：供审计器和运行时接入使用的稳定中间表示。
- `RuntimeContract`：定义类型化行动，以及 `WorldEvent`、`RelationshipEventCandidate`、`ContentFeedback` 事件信封。
- `ProductionRequest`：只声明语义化资产槽位，不包含图片、视频、音频、模型或生成任务实现。

## 产物契约

Bran 要求交接包包含版本与来源、正典事实和可见性分区、角色契约、分幕脚本、选择契约、周目覆盖、基线行动、状态字段注册表、Agent 评测样例、等待交互、结算规则、跨局后果、试玩轨迹和与当前产物哈希一致的质量回执。

详细定义位于：

- [`compiler-contract.md`](plugins/bran/skills/bran/references/compiler-contract.md)
- [`artifact-contract.md`](plugins/bran/skills/bran/references/artifact-contract.md)
- [`quality-gates.md`](plugins/bran/skills/bran/references/quality-gates.md)
- [`skill-adaptation.md`](plugins/bran/skills/bran/references/skill-adaptation.md)

## 能力边界

机器门禁可以验证内部一致性、机制差异、结局可达性和复现能力。游戏是否有情绪张力仍需真人试玩判断。Bran 因此要求使用全新玩家和严格的席位可见信息进行测试，并分别报告“机器验证过的机制”与“真人验证过的乐趣”。

编译架构参考了 [Ink](https://github.com/inkle/ink) 的“创作源文件、编译中间产物、运行时”分层，诊断与节点元数据参考了 [Yarn Spinner](https://github.com/YarnSpinnerTool/YarnSpinner)，可序列化规则思路参考了 [JsonLogic](https://github.com/jwadhams/json-logic-js)。Bran 使用自己的数据合同和零依赖求值器，没有复制这些项目的源码。

## 命名

Bran 是 Hodor 内容系统中的剧本生成层。它负责展开和校验可发生的时间线，再把稳定的剧本包交给下游 Weirwood 媒体生产管线。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交问题时请附带最小可复现剧本包、审计器输出和预期状态或结局。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
