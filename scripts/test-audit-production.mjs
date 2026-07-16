import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const auditor = path.join(repositoryRoot, 'plugins/bran/skills/bran/scripts/audit-production-package.mjs')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bran-production-audit-'))
const productionDir = path.join(temporaryRoot, 'production')
fs.mkdirSync(productionDir)

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const writeJson = (name, value) => fs.writeFileSync(path.join(productionDir, name), `${JSON.stringify(value, null, 2)}\n`)
const writeJsonl = (name, rows) => fs.writeFileSync(path.join(productionDir, name), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)

const imageTemplate = 'Create {{frameRole}} for {{shotId}} with stable identity.'
const videoTemplate = 'Animate {{shotId}} from ordered action beats and references.'
const entities = [{
  entityId: 'entity-character-1',
  type: 'character',
  name: 'Mara',
  styleLock: 'ink-noir-v1',
  identityAnchors: ['short black hair', 'silver raincoat'],
  referenceMediaIds: ['media-first-1']
}]
const candidates = [
  {
    candidateId: 'candidate-asset-1',
    shotId: 'shot-1',
    kind: 'asset',
    source: 'scene-1:paragraph-2',
    evidenceRefs: ['source:12-18'],
    extractorRunId: 'extractor-run-1',
    extractorSchemaVersion: '1.0.0',
    sourceInputHash: 'source-input-hash',
    extractionResultHash: 'asset-result-hash',
    assetType: 'character',
    status: 'linked',
    linkedEntityId: 'entity-character-1',
    confirmedAt: '2026-07-17T08:00:00.000Z'
  },
  {
    candidateId: 'candidate-dialogue-1',
    shotId: 'shot-1',
    kind: 'dialogue',
    source: 'scene-1:line-4',
    evidenceRefs: ['source:24-26'],
    extractorRunId: 'extractor-run-1',
    extractorSchemaVersion: '1.0.0',
    sourceInputHash: 'source-input-hash',
    extractionResultHash: 'dialogue-result-hash',
    status: 'accepted',
    linkedDialogueId: 'dialogue-1',
    confirmedAt: '2026-07-17T08:01:00.000Z'
  }
]
const templates = [
  { promptTemplateId: 'image-frame', version: '1.0.0', category: 'image', template: imageTemplate, variables: ['frameRole', 'shotId'], contentHash: sha256(imageTemplate) },
  { promptTemplateId: 'video-shot', version: '1.0.0', category: 'video', template: videoTemplate, variables: ['shotId'], contentHash: sha256(videoTemplate) }
]
const profiles = [
  { modelProfileId: 'image-default', providerKey: 'demo-provider', modelName: 'image-model', category: 'image', capabilities: { referenceImage: true }, defaults: { ratio: '16:9' } },
  { modelProfileId: 'video-default', providerKey: 'demo-provider', modelName: 'video-model', category: 'video', capabilities: { firstFrame: true }, defaults: { durationSec: 6 } }
]
const shots = [{
  shotId: 'shot-1',
  chapterId: 'chapter-1',
  order: 1,
  narrativeSceneId: 'scene-1',
  actionRefs: ['action-1'],
  dialogueIds: ['dialogue-1'],
  entityRefs: ['entity-character-1'],
  camera: { shot: 'medium', angle: 'eye-level', movement: 'slow push' },
  durationSec: 6,
  actionBeats: [
    { beatId: 'beat-1', text: 'Mara reaches for the sealed door.', phase: 'trigger' },
    { beatId: 'beat-2', text: 'The lock flashes and forces her hand back.', phase: 'peak' },
    { beatId: 'beat-3', text: 'She studies the new symbol on her palm.', phase: 'aftermath' }
  ],
  preparation: {
    status: 'ready',
    basicInfoReady: true,
    semanticDefaultsReady: true,
    actionBeatsReady: true,
    candidatesResolved: true
  },
  videoReadiness: {
    ready: true,
    checks: {
      extractionResolved: true,
      durationPresent: true,
      promptDerivable: true,
      referenceFramesReady: true,
      compatibleModelProfilePresent: true,
      providerConfigurationAvailable: true,
      noActiveConflictingVideoTask: true
    }
  },
  generation: {
    referenceMode: 'first',
    referenceMediaIds: ['media-first-1'],
    promptTemplateId: 'video-shot',
    promptTemplateVersion: '1.0.0',
    promptTemplateHash: sha256(videoTemplate),
    modelProfileId: 'video-default'
  },
  continuity: {
    previousShotId: null,
    nextShotId: null,
    compositionAnchor: 'Mara remains frame left',
    screenDirection: 'left-to-right'
  }
}]
const tasks = [
  {
    taskId: 'task-image-1',
    kind: 'image',
    shotId: 'shot-1',
    status: 'succeeded',
    promptTemplateId: 'image-frame',
    promptTemplateVersion: '1.0.0',
    promptTemplateHash: sha256(imageTemplate),
    modelProfileId: 'image-default',
    baseDraftHash: 'base-image',
    contextHash: 'context-image',
    derivedPreviewHash: 'preview-image',
    submissionHash: 'submission-image',
    resultMediaIds: ['media-first-1'],
    finishedAt: '2026-07-17T08:02:00.000Z'
  },
  {
    taskId: 'task-video-1',
    kind: 'video',
    shotId: 'shot-1',
    status: 'succeeded',
    promptTemplateId: 'video-shot',
    promptTemplateVersion: '1.0.0',
    promptTemplateHash: sha256(videoTemplate),
    modelProfileId: 'video-default',
    baseDraftHash: 'base-video',
    contextHash: 'context-video',
    derivedPreviewHash: 'preview-video',
    submissionHash: 'submission-video',
    resultMediaIds: ['media-video-1'],
    finishedAt: '2026-07-17T08:04:00.000Z'
  }
]
const events = [
  { eventId: 'event-image-pending', taskId: 'task-image-1', from: null, to: 'pending', at: '2026-07-17T08:01:00.000Z' },
  { eventId: 'event-image-running', taskId: 'task-image-1', from: 'pending', to: 'running', at: '2026-07-17T08:01:10.000Z' },
  { eventId: 'event-image-succeeded', taskId: 'task-image-1', from: 'running', to: 'succeeded', at: '2026-07-17T08:02:00.000Z' },
  { eventId: 'event-video-pending', taskId: 'task-video-1', from: null, to: 'pending', at: '2026-07-17T08:02:10.000Z' },
  { eventId: 'event-video-running', taskId: 'task-video-1', from: 'pending', to: 'running', at: '2026-07-17T08:02:20.000Z' },
  { eventId: 'event-video-streaming', taskId: 'task-video-1', from: 'running', to: 'streaming', at: '2026-07-17T08:03:00.000Z' },
  { eventId: 'event-video-succeeded', taskId: 'task-video-1', from: 'streaming', to: 'succeeded', at: '2026-07-17T08:04:00.000Z' }
]
const media = [
  {
    mediaId: 'media-first-1',
    kind: 'image',
    status: 'accepted',
    contentHash: 'image-content-hash',
    storageUri: 'artifact://media/first-1.png',
    sourceTaskId: 'task-image-1',
    shotId: 'shot-1',
    role: 'first_frame'
  },
  {
    mediaId: 'media-video-1',
    kind: 'video',
    status: 'accepted',
    contentHash: 'video-content-hash',
    storageUri: 'artifact://media/video-1.mp4',
    sourceTaskId: 'task-video-1',
    shotId: 'shot-1',
    role: 'video'
  }
]
const exportManifest = {
  clips: [{ clipId: 'clip-1', shotId: 'shot-1', mediaId: 'media-video-1', order: 1 }],
  delivery: { format: 'mp4', ratio: '16:9', resolution: '1920x1080' }
}
exportManifest.integrityHash = sha256(JSON.stringify({ clips: exportManifest.clips, delivery: exportManifest.delivery }))

writeJsonl('entity-assets.jsonl', entities)
writeJsonl('shot-production.jsonl', shots)
writeJsonl('extraction-candidates.jsonl', candidates)
writeJsonl('prompt-templates.jsonl', templates)
writeJsonl('model-profiles.jsonl', profiles)
writeJsonl('generation-tasks.jsonl', tasks)
writeJsonl('task-events.jsonl', events)
writeJsonl('media-assets.jsonl', media)
writeJson('export-manifest.json', exportManifest)

const artifactHashFiles = [
  'entity-assets.jsonl', 'shot-production.jsonl', 'extraction-candidates.jsonl',
  'prompt-templates.jsonl', 'model-profiles.jsonl', 'generation-tasks.jsonl',
  'task-events.jsonl', 'media-assets.jsonl', 'export-manifest.json'
]
const writeManifest = () => {
  const artifactHash = sha256(artifactHashFiles.slice().sort().map(name => `${name}\0${fs.readFileSync(path.join(productionDir, name), 'utf8')}`).join('\0'))
  writeJson('media-production-manifest.json', {
    contractVersion: '1.0.0',
    sourcePackageVersion: '1.0.0',
    sourcePackageHash: 'source-package-hash',
    productionStatus: 'ready',
    defaultVideoRatio: '16:9',
    artifactIndex: artifactHashFiles.map((name, index) => ({ artifactId: `artifact-${index + 1}`, path: name })),
    artifactHashFiles,
    artifactHash
  })
}
writeManifest()

const passingRun = spawnSync(process.execPath, [auditor, temporaryRoot], { encoding: 'utf8' })
if (passingRun.status !== 0) {
  console.error(passingRun.stdout)
  console.error(passingRun.stderr)
  throw new Error('expected production fixture to pass')
}

profiles[0].apiKey = 'sk-test-secret-value'
writeJsonl('model-profiles.jsonl', profiles)
writeManifest()
const failingRun = spawnSync(process.execPath, [auditor, temporaryRoot], { encoding: 'utf8' })
if (failingRun.status === 0 || !failingRun.stdout.includes('MODEL_PROFILES_RECOMPUTED')) {
  console.error(failingRun.stdout)
  console.error(failingRun.stderr)
  throw new Error('expected embedded secret fixture to fail model-profile validation')
}

delete profiles[0].apiKey
writeJsonl('model-profiles.jsonl', profiles)
shots[0].videoReadiness.ready = false
writeJsonl('shot-production.jsonl', shots)
writeManifest()
const readinessRun = spawnSync(process.execPath, [auditor, temporaryRoot], { encoding: 'utf8' })
if (readinessRun.status === 0 || !readinessRun.stdout.includes('SHOT_PRODUCTION_RECOMPUTED')) {
  console.error(readinessRun.stdout)
  console.error(readinessRun.stderr)
  throw new Error('expected readiness drift fixture to fail shot-production validation')
}

shots[0].videoReadiness.ready = true
writeJsonl('shot-production.jsonl', shots)
events[0].from = 'pending'
writeJsonl('task-events.jsonl', events)
writeManifest()
const lifecycleRun = spawnSync(process.execPath, [auditor, temporaryRoot], { encoding: 'utf8' })
if (lifecycleRun.status === 0 || !lifecycleRun.stdout.includes('TASK_LIFECYCLE_RECOMPUTED')) {
  console.error(lifecycleRun.stdout)
  console.error(lifecycleRun.stderr)
  throw new Error('expected broken lifecycle fixture to fail task validation')
}

fs.rmSync(temporaryRoot, { recursive: true, force: true })
console.log(JSON.stringify({
  result: 'pass',
  cases: ['complete-production-package', 'embedded-secret-rejected', 'readiness-drift-rejected', 'broken-task-lifecycle-rejected']
}, null, 2))
