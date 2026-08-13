#!/usr/bin/env node
import process from 'node:process'
import { compileBundle } from './lib/compiler.mjs'

const args = process.argv.slice(2)
const outputIndex = args.indexOf('--out')
const outputRoot = outputIndex >= 0 ? args[outputIndex + 1] : undefined
const inputPath = args.find((argument, index) => !argument.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')))

if (!inputPath || !outputRoot) {
  console.error(JSON.stringify({
    result: 'fail',
    diagnostics: [{
      code: 'CLI_ARGUMENTS_INVALID',
      severity: 'error',
      message: 'Usage: compile-package.mjs /absolute/path/to/bran-input.json --out /absolute/path/to/handoff'
    }]
  }, null, 2))
  process.exit(1)
}

try {
  const result = compileBundle({ inputPath, outputRoot })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.result === 'pass' ? 0 : 1)
} catch (error) {
  console.error(JSON.stringify({ result: 'fail', diagnostics: [{ code: 'COMPILE_FAILED', severity: 'error', message: error.message }] }, null, 2))
  process.exit(1)
}
