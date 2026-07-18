#!/usr/bin/env node
import process from 'node:process'
import { auditPackage } from './lib/auditor.mjs'

const args = process.argv.slice(2)
const levelIndex = args.indexOf('--level')
const level = levelIndex >= 0 ? args[levelIndex + 1] : undefined
const root = args.find((argument, index) => !argument.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--'))) ?? '.'

if (level && !['compile', 'release'].includes(level)) {
  console.error(JSON.stringify({ result: 'fail', diagnostics: [{ code: 'CLI_LEVEL_INVALID', severity: 'error', message: `Unknown audit level: ${level}` }] }, null, 2))
  process.exit(1)
}

const result = auditPackage({ root, level })
console.log(JSON.stringify(result, null, 2))
process.exit(result.result === 'pass' ? 0 : 1)
