#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { auditPackage } from './lib/auditor.mjs'
import { readJson, resolvePackageDirectory } from './lib/common.mjs'
import { compileBundle } from './lib/compiler.mjs'
import { evaluateSettlement } from './lib/expressions.mjs'
import { reviewPackage } from './lib/review.mjs'
import { diffPackages } from './lib/diff.mjs'

const HELP = `Bran narrative compiler

Usage:
  bran compile <bran-input.json> --out <handoff-directory>
  bran audit <handoff-directory> [--level compile|release]
  bran review <handoff-directory> --stage <stage> --status accepted|rejected --reviewer <name> [--note <text>]
  bran diff <base-handoff> <candidate-handoff>
  bran settle <handoff-directory> --state <world-state.json>
`

const args = process.argv.slice(2)
const command = args.shift()
const valueAfter = flag => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const firstPositional = () => args.find((argument, index) => !argument.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')))
const positionals = () => args.filter((argument, index) => !argument.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')))

try {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(HELP)
    process.exit(0)
  }
  if (command === 'compile') {
    const inputPath = firstPositional()
    const outputRoot = valueAfter('--out')
    if (!inputPath || !outputRoot) throw new Error('compile needs <bran-input.json> and --out <handoff-directory>.')
    const result = compileBundle({ inputPath, outputRoot })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  if (command === 'audit') {
    const root = firstPositional() ?? '.'
    const level = valueAfter('--level')
    if (level && !['compile', 'release'].includes(level)) throw new Error(`Unknown audit level: ${level}`)
    const result = auditPackage({ root, level })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  if (command === 'review') {
    const root = firstPositional() ?? '.'
    const result = reviewPackage({
      root,
      stage: valueAfter('--stage'),
      status: valueAfter('--status'),
      reviewer: valueAfter('--reviewer'),
      note: valueAfter('--note') ?? ''
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }
  if (command === 'diff') {
    const [baseRoot, candidateRoot] = positionals()
    if (!baseRoot || !candidateRoot) throw new Error('diff needs <base-handoff> and <candidate-handoff>.')
    console.log(JSON.stringify(diffPackages({ baseRoot, candidateRoot }), null, 2))
    process.exit(0)
  }
  if (command === 'settle') {
    const root = firstPositional() ?? '.'
    const statePath = valueAfter('--state')
    if (!statePath || !fs.existsSync(statePath)) throw new Error('settle needs --state <world-state.json>.')
    const packageDir = resolvePackageDirectory(root)
    const diagnostics = []
    const result = evaluateSettlement(
      readJson(path.resolve(statePath)),
      readJson(path.join(packageDir, 'settlement-rules.json')),
      readJson(path.join(packageDir, 'state-field-registry.json')),
      diagnostics
    )
    const output = { result: diagnostics.some(item => item.severity === 'error') ? 'fail' : 'pass', endingCode: result.endingCode, reasonCodes: result.reasonCodes, diagnostics }
    console.log(JSON.stringify(output, null, 2))
    process.exit(output.result === 'pass' ? 0 : 1)
  }
  throw new Error(`Unknown command: ${command}`)
} catch (error) {
  console.error(JSON.stringify({ result: 'fail', diagnostics: [{ code: 'CLI_FAILED', severity: 'error', message: error.message }] }, null, 2))
  process.exit(1)
}
