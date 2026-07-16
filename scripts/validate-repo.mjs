import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const failures = []
const requireFile = relativePath => {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) failures.push(`missing ${relativePath}`)
  return absolutePath
}

const pluginPath = requireFile('plugins/bran/.codex-plugin/plugin.json')
const marketplacePath = requireFile('.agents/plugins/marketplace.json')
const skillPath = requireFile('plugins/bran/skills/bran/SKILL.md')

for (const relativePath of [
  'plugins/bran/skills/bran/agents/openai.yaml',
  'plugins/bran/skills/bran/references/artifact-contract.md',
  'plugins/bran/skills/bran/references/media-production-contract.md',
  'plugins/bran/skills/bran/references/quality-gates.md',
  'plugins/bran/skills/bran/references/skill-adaptation.md',
  'plugins/bran/skills/bran/scripts/audit-package.mjs',
  'plugins/bran/skills/bran/scripts/audit-production-package.mjs',
  'plugins/bran/skills/bran/LICENSE.txt',
  'scripts/test-audit-production.mjs',
  'README.md',
  'README.zh-CN.md',
  'LICENSE'
]) requireFile(relativePath)

let plugin
let marketplace
try {
  plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'))
  marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'))
} catch (error) {
  failures.push(`invalid JSON: ${error.message}`)
}

if (plugin) {
  if (plugin.name !== 'bran') failures.push('plugin name must be bran')
  if (plugin.skills !== './skills/') failures.push('plugin skills path must be ./skills/')
  if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? '')) failures.push('plugin version must use semver')
  if (!plugin.interface?.defaultPrompt?.includes('$bran')) failures.push('plugin default prompt must mention $bran')
}

if (marketplace) {
  const entry = marketplace.plugins?.find(item => item.name === 'bran')
  if (!entry) failures.push('marketplace has no bran entry')
  if (entry?.source?.path !== './plugins/bran') failures.push('marketplace bran source must be ./plugins/bran')
  if (!entry?.policy?.installation || !entry?.policy?.authentication) failures.push('marketplace policy is incomplete')
}

if (fs.existsSync(skillPath)) {
  const skill = fs.readFileSync(skillPath, 'utf8')
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? ''
  if (!/^name:\s*bran\s*$/mu.test(frontmatter)) failures.push('SKILL.md frontmatter name must be bran')
  if (!/^description:\s*\S.+$/mu.test(frontmatter)) failures.push('SKILL.md frontmatter needs a description')
}

if (failures.length) {
  console.error(JSON.stringify({ result: 'fail', failures }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({
  result: 'pass',
  plugin: plugin.name,
  version: plugin.version,
  marketplace: marketplace.name
}, null, 2))
