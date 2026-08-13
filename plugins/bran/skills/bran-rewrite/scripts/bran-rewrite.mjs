#!/usr/bin/env node
import fs from 'node:fs'
import process from 'node:process'
import {
  auditRewriteWorkspace,
  buildCleanRoomBrief,
  extractSource,
  generateRewrite,
  ingestSource,
  sealStoryDna,
  workspaceStatus
} from './lib/pipeline.mjs'

const HELP = `Bran Rewrite

Usage:
  bran-rewrite ingest <source|-> --out <workspace> --rights <status> --rights-basis <text> [--format text|markdown|fountain] [--title <title>] [--language <code>] [--source-id <id>] [--jurisdiction <name>] [--verification-note <text>] [--rights-evidence <ref>]
  bran-rewrite extract <workspace> [--input <native-ledger.json>] [--scriptbreak <export.json>] [--langextract <result.json|jsonl>]
  bran-rewrite seal-dna <workspace> --input <story-dna.json>
  bran-rewrite brief <workspace>
  bran-rewrite generate <workspace> --draft <rewrite-draft.json>
  bran-rewrite audit <workspace>
  bran-rewrite status <workspace>

Rights statuses:
  owned | licensed | public-domain | internal-research | unknown
`

const args = process.argv.slice(2)
const command = args.shift()
const valueAfter = flag => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const firstPositional = () => args.find((argument, index) => !argument.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')))

const emit = value => {
  console.log(JSON.stringify(value, null, 2))
  process.exit(value.result === 'pass' ? 0 : 1)
}

try {
  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log(HELP)
    process.exit(0)
  }
  if (command === 'ingest') {
    const sourcePath = firstPositional()
    const outputRoot = valueAfter('--out')
    const rightsStatus = valueAfter('--rights')
    const rightsBasis = valueAfter('--rights-basis')
    if (!sourcePath || !outputRoot || !rightsStatus || !rightsBasis) throw new Error('ingest needs <source>, --out, --rights, and --rights-basis.')
    const pipedSource = sourcePath === '-' ? fs.readFileSync(0, 'utf8') : undefined
    emit(ingestSource({
      sourcePath: sourcePath === '-' ? undefined : sourcePath,
      sourceText: pipedSource,
      sourceFormat: valueAfter('--format') ?? 'text',
      sourceName: valueAfter('--title') ?? 'pasted-source',
      outputRoot,
      rightsStatus,
      rightsBasis,
      title: valueAfter('--title'),
      language: valueAfter('--language') ?? 'en',
      sourceId: valueAfter('--source-id') ?? 'SRC-001',
      jurisdiction: valueAfter('--jurisdiction') ?? '',
      verificationNote: valueAfter('--verification-note') ?? '',
      evidenceRef: valueAfter('--rights-evidence') ?? ''
    }))
  }
  if (command === 'extract') {
    const workspace = firstPositional()
    if (!workspace) throw new Error('extract needs <workspace>.')
    emit(extractSource({
      workspace,
      inputPath: valueAfter('--input'),
      scriptBreakPath: valueAfter('--scriptbreak'),
      langExtractPath: valueAfter('--langextract')
    }))
  }
  if (command === 'seal-dna') {
    const workspace = firstPositional()
    const inputPath = valueAfter('--input')
    if (!workspace || !inputPath) throw new Error('seal-dna needs <workspace> and --input <story-dna.json>.')
    emit(sealStoryDna({ workspace, inputPath }))
  }
  if (command === 'brief') {
    const workspace = firstPositional()
    if (!workspace) throw new Error('brief needs <workspace>.')
    emit(buildCleanRoomBrief({ workspace }))
  }
  if (command === 'generate') {
    const workspace = firstPositional()
    const draftPath = valueAfter('--draft')
    if (!workspace || !draftPath) throw new Error('generate needs <workspace> and --draft <rewrite-draft.json>.')
    emit(generateRewrite({ workspace, draftPath }))
  }
  if (command === 'audit') {
    const workspace = firstPositional()
    if (!workspace) throw new Error('audit needs <workspace>.')
    emit(auditRewriteWorkspace({ workspace, writeReceipt: true }))
  }
  if (command === 'status') {
    const workspace = firstPositional()
    if (!workspace) throw new Error('status needs <workspace>.')
    emit(workspaceStatus(workspace))
  }
  throw new Error(`Unknown command: ${command}`)
} catch (error) {
  emit({
    result: 'fail',
    diagnostics: [{ code: 'BRAN_REWRITE_CLI_FAILED', severity: 'error', message: error.message }]
  })
}
