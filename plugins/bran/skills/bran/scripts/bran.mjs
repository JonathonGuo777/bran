#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { auditPackage } from './lib/auditor.mjs'
import { readJson, resolvePackageDirectory } from './lib/common.mjs'
import { compileBundle } from './lib/compiler.mjs'
import { evaluateSettlement } from './lib/expressions.mjs'
import {
  applyHodorTarget,
  buildHodorTarget,
  diffHodorTargets,
  syncHodorTarget,
  verifyHodorReceipt
} from './lib/hodor.mjs'
import { reviewPackage } from './lib/review.mjs'
import { diffPackages } from './lib/diff.mjs'

const HELP = `Bran narrative compiler

Usage:
  bran compile <bran-input.json> --out <handoff-directory>
  bran audit <handoff-directory> [--level compile|release]
  bran review <handoff-directory> --stage <stage> --status accepted|rejected --reviewer <name> [--note <text>]
  bran diff <base-handoff> <candidate-handoff>
  bran settle <handoff-directory> --state <world-state.json>
  bran export-hodor <handoff-directory> --project-id <number> --out <hodor-target.json> [--recipe <recipe-id>]
  bran diff-hodor <base-hodor-target.json> <candidate-hodor-target.json>
  bran apply-hodor <hodor-target.json> --base-url <hodor-origin> --receipt <hodor-import-receipt.json> [--token-env <environment-variable>]
  bran sync-hodor <base-hodor-target.json> <candidate-hodor-target.json> --base-receipt <base-receipt.json> --base-url <hodor-origin> --receipt <candidate-receipt.json> [--token-env <environment-variable>]
  bran verify-hodor <hodor-target.json> --receipt <hodor-import-receipt.json>
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
  if (command === 'export-hodor') {
    const root = firstPositional() ?? '.'
    const outputPath = valueAfter('--out')
    const projectId = Number(valueAfter('--project-id'))
    if (!outputPath || !Number.isInteger(projectId) || projectId <= 0) {
      throw new Error('export-hodor needs <handoff-directory>, --project-id <positive integer>, and --out <hodor-target.json>.')
    }
    const result = buildHodorTarget({
      root,
      projectId,
      recipeId: valueAfter('--recipe') ?? 'baseline',
      outputPath
    })
    console.log(JSON.stringify(result.result === 'pass'
      ? {
          result: result.result,
          outputPath: result.outputPath,
          targetHash: result.targetHash,
          counts: result.counts,
          diagnostics: result.diagnostics
        }
      : result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  if (command === 'verify-hodor') {
    const targetPath = firstPositional()
    const receiptPath = valueAfter('--receipt')
    if (!targetPath || !receiptPath) throw new Error('verify-hodor needs <hodor-target.json> and --receipt <hodor-import-receipt.json>.')
    const result = verifyHodorReceipt({ targetPath, receiptPath })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  if (command === 'diff-hodor') {
    const [baseTargetPath, targetPath] = positionals()
    if (!baseTargetPath || !targetPath) throw new Error('diff-hodor needs <base-hodor-target.json> and <candidate-hodor-target.json>.')
    const result = diffHodorTargets({ baseTargetPath, targetPath })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  if (command === 'apply-hodor') {
    const targetPath = firstPositional()
    const baseUrl = valueAfter('--base-url')
    const receiptPath = valueAfter('--receipt')
    const tokenEnvironment = valueAfter('--token-env') ?? 'HODOR_TOKEN'
    if (!targetPath || !baseUrl || !receiptPath) throw new Error('apply-hodor needs <hodor-target.json>, --base-url <hodor-origin>, and --receipt <hodor-import-receipt.json>.')
    const result = await applyHodorTarget({
      targetPath,
      baseUrl,
      token: process.env[tokenEnvironment],
      receiptPath
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  if (command === 'sync-hodor') {
    const [baseTargetPath, targetPath] = positionals()
    const baseReceiptPath = valueAfter('--base-receipt')
    const baseUrl = valueAfter('--base-url')
    const receiptPath = valueAfter('--receipt')
    const tokenEnvironment = valueAfter('--token-env') ?? 'HODOR_TOKEN'
    if (!baseTargetPath || !targetPath || !baseReceiptPath || !baseUrl || !receiptPath) {
      throw new Error('sync-hodor needs <base-hodor-target.json>, <candidate-hodor-target.json>, --base-receipt <base-receipt.json>, --base-url <hodor-origin>, and --receipt <candidate-receipt.json>.')
    }
    const result = await syncHodorTarget({
      baseTargetPath,
      targetPath,
      baseReceiptPath,
      baseUrl,
      token: process.env[tokenEnvironment],
      receiptPath
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.result === 'pass' ? 0 : 1)
  }
  throw new Error(`Unknown command: ${command}`)
} catch (error) {
  console.error(JSON.stringify({ result: 'fail', diagnostics: [{ code: 'CLI_FAILED', severity: 'error', message: error.message }] }, null, 2))
  process.exit(1)
}
