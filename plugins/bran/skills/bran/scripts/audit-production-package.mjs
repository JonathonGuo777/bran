import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
const productionDir = path.basename(root) === 'production' ? root : path.join(root, 'production')
const failures = []
const checks = []
const fail = message => { failures.push(message) }
const check = (id, pass, evidence) => {
  checks.push({ id, pass, evidence })
  if (!pass) fail(`${id}: ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`)
}
const requireFile = name => {
  const filePath = path.join(productionDir, name)
  if (!fs.existsSync(filePath)) fail(`missing ${name}`)
  return filePath
}
const readJson = name => JSON.parse(fs.readFileSync(requireFile(name), 'utf8'))
const readJsonl = name => {
  const content = fs.readFileSync(requireFile(name), 'utf8').trim()
  return content ? content.split('\n').map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`${name}:${index + 1}: ${error.message}`)
    }
  }) : []
}
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex')
const duplicateValues = values => {
  const seen = new Set()
  return values.filter(value => value === undefined || value === null || value === '' || seen.has(value) || !seen.add(value))
}
const asArray = value => Array.isArray(value) ? value : []
const hasText = value => typeof value === 'string' && value.trim().length > 0
const resolveProductionPath = name => {
  if (!hasText(name)) return null
  const candidate = path.resolve(productionDir, name)
  return candidate.startsWith(`${productionDir}${path.sep}`) ? candidate : null
}

const required = [
  'media-production-manifest.json',
  'entity-assets.jsonl',
  'shot-production.jsonl',
  'extraction-candidates.jsonl',
  'prompt-templates.jsonl',
  'model-profiles.jsonl',
  'generation-tasks.jsonl',
  'task-events.jsonl',
  'media-assets.jsonl',
  'export-manifest.json'
]
for (const name of required) requireFile(name)
if (failures.length) finish()

let manifest, entities, shots, candidates, templates, profiles, tasks, events, media, exportManifest
try {
  manifest = readJson('media-production-manifest.json')
  entities = readJsonl('entity-assets.jsonl')
  shots = readJsonl('shot-production.jsonl')
  candidates = readJsonl('extraction-candidates.jsonl')
  templates = readJsonl('prompt-templates.jsonl')
  profiles = readJsonl('model-profiles.jsonl')
  tasks = readJsonl('generation-tasks.jsonl')
  events = readJsonl('task-events.jsonl')
  media = readJsonl('media-assets.jsonl')
  exportManifest = readJson('export-manifest.json')
} catch (error) {
  fail(`parse error: ${error.message}`)
  finish()
}

const entityById = new Map(entities.map(item => [item.entityId, item]))
const shotById = new Map(shots.map(item => [item.shotId, item]))
const templateById = new Map(templates.map(item => [`${item.promptTemplateId}@${item.version}`, item]))
const profileById = new Map(profiles.map(item => [item.modelProfileId, item]))
const taskById = new Map(tasks.map(item => [item.taskId, item]))
const mediaById = new Map(media.map(item => [item.mediaId, item]))
const terminalStates = new Set(['succeeded', 'failed', 'cancelled'])
const activeVideoCountByShot = new Map()
for (const task of tasks.filter(item => item.kind === 'video' && !terminalStates.has(item.status))) activeVideoCountByShot.set(task.shotId, (activeVideoCountByShot.get(task.shotId) ?? 0) + 1)

const duplicateIds = [
  ...duplicateValues(asArray(manifest.artifactIndex).map(item => item.artifactId)).map(id => `artifact:${id}`),
  ...duplicateValues(entities.map(item => item.entityId)).map(id => `entity:${id}`),
  ...duplicateValues(shots.map(item => item.shotId)).map(id => `shot:${id}`),
  ...duplicateValues(candidates.map(item => item.candidateId)).map(id => `candidate:${id}`),
  ...duplicateValues(templates.map(item => `${item.promptTemplateId}@${item.version}`)).map(id => `template:${id}`),
  ...duplicateValues(profiles.map(item => item.modelProfileId)).map(id => `profile:${id}`),
  ...duplicateValues(tasks.map(item => item.taskId)).map(id => `task:${id}`),
  ...duplicateValues(events.map(item => item.eventId)).map(id => `event:${id}`),
  ...duplicateValues(media.map(item => item.mediaId)).map(id => `media:${id}`),
  ...duplicateValues(asArray(exportManifest.clips).map(item => item.clipId)).map(id => `clip:${id}`)
]
check('PRIMARY_KEYS_RECOMPUTED', duplicateIds.length === 0, duplicateIds)

const manifestProblems = []
for (const field of ['contractVersion', 'sourcePackageVersion', 'sourcePackageHash', 'productionStatus', 'defaultVideoRatio', 'artifactHash']) {
  if (!hasText(manifest[field])) manifestProblems.push(`missing:${field}`)
}
const indexedPaths = asArray(manifest.artifactIndex).map(item => item.path)
for (const item of asArray(manifest.artifactIndex)) {
  const artifactPath = resolveProductionPath(item.path)
  if (!hasText(item.artifactId) || !artifactPath || !fs.existsSync(artifactPath)) manifestProblems.push(`artifact:${item.artifactId ?? item.path ?? 'unknown'}`)
}
for (const duplicate of duplicateValues(indexedPaths)) manifestProblems.push(`duplicate-path:${duplicate}`)
for (const name of required.filter(name => name !== 'media-production-manifest.json')) {
  if (!indexedPaths.includes(name)) manifestProblems.push(`unindexed:${name}`)
}
check('MANIFEST_PATHS_RECOMPUTED', manifestProblems.length === 0, manifestProblems)

const entityProblems = entities.flatMap(item => {
  const problems = []
  if (!['character', 'actor', 'scene', 'prop', 'costume'].includes(item.type)) problems.push('invalid-type')
  if (!hasText(item.name) || !hasText(item.styleLock)) problems.push('missing-name-or-style')
  if (['character', 'actor'].includes(item.type) && !asArray(item.identityAnchors).length) problems.push('missing-identity-anchor')
  for (const mediaId of asArray(item.referenceMediaIds)) if (!mediaById.has(mediaId)) problems.push(`unknown-media:${mediaId}`)
  return problems.map(problem => `${item.entityId}:${problem}`)
})
check('ENTITY_ASSETS_RECOMPUTED', entityProblems.length === 0, entityProblems)

const candidateProblems = candidates.flatMap(item => {
  const problems = []
  const allowed = item.kind === 'asset' ? ['pending', 'linked', 'ignored'] : item.kind === 'dialogue' ? ['pending', 'accepted', 'ignored'] : []
  if (!shotById.has(item.shotId)) problems.push(`unknown-shot:${item.shotId}`)
  if (!allowed.includes(item.status)) problems.push(`invalid-status:${item.status}`)
  if (!hasText(item.source) || !asArray(item.evidenceRefs).length) problems.push('missing-source-evidence')
  for (const field of ['extractorRunId', 'extractorSchemaVersion', 'sourceInputHash', 'extractionResultHash']) if (!hasText(item[field])) problems.push(`missing-${field}`)
  if (item.kind === 'asset' && !['character', 'actor', 'scene', 'prop', 'costume'].includes(item.assetType)) problems.push(`invalid-asset-type:${item.assetType}`)
  if (item.kind === 'asset' && item.status === 'linked' && !entityById.has(item.linkedEntityId)) problems.push(`unknown-linked-entity:${item.linkedEntityId}`)
  if (item.kind === 'dialogue' && item.status === 'accepted' && !hasText(item.linkedDialogueId)) problems.push('missing-linked-dialogue')
  if (item.status !== 'pending' && !hasText(item.confirmedAt)) problems.push('missing-confirmed-at')
  return problems.map(problem => `${item.candidateId}:${problem}`)
})
check('CANDIDATE_RESOLUTION_RECOMPUTED', candidateProblems.length === 0, candidateProblems)

const referenceRoles = {
  text_only: [],
  first: ['first_frame'],
  last: ['last_frame'],
  key: ['key_frame'],
  first_last: ['first_frame', 'last_frame'],
  first_last_key: ['first_frame', 'last_frame', 'key_frame']
}
const shotProblems = []
for (const shot of shots) {
  const prefix = shot.shotId
  if (!hasText(shot.chapterId) || !hasText(shot.narrativeSceneId) || !Number.isInteger(shot.order)) shotProblems.push(`${prefix}:missing-identity-or-order`)
  if (!asArray(shot.actionRefs).length || !asArray(shot.actionBeats).length || !(shot.durationSec > 0)) shotProblems.push(`${prefix}:missing-action-or-duration`)
  if (!shot.camera || !['shot', 'angle', 'movement'].every(field => hasText(shot.camera[field]))) shotProblems.push(`${prefix}:incomplete-camera`)
  for (const entityId of asArray(shot.entityRefs)) if (!entityById.has(entityId)) shotProblems.push(`${prefix}:unknown-entity:${entityId}`)
  const beatIds = asArray(shot.actionBeats).map(beat => beat.beatId)
  if (duplicateValues(beatIds).length || asArray(shot.actionBeats).some(beat => !hasText(beat.text) || (beat.phase && !['trigger', 'peak', 'aftermath'].includes(beat.phase)))) shotProblems.push(`${prefix}:invalid-action-beats`)

  const unresolved = candidates.filter(item => item.shotId === shot.shotId && item.status === 'pending')
  const preparation = shot.preparation ?? {}
  const derivedPreparation = Boolean(
    preparation.basicInfoReady && preparation.semanticDefaultsReady && preparation.actionBeatsReady &&
    preparation.candidatesResolved && unresolved.length === 0 && shot.durationSec > 0 && asArray(shot.actionBeats).length
  )
  if (!['pending', 'ready'].includes(preparation.status) || preparation.candidatesResolved !== (unresolved.length === 0) || (preparation.status === 'ready') !== derivedPreparation) shotProblems.push(`${prefix}:preparation-state-mismatch`)

  const generation = shot.generation ?? {}
  const expectedRoles = referenceRoles[generation.referenceMode]
  const referenceMedia = asArray(generation.referenceMediaIds).map(id => mediaById.get(id))
  if (!expectedRoles || referenceMedia.length !== (expectedRoles?.length ?? -1) || referenceMedia.some((item, index) => !item || item.role !== expectedRoles[index] || item.status !== 'accepted')) shotProblems.push(`${prefix}:reference-mode-mismatch`)
  const template = templateById.get(`${generation.promptTemplateId}@${generation.promptTemplateVersion}`)
  if (!template || template.contentHash !== generation.promptTemplateHash) shotProblems.push(`${prefix}:prompt-template-mismatch`)
  const profile = profileById.get(generation.modelProfileId)
  if (!profile || profile.category !== 'video') shotProblems.push(`${prefix}:video-profile-mismatch`)

  const readiness = shot.videoReadiness ?? {}
  const expectedChecks = {
    extractionResolved: unresolved.length === 0,
    durationPresent: shot.durationSec > 0,
    promptDerivable: Boolean(template && template.contentHash === generation.promptTemplateHash),
    referenceFramesReady: Boolean(expectedRoles && referenceMedia.length === expectedRoles.length && referenceMedia.every((item, index) => item?.role === expectedRoles[index] && item.status === 'accepted')),
    compatibleModelProfilePresent: Boolean(profile && profile.category === 'video'),
    providerConfigurationAvailable: readiness.checks?.providerConfigurationAvailable === true,
    noActiveConflictingVideoTask: (activeVideoCountByShot.get(shot.shotId) ?? 0) === 0
  }
  const driftedChecks = Object.entries(expectedChecks).filter(([name, expected]) => readiness.checks?.[name] !== expected).map(([name]) => name)
  const allChecks = Object.values(expectedChecks).every(Boolean)
  if (driftedChecks.length || readiness.ready !== allChecks || (readiness.ready && preparation.status !== 'ready')) shotProblems.push(`${prefix}:video-readiness-mismatch:${driftedChecks.join(',')}`)

  if (shot.continuity?.previousShotId && !shotById.has(shot.continuity.previousShotId)) shotProblems.push(`${prefix}:unknown-previous-shot`)
  if (shot.continuity?.nextShotId && !shotById.has(shot.continuity.nextShotId)) shotProblems.push(`${prefix}:unknown-next-shot`)
}
const duplicateChapterOrders = duplicateValues(shots.map(shot => `${shot.chapterId}:${shot.order}`))
shotProblems.push(...duplicateChapterOrders.map(value => `duplicate-order:${value}`))
for (const chapterId of new Set(shots.map(shot => shot.chapterId))) {
  const ordered = shots.filter(shot => shot.chapterId === chapterId).sort((left, right) => left.order - right.order)
  ordered.forEach((shot, index) => {
    const expectedPrevious = ordered[index - 1]?.shotId ?? null
    const expectedNext = ordered[index + 1]?.shotId ?? null
    if ((shot.continuity?.previousShotId ?? null) !== expectedPrevious || (shot.continuity?.nextShotId ?? null) !== expectedNext) shotProblems.push(`${shot.shotId}:continuity-order-mismatch`)
  })
}
check('SHOT_PRODUCTION_RECOMPUTED', shotProblems.length === 0, shotProblems)

const templateProblems = templates.flatMap(item => {
  const problems = []
  if (!hasText(item.promptTemplateId) || !hasText(item.version) || !['text', 'image', 'video'].includes(item.category)) problems.push('invalid-identity-or-category')
  if (!hasText(item.template) || !Array.isArray(item.variables)) problems.push('invalid-template')
  if (item.contentHash !== sha256(item.template ?? '')) problems.push('content-hash-mismatch')
  return problems.map(problem => `${item.promptTemplateId}@${item.version}:${problem}`)
})
check('PROMPT_TEMPLATES_RECOMPUTED', templateProblems.length === 0, templateProblems)

const secretKey = /^(api[_-]?key|api[_-]?secret|password|bearer|cookie|signed[_-]?url|access[_-]?token|refresh[_-]?token)$/iu
const secretValue = /(?:\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|[?&](?:signature|x-amz-signature)=)/iu
const findSecrets = (value, trail = []) => {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSecrets(item, [...trail, index]))
  if (!value || typeof value !== 'object') return typeof value === 'string' && secretValue.test(value) ? [trail.join('.')] : []
  return Object.entries(value).flatMap(([key, item]) => secretKey.test(key) ? [[...trail, key].join('.')] : findSecrets(item, [...trail, key]))
}
const profileProblems = profiles.flatMap(item => {
  const problems = []
  if (!hasText(item.modelProfileId) || !hasText(item.providerKey) || !hasText(item.modelName) || !['text', 'image', 'video'].includes(item.category)) problems.push('invalid-profile')
  problems.push(...findSecrets(item).map(location => `embedded-secret:${location}`))
  return problems.map(problem => `${item.modelProfileId}:${problem}`)
})
check('MODEL_PROFILES_RECOMPUTED', profileProblems.length === 0, profileProblems)
const embeddedSecrets = [
  ['manifest', manifest], ['entities', entities], ['shots', shots], ['candidates', candidates],
  ['templates', templates], ['profiles', profiles], ['tasks', tasks], ['events', events],
  ['media', media], ['export', exportManifest]
].flatMap(([name, value]) => findSecrets(value, [name]))
check('NO_EMBEDDED_SECRETS', embeddedSecrets.length === 0, embeddedSecrets)

const validTransitions = new Set([
  'null->pending', 'pending->running', 'pending->cancelled', 'running->streaming',
  'running->succeeded', 'running->failed', 'running->cancelled', 'streaming->succeeded',
  'streaming->failed', 'streaming->cancelled'
])
const taskProblems = []
for (const task of tasks) {
  const prefix = task.taskId
  if (!shotById.has(task.shotId) || !['text', 'image', 'video'].includes(task.kind) || !['pending', 'running', 'streaming', ...terminalStates].includes(task.status)) taskProblems.push(`${prefix}:invalid-task-identity`)
  for (const field of ['baseDraftHash', 'contextHash', 'derivedPreviewHash', 'submissionHash']) if (!hasText(task[field])) taskProblems.push(`${prefix}:missing-${field}`)
  const template = templateById.get(`${task.promptTemplateId}@${task.promptTemplateVersion}`)
  if (!template || template.contentHash !== task.promptTemplateHash || template.category !== task.kind) taskProblems.push(`${prefix}:prompt-template-mismatch`)
  const profile = profileById.get(task.modelProfileId)
  if (!profile || profile.category !== task.kind) taskProblems.push(`${prefix}:model-profile-mismatch`)
  const taskEvents = events.filter(event => event.taskId === task.taskId).sort((left, right) => String(left.at).localeCompare(String(right.at)))
  let previous = null
  for (const event of taskEvents) {
    if (!validTransitions.has(`${event.from ?? 'null'}->${event.to}`) || event.from !== previous || !hasText(event.at) || Number.isNaN(Date.parse(event.at))) taskProblems.push(`${prefix}:invalid-event:${event.eventId}`)
    previous = event.to
  }
  if (!taskEvents.length || previous !== task.status) taskProblems.push(`${prefix}:event-state-mismatch`)
  if (terminalStates.has(task.status) && !hasText(task.finishedAt)) taskProblems.push(`${prefix}:missing-finished-at`)
  if (task.status === 'succeeded' && !asArray(task.resultMediaIds).length) taskProblems.push(`${prefix}:missing-result-media`)
  for (const mediaId of asArray(task.resultMediaIds)) {
    const item = mediaById.get(mediaId)
    if (!item || item.sourceTaskId !== task.taskId) taskProblems.push(`${prefix}:broken-result-media:${mediaId}`)
  }
}
for (const [shotId, count] of activeVideoCountByShot) if (count > 1) taskProblems.push(`${shotId}:duplicate-active-video-task:${count}`)
for (const event of events) if (!taskById.has(event.taskId)) taskProblems.push(`${event.eventId}:unknown-task:${event.taskId}`)
check('TASK_LIFECYCLE_RECOMPUTED', taskProblems.length === 0, taskProblems)

const mediaProblems = media.flatMap(item => {
  const problems = []
  if (!['image', 'video', 'audio'].includes(item.kind) || !['candidate', 'accepted', 'rejected'].includes(item.status)) problems.push('invalid-kind-or-status')
  if (!hasText(item.contentHash) || !hasText(item.storageUri) || !hasText(item.role)) problems.push('missing-provenance')
  if (item.sourceTaskId) {
    const task = taskById.get(item.sourceTaskId)
    if (!task || task.status !== 'succeeded' || !asArray(task.resultMediaIds).includes(item.mediaId)) problems.push(`broken-source-task:${item.sourceTaskId}`)
  }
  if (item.shotId && !shotById.has(item.shotId)) problems.push(`unknown-shot:${item.shotId}`)
  if (item.entityId && !entityById.has(item.entityId)) problems.push(`unknown-entity:${item.entityId}`)
  if (!item.shotId && !item.entityId) problems.push('missing-business-link')
  return problems.map(problem => `${item.mediaId}:${problem}`)
})
check('MEDIA_PROVENANCE_RECOMPUTED', mediaProblems.length === 0, mediaProblems)

const exportProblems = []
for (const clip of asArray(exportManifest.clips)) {
  const item = mediaById.get(clip.mediaId)
  if (!shotById.has(clip.shotId) || !item || item.status !== 'accepted' || item.shotId !== clip.shotId || item.kind !== 'video' || !Number.isInteger(clip.order)) exportProblems.push(`invalid-clip:${clip.clipId}`)
}
const duplicateExportOrders = duplicateValues(asArray(exportManifest.clips).map(clip => clip.order))
if (duplicateExportOrders.length) exportProblems.push(`duplicate-orders:${duplicateExportOrders.join(',')}`)
const sortedExportOrders = asArray(exportManifest.clips).map(clip => clip.order).sort((left, right) => left - right)
if (sortedExportOrders.some((order, index) => order !== index + 1)) exportProblems.push('non-contiguous-orders')
if (!hasText(exportManifest.delivery?.format)) exportProblems.push('missing-delivery-format')
const computedExportHash = sha256(JSON.stringify({ clips: exportManifest.clips, delivery: exportManifest.delivery }))
if (computedExportHash !== exportManifest.integrityHash) exportProblems.push('integrity-hash-mismatch')
check('EXPORT_INTEGRITY_RECOMPUTED', exportProblems.length === 0, exportProblems)

const hashFiles = asArray(manifest.artifactHashFiles)
const hashProblems = []
const expectedHashFiles = required.filter(name => name !== 'media-production-manifest.json').sort()
if (!hashFiles.length || hashFiles.includes('media-production-manifest.json') || JSON.stringify([...new Set(hashFiles)].sort()) !== JSON.stringify(expectedHashFiles)) hashProblems.push('invalid-artifact-hash-files')
for (const name of hashFiles) {
  const filePath = resolveProductionPath(name)
  if (!filePath || !fs.existsSync(filePath)) hashProblems.push(`missing-hash-file:${name}`)
}
if (!hashProblems.length) {
  const currentHash = sha256(hashFiles.slice().sort().map(name => `${name}\0${fs.readFileSync(resolveProductionPath(name), 'utf8')}`).join('\0'))
  if (currentHash !== manifest.artifactHash) hashProblems.push(`hash-mismatch:${currentHash}`)
}
check('PRODUCTION_RECEIPT_FRESHNESS', hashProblems.length === 0, hashProblems)

finish()

function finish() {
  const result = { result: failures.length ? 'fail' : 'pass', root, productionDir, checks, failures }
  console.log(JSON.stringify(result, null, 2))
  process.exit(failures.length ? 1 : 0)
}
