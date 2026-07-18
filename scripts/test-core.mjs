import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPackage } from '../plugins/bran/skills/bran/scripts/lib/auditor.mjs'
import { artifactHash, readJson, readJsonl, writeJson, writeJsonl } from '../plugins/bran/skills/bran/scripts/lib/common.mjs'
import { compileBundle, validateInput } from '../plugins/bran/skills/bran/scripts/lib/compiler.mjs'
import { evaluateSettlement } from '../plugins/bran/skills/bran/scripts/lib/expressions.mjs'
import { buildReviewReceipt, REQUIRED_REVIEW_STAGES, reviewPackage } from '../plugins/bran/skills/bran/scripts/lib/review.mjs'
import { diffPackages } from '../plugins/bran/skills/bran/scripts/lib/diff.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(root, 'plugins/bran/skills/bran/fixtures/harbor-signal/bran-input.json')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bran-core-test-'))

const acceptAllReviewStages = outputRoot => {
  let finalReview
  for (const [index, stage] of REQUIRED_REVIEW_STAGES.entries()) {
    finalReview = reviewPackage({ root: outputRoot, stage, status: 'accepted', reviewer: 'core-test', reviewedAt: `2026-07-18T00:00:0${index}.000Z` })
  }
  return finalReview
}

const prepareReleaseFixture = outputRoot => {
  const packageDir = path.join(outputRoot, 'package')
  const releaseArtifacts = [
    ['ART-RECIPE-RECEIPTS', 'compiled-recipe-receipts.jsonl', 'jsonl'],
    ['ART-REPLAY-METRICS', 'replay-metrics.json', 'json'],
    ['ART-EVIDENCE-DECISIONS', 'evidence-decisions.jsonl', 'jsonl'],
    ['ART-WAITING', 'waiting-interactions.jsonl', 'jsonl'],
    ['ART-AGENT-EVAL-CASES', 'agent-eval-cases.jsonl', 'jsonl'],
    ['ART-AGENT-EVAL-RECEIPT', 'agent-eval-receipt.json', 'json'],
    ['ART-CARRYOVER', 'carryover-contracts.jsonl', 'jsonl'],
    ['ART-TRACES', 'playtest-traces.jsonl', 'jsonl'],
    ['ART-SIMULATION-RECEIPT', 'playtest-simulation-receipt.json', 'json'],
    ['ART-SETTLEMENT-RECEIPT', 'settlement-test-receipt.json', 'json'],
    ['ART-QUALITY-RECEIPT', 'quality-receipt.json', 'json']
  ]
  writeJsonl(path.join(packageDir, 'compiled-recipe-receipts.jsonl'), [
    { recipeId: 'RECIPE-OPEN', status: 'pass' },
    { recipeId: 'RECIPE-CAUTIOUS', status: 'pass' }
  ])
  writeJson(path.join(packageDir, 'replay-metrics.json'), { pass: true, minimumActionGraphDistance: 1, maximumDecisionCueReuse: 0 })
  writeJsonl(path.join(packageDir, 'evidence-decisions.jsonl'), [{
    decisionId: 'DECISION-RESPONSE',
    visibleEvidence: ['FACT-SIGNAL', 'FACT-WINDOW'],
    options: [
      { actionInstanceId: 'BASE:SCENE-03:mara:publish-response', stateEffects: [{ op: 'set', path: 'world.phase', value: 'settled' }] },
      { actionInstanceId: 'BASE:SCENE-03:orin:hold-with-reason', stateEffects: [{ op: 'set', path: 'world.phase', value: 'settled' }] }
    ]
  }])
  writeJsonl(path.join(packageDir, 'waiting-interactions.jsonl'), [{
    waitingId: 'WAIT-SCENE-02',
    visibleStateRefs: ['evidence.signalVerified'],
    availableWhileWaiting: [{ actionId: 'review' }, { actionId: 'ask-risk' }, { actionId: 'draft-condition' }],
    willUnlock: ['SCENE-03']
  }])
  writeJsonl(path.join(packageDir, 'agent-eval-cases.jsonl'), [{
    caseId: 'AGENT-CASE-01',
    requiredInformationUnits: ['FACT-MATCH'],
    fixtureAnswer: { visibleFact: 'FACT-MATCH', risk: 'Signal may still be stale.' },
    nextActionId: 'BASE:SCENE-01:orin:qualify-match'
  }])
  writeJson(path.join(packageDir, 'agent-eval-receipt.json'), { pass: true, passRate: 1 })
  writeJsonl(path.join(packageDir, 'carryover-contracts.jsonl'), [{ carryoverId: 'CARRY-TRUST', consequenceClass: 'TRUST_GAINED' }])

  const finalStates = {
    'ENDING-TRUSTED-RESCUE': { world: { phase: 'settled' }, evidence: { signalVerified: true }, relationship: { trust: 2 }, resources: { time: 1 }, choice: { shared: true } },
    'ENDING-QUALIFIED-RESCUE': { world: { phase: 'settled' }, evidence: { signalVerified: true }, relationship: { trust: 0 }, resources: { time: 1 }, choice: { shared: true } },
    'ENDING-HOLD': { world: { phase: 'settled' }, evidence: { signalVerified: false }, relationship: { trust: 1 }, resources: { time: 0 }, choice: { shared: false } }
  }
  const makeTrace = (runId, recipeId, endingCode, seat) => ({
    runId,
    recipeId,
    targetEndingCode: endingCode,
    actualEndingCode: endingCode,
    computedUtility: {
      truth: endingCode === 'ENDING-QUALIFIED-RESCUE' ? 3 : endingCode === 'ENDING-HOLD' ? 1 : 2,
      trust: endingCode === 'ENDING-TRUSTED-RESCUE' ? 2 : 1
    },
    steps: ['SCENE-01', 'SCENE-02', 'SCENE-03'].map((sceneId, index) => ({ step: index + 1, sceneId, seat, preconditionsPassed: true, costsPaid: true })),
    mergeReceipts: ['SCENE-01', 'SCENE-02', 'SCENE-03'].map(sceneId => ({ sceneId, requiredSeats: [seat], executedBySeat: { [seat]: true }, mergePassed: true })),
    finalWorldState: finalStates[endingCode]
  })
  writeJsonl(path.join(packageDir, 'playtest-traces.jsonl'), [
    makeTrace('RUN-OPEN-TRUSTED', 'RECIPE-OPEN', 'ENDING-TRUSTED-RESCUE', 'mara'),
    makeTrace('RUN-OPEN-QUALIFIED', 'RECIPE-OPEN', 'ENDING-QUALIFIED-RESCUE', 'mara'),
    makeTrace('RUN-CAUTIOUS-HOLD', 'RECIPE-CAUTIOUS', 'ENDING-HOLD', 'orin')
  ])
  writeJson(path.join(packageDir, 'playtest-simulation-receipt.json'), { pass: true, runs: 3 })
  writeJson(path.join(packageDir, 'settlement-test-receipt.json'), { pass: true, vectors: 3 })

  const manifestPath = path.join(packageDir, 'source-manifest.json')
  const manifest = readJson(manifestPath)
  manifest.lifecycle = 'release'
  manifest.auditProfile = { ...manifest.auditProfile, level: 'release', minimumRunsPerRecipe: 1, minimumCarryoverClasses: 1 }
  for (const [artifactId, artifactPath, format] of releaseArtifacts) manifest.artifactIndex.push({ artifactId, path: artifactPath, format, responsibility: 'release evidence fixture' })
  writeJson(manifestPath, manifest)
  const ledger = readJsonl(path.join(packageDir, 'review-ledger.jsonl'))
  const priorReviewReceipt = readJson(path.join(packageDir, 'review-receipt.json'))
  writeJson(path.join(packageDir, 'review-receipt.json'), buildReviewReceipt({ packageDir, manifest, ledger, updatedAt: priorReviewReceipt.updatedAt }))

  const qualityFiles = manifest.artifactIndex.map(item => item.path).filter(name => !['source-manifest.json', 'review-ledger.jsonl', 'review-receipt.json', 'compile-receipt.json', 'quality-receipt.json'].includes(name))
  writeJson(path.join(packageDir, 'quality-receipt.json'), {
    status: 'pass',
    blockers: [],
    artifactHashFiles: qualityFiles,
    artifactHash: artifactHash(packageDir, qualityFiles)
  })
}

try {
  const firstOutput = path.join(temporaryRoot, 'first')
  const secondOutput = path.join(temporaryRoot, 'second')
  const releaseOutput = path.join(temporaryRoot, 'release')
  const firstCompile = compileBundle({ inputPath: fixture, outputRoot: firstOutput })
  const secondCompile = compileBundle({ inputPath: fixture, outputRoot: secondOutput })
  const releaseCompile = compileBundle({ inputPath: fixture, outputRoot: releaseOutput })
  assert.equal(firstCompile.result, 'pass')
  assert.equal(secondCompile.result, 'pass')
  assert.equal(releaseCompile.result, 'pass')
  assert.equal(firstCompile.artifactHash, secondCompile.artifactHash, 'same input must compile to the same artifact hash')

  const audit = auditPackage({ root: firstOutput, level: 'compile' })
  assert.equal(audit.result, 'pass', JSON.stringify(audit.diagnostics, null, 2))
  assert.ok(audit.checks.every(check => typeof check.pass === 'boolean'))
  assert.ok(audit.checks.some(check => check.id === 'SETTLEMENT_VECTORS_RECOMPUTED' && check.pass))
  assert.ok(audit.checks.some(check => check.id === 'COMPILE_RECEIPT_FRESHNESS' && check.pass))

  const packageDir = path.join(firstOutput, 'package')
  const settlementDiagnostics = []
  const settlement = evaluateSettlement(
    { world: { phase: 'settled' }, evidence: { signalVerified: true }, relationship: { trust: 2 }, resources: { time: 1 }, choice: { shared: true } },
    readJson(path.join(packageDir, 'settlement-rules.json')),
    readJson(path.join(packageDir, 'state-field-registry.json')),
    settlementDiagnostics
  )
  assert.equal(settlement.endingCode, 'ENDING-TRUSTED-RESCUE')
  assert.deepEqual(settlementDiagnostics, [])

  const finalReview = acceptAllReviewStages(secondOutput)
  assert.equal(finalReview.lifecycle, 'reviewed')
  assert.equal(finalReview.reviewStatus, 'pass')
  const reviewedAudit = auditPackage({ root: secondOutput, level: 'compile' })
  assert.equal(reviewedAudit.result, 'pass', JSON.stringify(reviewedAudit.diagnostics, null, 2))
  assert.ok(reviewedAudit.checks.some(check => check.id === 'REVIEW_RECEIPT_COHERENT' && check.pass))
  const packageDiff = diffPackages({ baseRoot: firstOutput, candidateRoot: secondOutput })
  assert.deepEqual(packageDiff.totals, { added: 0, removed: 0, changed: 0 })
  assert.equal(packageDiff.candidate.lifecycle, 'reviewed')
  const productionRequestPath = path.join(secondOutput, 'package', 'production-request.json')
  const productionRequest = readJson(productionRequestPath)
  productionRequest.assetSlots[0].semanticPurpose = 'Tampered after review.'
  writeJson(productionRequestPath, productionRequest)
  const staleReviewAudit = auditPackage({ root: secondOutput, level: 'compile' })
  assert.equal(staleReviewAudit.result, 'fail')
  assert.ok(staleReviewAudit.diagnostics.some(item => item.code === 'REVIEW_RECEIPT_COHERENT'))

  acceptAllReviewStages(releaseOutput)
  prepareReleaseFixture(releaseOutput)
  const releaseAudit = auditPackage({ root: releaseOutput, level: 'release' })
  assert.equal(releaseAudit.result, 'pass', JSON.stringify(releaseAudit.diagnostics, null, 2))
  assert.ok(releaseAudit.checks.some(check => check.id === 'FULL_TRACES_RECOMPUTED' && check.pass))
  assert.ok(releaseAudit.checks.some(check => check.id === 'QUALITY_RECEIPT_FRESHNESS' && check.pass))

  const invalidInput = structuredClone(readJson(fixture))
  invalidInput.sourceEvents[1].causeEventIds = ['EV-DOES-NOT-EXIST']
  const inputDiagnostics = validateInput(invalidInput)
  assert.ok(inputDiagnostics.some(item => item.code === 'EVENT_CAUSE_UNRESOLVED' && item.severity === 'error'))

  const tamperedVectors = path.join(packageDir, 'settlement-test-vectors.jsonl')
  const vectors = fs.readFileSync(tamperedVectors, 'utf8').trim().split('\n').map(JSON.parse)
  vectors[0].expectedEndingCode = 'ENDING-HOLD'
  fs.writeFileSync(tamperedVectors, `${vectors.map(row => JSON.stringify(row)).join('\n')}\n`)
  const tamperedAudit = auditPackage({ root: firstOutput, level: 'compile' })
  assert.equal(tamperedAudit.result, 'fail')
  assert.ok(tamperedAudit.diagnostics.some(item => item.code === 'SETTLEMENT_VECTORS_RECOMPUTED'))
  assert.ok(tamperedAudit.diagnostics.some(item => item.code === 'COMPILE_RECEIPT_FRESHNESS'))

  const auditorSource = fs.readFileSync(path.join(root, 'plugins/bran/skills/bran/scripts/lib/auditor.mjs'), 'utf8')
  for (const projectSpecificToken of ['Delilah', 'Cheng', 'Archie', "'W01'", "'S00'"]) {
    assert.equal(auditorSource.includes(projectSpecificToken), false, `generic auditor contains project-specific token ${projectSpecificToken}`)
  }

  const schemaDirectory = path.join(root, 'plugins/bran/skills/bran/schemas')
  for (const name of fs.readdirSync(schemaDirectory).filter(name => name.endsWith('.json'))) readJson(path.join(schemaDirectory, name))

  console.log(JSON.stringify({ result: 'pass', tests: 22, fixture, artifactHash: firstCompile.artifactHash }, null, 2))
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
