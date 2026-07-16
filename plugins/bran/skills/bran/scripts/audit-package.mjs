import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(process.argv[2] ?? '.')
const packageDir = path.basename(root) === 'package' ? root : path.join(root, 'package')
const projectRoot = path.basename(root) === 'package' ? path.dirname(root) : root
const failures = []
const checks = []
const fail = message => { failures.push(message) }
const check = (id, pass, evidence) => {
  checks.push({ id, pass, evidence })
  if (!pass) fail(`${id}: ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`)
}
const requireFile = name => {
  const filePath = path.join(packageDir, name)
  if (!fs.existsSync(filePath)) fail(`missing ${name}`)
  return filePath
}
const readJson = name => JSON.parse(fs.readFileSync(requireFile(name), 'utf8'))
const readJsonl = name => fs.readFileSync(requireFile(name), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
const getPath = (object, dottedPath) => dottedPath.split('.').reduce((value, key) => value?.[key], object)
const protectedOutcome = value => ['protected_named', 'protected_anonymous_delayed', 'protected_delayed'].includes(value)

const required = [
  'source-manifest.json', 'state-field-registry.json', 'character-contracts.jsonl',
  'baseline-stage-actions.jsonl', 'recipe-stage-overrides.jsonl', 'compiled-recipe-receipts.jsonl',
  'replay-metrics.json', 'evidence-decisions.jsonl', 'waiting-interactions.jsonl',
  'agent-eval-cases.jsonl', 'agent-eval-receipt.json', 'settlement-rules.json',
  'settlement-test-vectors.jsonl', 'settlement-test-receipt.json', 'carryover-contracts.jsonl',
  'playtest-traces.jsonl', 'playtest-simulation-receipt.json', 'quality-receipt.json',
  'scene-scripts.jsonl', 'dialogue-cues.jsonl', 'canon-visibility.json'
]
for (const name of required) requireFile(name)
if (failures.length) finish()

let quality, replay, settlement, agent, simulation, registry, recipes, baseline, decisions, waiting, carryovers, traces, scenes, cues, canon, manifest, vectors, agentCases
try {
  quality = readJson('quality-receipt.json')
  replay = readJson('replay-metrics.json')
  settlement = readJson('settlement-test-receipt.json')
  agent = readJson('agent-eval-receipt.json')
  simulation = readJson('playtest-simulation-receipt.json')
  registry = readJson('state-field-registry.json')
  recipes = readJsonl('recipe-stage-overrides.jsonl')
  baseline = readJsonl('baseline-stage-actions.jsonl')
  decisions = readJsonl('evidence-decisions.jsonl')
  waiting = readJsonl('waiting-interactions.jsonl')
  carryovers = readJsonl('carryover-contracts.jsonl')
  traces = readJsonl('playtest-traces.jsonl')
  scenes = readJsonl('scene-scripts.jsonl')
  cues = readJsonl('dialogue-cues.jsonl')
  canon = readJson('canon-visibility.json')
  manifest = readJson('source-manifest.json')
  vectors = readJsonl('settlement-test-vectors.jsonl')
  agentCases = readJsonl('agent-eval-cases.jsonl')
} catch (error) {
  fail(`parse error: ${error.message}`)
  finish()
}

const registeredPaths = new Set(registry.fields.map(field => field.path))
const actionList = [...baseline, ...recipes.flatMap(recipe => recipe.stageOverrides.flatMap(stage => stage.actions))]
const actionById = new Map(actionList.map(action => [action.actionInstanceId, action]))
const effectPaths = actionList.flatMap(action => (action.effectOps ?? []).map(operation => operation.path))
  .concat(recipes.flatMap(recipe => recipe.initialResourceMutations.map(operation => operation.path)))
  .filter(Boolean)
const conditionPaths = value => {
  if (!value || typeof value !== 'object') return []
  const own = value.path ? [value.path] : []
  return own.concat((value.all ?? []).flatMap(conditionPaths), (value.any ?? []).flatMap(conditionPaths))
}
const carryoverPaths = carryovers.flatMap(item => [
  ...conditionPaths(item.condition), ...conditionPaths(item.revokeCondition),
  ...item.resourceMutations.map(mutation => mutation.path)
])
const unknownPaths = [...new Set([...effectPaths, ...carryoverPaths].filter(field => !registeredPaths.has(field)))]
check('STATE_PATHS_RECOMPUTED', unknownPaths.length === 0, unknownPaths)

const duplicateValues = values => {
  const seen = new Set()
  return values.filter(value => seen.has(value) || !seen.add(value))
}
const duplicateIds = [
  ...duplicateValues(manifest.artifactIndex.map(item => `artifact:${item.artifactId}`)),
  ...duplicateValues(manifest.sourceFiles.map(item => `source:${item.sourceId}`)),
  ...duplicateValues(cues.map(item => `cue:${item.cueId}`)),
  ...duplicateValues(waiting.map(item => `waiting:${item.waitingId}`)),
  ...duplicateValues(actionList.map(item => `action:${item.actionInstanceId}`))
]
check('PRIMARY_KEYS_RECOMPUTED', duplicateIds.length === 0, duplicateIds)

const missingManifestArtifacts = manifest.artifactIndex.filter(item => !fs.existsSync(path.join(packageDir, item.path))).map(item => item.path)
check('MANIFEST_PATHS_RECOMPUTED', missingManifestArtifacts.length === 0, missingManifestArtifacts)

const canonIds = new Set(canon.canonFacts.map(fact => fact.factId))
const brokenCanonRefs = cues.flatMap(cue => (cue.canonRefs ?? []).filter(id => !canonIds.has(id)).map(id => `${cue.cueId}:${id}`))
check('CANON_REFS_RECOMPUTED', brokenCanonRefs.length === 0, brokenCanonRefs)
check('NO_FIXED_ENDING_COPY_RECOMPUTED', !cues.some(cue => cue.textType === 'public_ending'), cues.filter(cue => cue.textType === 'public_ending').map(cue => cue.cueId))

const decisionFailures = decisions.filter(decision => decision.visibleEvidence.length < 2 || decision.options.length < 2 || decision.options.some(option => {
  const action = actionById.get(option.actionInstanceId)
  return !action || !option.stateEffects.length || !option.nextActionUnlocks.length || JSON.stringify(action.effectOps) !== JSON.stringify(option.stateEffects)
})).map(decision => decision.decisionId)
check('EVIDENCE_ACTION_LINKS_RECOMPUTED', decisions.length >= recipes.length * 2 && decisionFailures.length === 0, decisionFailures)

const waitingFailures = waiting.filter(item => item.availableWhileWaiting.length < 3 || !item.visibleStateRefs.length || !item.willUnlock.length || Object.keys(item.recipeSpecific ?? {}).length !== recipes.length).map(item => item.waitingId)
const waitingActionIds = new Set(waiting.flatMap(item => item.availableWhileWaiting.map(action => action.actionId)))
const brokenWaitingRefs = scenes.flatMap(scene => (scene.mergeGate?.responseActions ?? []).filter(actionId => !waitingActionIds.has(actionId)).map(actionId => `${scene.sceneId}:${actionId}`))
check('WAITING_RECOMPUTED', waitingFailures.length === 0 && brokenWaitingRefs.length === 0, { waitingFailures, brokenWaitingRefs })

const actionTokens = recipe => {
  const overrideByScene = new Map(recipe.stageOverrides.map(stage => [stage.sceneId, stage.actions]))
  return scenes.flatMap(scene => (overrideByScene.get(scene.sceneId) ?? baseline.filter(action => action.sceneId === scene.sceneId)).map(action => `${scene.sceneId}:${action.seat}:${action.actionId}`))
}
const jaccardDistance = (left, right) => {
  const a = new Set(left), b = new Set(right), union = new Set([...a, ...b])
  return union.size ? 1 - [...a].filter(value => b.has(value)).length / union.size : 0
}
const actionDistances = recipes.map((recipe, index) => jaccardDistance(actionTokens(recipe), actionTokens(recipes[(index + 1) % recipes.length])))
const cueReuse = recipes.map((recipe, index) => 1 - jaccardDistance(recipe.decisionCueIds ?? [], recipes[(index + 1) % recipes.length].decisionCueIds ?? []))
const unresolvedStrategyActions = recipes.flatMap(recipe => recipe.strategyOptions.flatMap(strategy => strategy.path.filter(id => !actionById.has(id)).map(id => `${strategy.strategyId}:${id}`)))
check('REPLAY_MECHANICS_RECOMPUTED', recipes.every(recipe => recipe.stageOverrides.length >= 3) && Math.min(...actionDistances) >= 0.30 && Math.max(...cueReuse) <= 0.40 && unresolvedStrategyActions.length === 0, { minDistance: Math.min(...actionDistances), maxCueReuse: Math.max(...cueReuse), unresolvedStrategyActions })

const deriveEnding = state => {
  const escrow = state.protection?.escrow ?? {}
  const escrowActive = escrow.status === 'active' && Boolean(escrow.revisionId) && escrow.signatures?.delilah === escrow.revisionId && escrow.signatures?.cheng === escrow.revisionId && Boolean(escrow.costReceiptId)
  const protectedCount = ['LENNO_RECORDKEEPER', 'BURE_WITNESS'].filter(key => protectedOutcome(state.protection?.outcomes?.[key])).length
  const protectionClass = protectedCount === 2 && escrowActive ? 'dual_escrow' : protectedCount >= 1 ? 'single_named' : 'none'
  const evidenceReady = state.evidence?.aKey?.status === 'verified' && state.evidence?.timeline?.status === 'supported' && state.evidence?.crossReceipt?.status === 'full'
  const authorizationReady = Boolean(state.authorization?.archie?.revisionId) && state.authorization?.archie?.scope !== 'none' && !state.authorization?.archie?.revoked
  const hash = state.draft?.hash
  const signaturesMatch = Boolean(hash) && ['delilah', 'cheng'].every(seat => state.draft?.signatures?.[seat]?.decision === 'confirmed' && state.draft.signatures[seat].revisionHash === hash)
  if (state.authorization?.archie?.revoked) return 'W03'
  if (signaturesMatch && evidenceReady && authorizationReady && protectionClass === 'dual_escrow' && state.resources?.broadcastWindowSec > 0) return 'W01'
  if (signaturesMatch && evidenceReady && authorizationReady && protectionClass === 'single_named' && state.resources?.broadcastWindowSec > 0) return 'W02'
  return 'W04'
}

const vectorFailures = vectors.filter(vector => deriveEnding(vector.state) !== vector.expectedEndingCode).map(vector => vector.vectorId)
check('SETTLEMENT_VECTORS_RECOMPUTED', vectorFailures.length === 0, vectorFailures)

const traceFailures = traces.flatMap(trace => {
  const problems = []
  const sceneIds = new Set(trace.steps.map(step => step.sceneId))
  if (!['S00', 'S10', 'S20', 'S30', 'S40', 'S50', 'S60', 'S70'].every(id => sceneIds.has(id))) problems.push('missing-scene')
  if (trace.mergeReceipts?.length !== 8 || trace.mergeReceipts.some(receipt => !receipt.mergePassed || !receipt.executedBySeat?.delilah || !receipt.executedBySeat?.cheng)) problems.push('merge-failed')
  if (trace.steps.some(step => !step.preconditionsPassed || !step.costsPaid)) problems.push('action-failed')
  const recomputedEnding = deriveEnding(trace.finalWorldState)
  if (recomputedEnding !== trace.actualEndingCode || trace.actualEndingCode !== trace.targetEndingCode || trace.settlementReceipt?.endingCode !== trace.actualEndingCode) problems.push(`ending-mismatch:${recomputedEnding}/${trace.actualEndingCode}/${trace.targetEndingCode}`)
  if (trace.finalWorldState.protection?.escrow?.status === 'active') {
    const escrow = trace.finalWorldState.protection.escrow
    if (!escrow.costReceiptId || escrow.signatures.delilah !== escrow.revisionId || escrow.signatures.cheng !== escrow.revisionId) problems.push('invalid-active-escrow')
  }
  if (Object.values(trace.finalWorldState.draft?.signatures ?? {}).some(signature => signature.decision === 'confirmed' && (!trace.finalWorldState.draft.hash || signature.revisionHash !== trace.finalWorldState.draft.hash))) problems.push('invalid-draft-signature')
  return problems.map(problem => `${trace.runId}:${problem}`)
})
const endingCoverage = new Set(traces.map(trace => trace.actualEndingCode))
check('FULL_TRACES_RECOMPUTED', traces.length >= recipes.length * 3 && traceFailures.length === 0 && endingCoverage.size === 4, { traces: traces.length, endingCoverage: [...endingCoverage].sort(), traceFailures })

const computedUniversalDominance = []
for (const recipe of recipes) {
  const runs = traces.filter(trace => trace.recipeId === recipe.recipeId)
  for (const left of runs) {
    const dominates = runs.filter(right => left.runId !== right.runId && Object.keys(left.computedUtility).every(key => left.computedUtility[key] >= right.computedUtility[key]) && Object.keys(left.computedUtility).some(key => left.computedUtility[key] > right.computedUtility[key]))
    if (dominates.length === runs.length - 1) computedUniversalDominance.push(left.runId)
  }
}
check('NO_UNIVERSAL_DOMINANCE_RECOMPUTED', computedUniversalDominance.length === 0, computedUniversalDominance)

const agentActionIds = new Set(actionList.map(action => action.actionInstanceId))
const agentCaseFailures = agentCases.filter(test => !test.requiredInformationUnits?.length || !test.fixtureAnswer || (test.nextActionId && !agentActionIds.has(test.nextActionId))).map(test => test.caseId)
check('AGENT_CASES_RECOMPUTED', agentCaseFailures.length === 0 && agent.passRate >= 0.80, agentCaseFailures)
check('CARRYOVER_CLASSES_RECOMPUTED', new Set(carryovers.map(item => item.consequenceClass)).size >= 4, [...new Set(carryovers.map(item => item.consequenceClass))])

if (quality.artifactHash && quality.artifactHashFiles?.length) {
  const currentHash = crypto.createHash('sha256').update(quality.artifactHashFiles.slice().sort().map(name => `${name}\0${fs.readFileSync(path.join(packageDir, name), 'utf8')}`).join('\0')).digest('hex')
  check('QUALITY_RECEIPT_FRESHNESS', currentHash === quality.artifactHash, { expected: quality.artifactHash, actual: currentHash })
} else {
  check('QUALITY_RECEIPT_FRESHNESS', false, 'quality receipt has no artifact hash')
}

check('CACHED_RECEIPTS_COHERENT', quality.status === 'pass' && !quality.blockers.length && replay.pass && settlement.pass && agent.pass && simulation.pass, {
  quality: quality.status, replay: replay.pass, settlement: settlement.pass, agent: agent.pass, simulation: simulation.pass
})

if (!failures.length) {
  const validatorPath = ['validate-handoff-v4.mjs', 'validate-handoff-v3.mjs', 'validate-handoff.mjs']
    .map(name => path.join(projectRoot, 'tools', name))
    .find(candidate => fs.existsSync(candidate))
  if (validatorPath) {
    try {
      execFileSync(process.execPath, [validatorPath], { cwd: projectRoot, stdio: 'pipe' })
      checks.push({ id: 'PACKAGE_VALIDATOR_EXECUTED', pass: true, evidence: validatorPath })
    } catch (error) {
      fail(`PACKAGE_VALIDATOR_EXECUTED: ${error.stderr?.toString() || error.message}`)
    }
  }
}

finish()

function finish() {
  const result = { result: failures.length ? 'fail' : 'pass', root, checks, failures }
  console.log(JSON.stringify(result, null, 2))
  process.exit(failures.length ? 1 : 0)
}
