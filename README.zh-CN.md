# Bran

[English](README.md)

Bran 是一个面向可复玩、多席位 AI 游戏的 Agent Skill，用于编译和审计可执行的分支剧本包。

它处理一种常见的生产问题：剧本在文档里看起来分支很多，玩家实际进入后仍会走向相同策略、相同支配选项，或者结局文案与最终世界状态互相矛盾。Bran 会把叙事意图转成带前置条件、状态效果、成本和反制的行动，再检查这些行动是否真的构成了不同玩法。

```text
原文与世界规则
      |
      v
正典事实 + 角色 + 席位可见性
      |
      v
类型化行动 + 周目配方 + 成本 + 反制
      |
      v
确定性结算器 -> 世界状态 -> 结算回执 -> 结局投影
```

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

符合 Bran 产物契约的剧本包可以直接运行独立审计器：

```bash
node plugins/bran/skills/bran/scripts/audit-package.mjs /absolute/path/to/upstream_handoff
```

审计通过时退出码为 `0`，任何门禁失败时退出码为 `1`。JSON 输出可以进入 CI 或版本发布回执。

## 产物契约

Bran 要求交接包包含版本与来源、正典事实和可见性分区、角色契约、分幕脚本、选择契约、周目覆盖、基线行动、状态字段注册表、Agent 评测样例、等待交互、结算规则、跨局后果、试玩轨迹和与当前产物哈希一致的质量回执。

详细定义位于：

- [`artifact-contract.md`](plugins/bran/skills/bran/references/artifact-contract.md)
- [`quality-gates.md`](plugins/bran/skills/bran/references/quality-gates.md)
- [`skill-adaptation.md`](plugins/bran/skills/bran/references/skill-adaptation.md)

## 能力边界

机器门禁可以验证内部一致性、机制差异、结局可达性和复现能力。游戏是否有情绪张力仍需真人试玩判断。Bran 因此要求使用全新玩家和严格的席位可见信息进行测试，并分别报告“机器验证过的机制”与“真人验证过的乐趣”。

## 命名

Bran 是 Hodor 内容系统中的剧本生成层。它负责展开和校验可发生的时间线，再把稳定的剧本包交给下游 Weirwood 媒体生产管线。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交问题时请附带最小可复现剧本包、审计器输出和预期状态或结局。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
