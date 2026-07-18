import fs from 'node:fs'
import path from 'node:path'
import {
  artifactHash,
  readJson,
  readJsonl,
  resolvePackageDirectory,
  sha256,
  stableStringify,
  writeJson,
  writeJsonl
} from './common.mjs'

export const REVIEW_STAGE_FILES = {
  'source-events': ['source-events.jsonl'],
  canon: ['canon-visibility.json'],
  characters: ['character-contracts.jsonl'],
  narrative: [
    'scene-scripts.jsonl',
    'narrative-graph.json',
    'state-field-registry.json',
    'baseline-stage-actions.jsonl',
    'recipe-stage-overrides.jsonl',
    'settlement-rules.json',
    'settlement-test-vectors.jsonl'
  ],
  agents: ['agent-runtime-contract.json'],
  runtime: ['runtime-contract.json'],
  'production-request': ['production-request.json']
}

export const REQUIRED_REVIEW_STAGES = Object.keys(REVIEW_STAGE_FILES)

export const stageContentHash = (packageDir, stage) => {
  const files = REVIEW_STAGE_FILES[stage]
  if (!files) throw new Error(`Unknown review stage: ${stage}`)
  const missing = files.filter(name => !fs.existsSync(path.join(packageDir, name)))
  if (missing.length) throw new Error(`Review stage ${stage} is missing artifacts: ${missing.join(', ')}`)
  return artifactHash(packageDir, files)
}

const latestEntries = ledger => {
  const latest = new Map()
  for (const entry of ledger) latest.set(entry.stage, entry)
  return latest
}

export const buildReviewReceipt = ({ packageDir, manifest, ledger, updatedAt }) => {
  const latest = latestEntries(ledger)
  const latestStatusByStage = {}
  const reviewedArtifactHashes = {}
  for (const stage of REQUIRED_REVIEW_STAGES) {
    const entry = latest.get(stage)
    latestStatusByStage[stage] = entry?.status ?? 'pending'
    reviewedArtifactHashes[stage] = entry?.contentHash ?? null
  }
  const currentArtifactHashes = Object.fromEntries(REQUIRED_REVIEW_STAGES.map(stage => [stage, stageContentHash(packageDir, stage)]))
  const staleStages = REQUIRED_REVIEW_STAGES.filter(stage => latestStatusByStage[stage] === 'accepted' && reviewedArtifactHashes[stage] !== currentArtifactHashes[stage])
  const accepted = REQUIRED_REVIEW_STAGES.every(stage => latestStatusByStage[stage] === 'accepted')
  return {
    schemaVersion: '1.0.0',
    requiredStages: REQUIRED_REVIEW_STAGES,
    status: accepted && staleStages.length === 0 ? 'pass' : 'draft',
    latestStatusByStage,
    reviewedArtifactHashes,
    currentArtifactHashes,
    staleStages,
    ledgerHash: sha256(fs.existsSync(path.join(packageDir, 'review-ledger.jsonl')) ? fs.readFileSync(path.join(packageDir, 'review-ledger.jsonl'), 'utf8') : ''),
    manifestHash: sha256(stableStringify(manifest)),
    updatedAt
  }
}

export const reviewPackage = ({ root, stage, status, reviewer, note = '', reviewedAt = new Date().toISOString() }) => {
  if (!REVIEW_STAGE_FILES[stage]) throw new Error(`Unknown review stage ${stage}. Expected one of: ${REQUIRED_REVIEW_STAGES.join(', ')}`)
  if (!['accepted', 'rejected'].includes(status)) throw new Error('Review status must be accepted or rejected.')
  if (!reviewer?.trim()) throw new Error('Reviewer is required.')

  const packageDir = resolvePackageDirectory(root)
  const manifestPath = path.join(packageDir, 'source-manifest.json')
  const ledgerPath = path.join(packageDir, 'review-ledger.jsonl')
  const receiptPath = path.join(packageDir, 'review-receipt.json')
  const manifest = readJson(manifestPath)
  const ledger = fs.existsSync(ledgerPath) ? readJsonl(ledgerPath) : []
  const contentHash = stageContentHash(packageDir, stage)
  const reviewId = `REVIEW-${stage}-${sha256(`${reviewer}:${reviewedAt}:${contentHash}:${status}`).slice(0, 12)}`
  ledger.push({ reviewId, stage, status, reviewer, contentHash, reviewedAt, ...(note ? { note } : {}) })
  writeJsonl(ledgerPath, ledger)

  const provisionalReceipt = buildReviewReceipt({ packageDir, manifest, ledger, updatedAt: reviewedAt })
  manifest.lifecycle = provisionalReceipt.status === 'pass' ? 'reviewed' : 'compiled'
  writeJson(manifestPath, manifest)
  const receipt = buildReviewReceipt({ packageDir, manifest, ledger, updatedAt: reviewedAt })
  writeJson(receiptPath, receipt)

  return {
    result: 'pass',
    packageDir,
    reviewId,
    stage,
    status,
    lifecycle: manifest.lifecycle,
    reviewStatus: receipt.status,
    pendingStages: REQUIRED_REVIEW_STAGES.filter(name => receipt.latestStatusByStage[name] !== 'accepted'),
    staleStages: receipt.staleStages
  }
}

export const normalizeInitialReview = ({ packageDir, entries }) => {
  return (entries ?? []).map((entry, index) => {
    if (!REVIEW_STAGE_FILES[entry.stage]) throw new Error(`Initial review entry ${index} has unknown stage ${entry.stage}.`)
    return {
      ...entry,
      reviewId: entry.reviewId ?? `REVIEW-${entry.stage}-${index + 1}`,
      contentHash: stageContentHash(packageDir, entry.stage)
    }
  })
}
