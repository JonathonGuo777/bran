import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  artifactHash,
  collectConditionPaths,
  createDiagnostic,
  hasErrors,
  readJson,
  readJsonl,
  resolvePackageDirectory,
  uniqueDuplicates
} from './common.mjs'
import { evaluateSettlement } from './expressions.mjs'
import { buildReviewReceipt } from './review.mjs'

const DEFAULT_PROFILE = {
  level: 'release',
  minimumChangedScenes: 3,
  minimumActionGraphDistance: 0.30,
  maximumDecisionCueReuse: 0.40,
  minimumEvidenceStatements: 2,
  minimumWaitingActions: 3,
  minimumAgentPassRate: 0.80,
  minimumCarryoverClasses: 4,
  minimumRunsPerRecipe: 3
}

const RELEASE_FILES = [
  'compiled-recipe-receipts.jsonl',
  'replay-metrics.json',
  'evidence-decisions.jsonl',
  'waiting-interactions.jsonl',
  'agent-eval-cases.jsonl',
  'agent-eval-receipt.json',
  'carryover-contracts.jsonl',
  'playtest-traces.jsonl',
  'playtest-simulation-receipt.json',
  'settlement-test-receipt.json',
  'quality-receipt.json'
]

const jaccardDistance = (left, right) => {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const union = new Set([...leftSet, ...rightSet])
  return union.size ? 1 - [...leftSet].filter(value => rightSet.has(value)).length / union.size : 0
}

const actionGraphTokens = (sceneOrder, baseline, recipe) => {
  const overrides = new Map((recipe?.stageOverrides ?? []).map(stage => [stage.sceneId, stage.actions ?? []]))
  return sceneOrder.flatMap(sceneId => {
    const actions = overrides.has(sceneId) ? overrides.get(sceneId) : baseline.filter(action => action.sceneId === sceneId)
    return actions.map(action => `${sceneId}:${action.seat}:${action.actionId}:${JSON.stringify(action.preconditions ?? [])}:${JSON.stringify(action.effectOps ?? [])}`)
  })
}

const parseArtifact = (packageDir, artifact, diagnostics) => {
  const filePath = path.join(packageDir, artifact.path)
  if (!fs.existsSync(filePath)) {
    diagnostics.push(createDiagnostic('ARTIFACT_MISSING', 'error', `Manifest artifact is missing: ${artifact.path}`, { path: artifact.path }))
    return null
  }
  try {
    return artifact.format === 'jsonl' ? readJsonl(filePath) : readJson(filePath)
  } catch (error) {
    diagnostics.push(createDiagnostic('ARTIFACT_PARSE_FAILED', 'error', error.message, { path: artifact.path }))
    return null
  }
}

export const auditPackage = ({ root, level }) => {
  const packageDir = resolvePackageDirectory(root)
  const projectRoot = path.basename(path.resolve(root)) === 'package' ? path.dirname(path.resolve(root)) : path.resolve(root)
  const diagnostics = []
  const checks = []
  const check = (id, pass, evidence, severity = 'error') => {
    const passed = Boolean(pass)
    checks.push({ id, pass: passed, evidence })
    if (!passed) diagnostics.push(createDiagnostic(id, severity, `${id} failed.`, { evidence }))
  }

  const manifestPath = path.join(packageDir, 'source-manifest.json')
  if (!fs.existsSync(manifestPath)) {
    diagnostics.push(createDiagnostic('MANIFEST_MISSING', 'error', `Missing source-manifest.json in ${packageDir}.`))
    return { result: 'fail', root: path.resolve(root), packageDir, checks, diagnostics }
  }

  let manifest
  try {
    manifest = readJson(manifestPath)
  } catch (error) {
    diagnostics.push(createDiagnostic('MANIFEST_PARSE_FAILED', 'error', error.message))
    return { result: 'fail', root: path.resolve(root), packageDir, checks, diagnostics }
  }
  const profile = { ...DEFAULT_PROFILE, ...(manifest.auditProfile ?? {}), ...(level ? { level } : {}) }
  const artifactIndex = manifest.artifactIndex ?? []
  check('MANIFEST_ARTIFACT_INDEX', artifactIndex.length > 0, { count: artifactIndex.length })
  const duplicateArtifactIds = uniqueDuplicates(artifactIndex.map(item => item.artifactId))
  const duplicateArtifactPaths = uniqueDuplicates(artifactIndex.map(item => item.path))
  check('MANIFEST_PRIMARY_KEYS', duplicateArtifactIds.length === 0 && duplicateArtifactPaths.length === 0, { duplicateArtifactIds, duplicateArtifactPaths })

  const artifacts = new Map()
  for (const artifact of artifactIndex) artifacts.set(artifact.path, parseArtifact(packageDir, artifact, diagnostics))
  const load = (name, format = name.endsWith('.jsonl') ? 'jsonl' : 'json') => {
    if (artifacts.has(name)) return artifacts.get(name)
    const filePath = path.join(packageDir, name)
    if (!fs.existsSync(filePath)) return null
    try {
      const parsed = format === 'jsonl' ? readJsonl(filePath) : readJson(filePath)
      artifacts.set(name, parsed)
      return parsed
    } catch (error) {
      diagnostics.push(createDiagnostic('ARTIFACT_PARSE_FAILED', 'error', error.message, { path: name }))
      return null
    }
  }

  const requiredCompileFiles = [
    'canon-visibility.json',
    'character-contracts.jsonl',
    'scene-scripts.jsonl',
    'state-field-registry.json',
    'baseline-stage-actions.jsonl',
    'recipe-stage-overrides.jsonl',
    'settlement-rules.json',
    'settlement-test-vectors.jsonl'
  ]
  const requiredFiles = profile.level === 'release' ? [...requiredCompileFiles, ...RELEASE_FILES] : requiredCompileFiles
  const missingRequired = requiredFiles.filter(name => !fs.existsSync(path.join(packageDir, name)))
  check('REQUIRED_ARTIFACTS', missingRequired.length === 0, missingRequired)
  if (hasErrors(diagnostics)) return { result: 'fail', root: path.resolve(root), packageDir, level: profile.level, checks, diagnostics }

  const sourceEvents = load('source-events.jsonl') ?? []
  const canon = load('canon-visibility.json')
  const characters = load('character-contracts.jsonl')
  const scenes = load('scene-scripts.jsonl')
  const stateRegistry = load('state-field-registry.json')
  const baseline = load('baseline-stage-actions.jsonl')
  const recipes = load('recipe-stage-overrides.jsonl')
  const settlementRules = load('settlement-rules.json')
  const settlementVectors = load('settlement-test-vectors.jsonl')
  const graph = load('narrative-graph.json')
  const productionRequest = load('production-request.json')
  const runtimeContract = load('runtime-contract.json')
  const agentContract = load('agent-runtime-contract.json')
  const compileReceipt = load('compile-receipt.json')
  const reviewLedger = load('review-ledger.jsonl')
  const reviewReceipt = load('review-receipt.json')

  const sceneOrder = manifest.sceneOrder ?? scenes.map(scene => scene.sceneId)
  const sceneIds = new Set(scenes.map(scene => scene.sceneId))
  const sourceIds = new Set((manifest.sourceFiles ?? []).map(source => source.sourceId))
  const eventIds = new Set(sourceEvents.map(event => event.eventId))
  const factIds = new Set((canon.canonFacts ?? []).map(fact => fact.factId))
  const characterIds = new Set(characters.map(character => character.characterId))
  const registeredPaths = new Set((stateRegistry.fields ?? []).map(field => field.path))
  const derivedPaths = new Set((stateRegistry.derivedFields ?? []).map(field => field.path))
  const actionList = [...baseline, ...recipes.flatMap(recipe => (recipe.stageOverrides ?? []).flatMap(stage => stage.actions ?? []))]

  const duplicateIds = [
    ...uniqueDuplicates(sourceEvents.map(item => `event:${item.eventId}`)),
    ...uniqueDuplicates((canon.canonFacts ?? []).map(item => `fact:${item.factId}`)),
    ...uniqueDuplicates(characters.map(item => `character:${item.characterId}`)),
    ...uniqueDuplicates(scenes.map(item => `scene:${item.sceneId}`)),
    ...uniqueDuplicates(actionList.map(item => `action:${item.actionInstanceId}`)),
    ...uniqueDuplicates(recipes.map(item => `recipe:${item.recipeId}`)),
    ...uniqueDuplicates((settlementRules.rules ?? []).map(item => `ending:${item.endingCode}`))
  ]
  check('PRIMARY_KEYS_RECOMPUTED', duplicateIds.length === 0, duplicateIds)
  check('SCENE_ORDER_RESOLVED', sceneOrder.length === scenes.length && sceneOrder.every(sceneId => sceneIds.has(sceneId)), { sceneOrder, sceneCount: scenes.length })

  const sourceFailures = sourceEvents.flatMap(event => [
    ...(event.sourceSpans ?? []).filter(span => !sourceIds.has(span.sourceId)).map(span => `${event.eventId}:source:${span.sourceId}`),
    ...(event.causeEventIds ?? []).filter(eventId => !eventIds.has(eventId)).map(eventId => `${event.eventId}:cause:${eventId}`)
  ])
  check('SOURCE_EVENTS_GROUNDED', sourceEvents.length === 0 || sourceFailures.length === 0, sourceFailures, sourceEvents.length ? 'error' : 'warning')

  const canonFailures = (canon.canonFacts ?? []).flatMap(fact => (fact.sourceEventIds ?? []).filter(eventId => sourceEvents.length && !eventIds.has(eventId)).map(eventId => `${fact.factId}:${eventId}`))
  const characterFailures = characters.flatMap(character => (character.knowledgeFactIds ?? []).filter(factId => !factIds.has(factId)).map(factId => `${character.characterId}:${factId}`))
  check('CANON_AND_CHARACTER_REFS', canonFailures.length === 0 && characterFailures.length === 0, { canonFailures, characterFailures })

  const graphFailures = []
  for (const node of graph?.nodes ?? scenes) {
    for (const nextSceneId of node.nextSceneIds ?? []) if (!sceneIds.has(nextSceneId)) graphFailures.push(`${node.sceneId}:next:${nextSceneId}`)
    for (const eventId of node.eventIds ?? []) if (sourceEvents.length && !eventIds.has(eventId)) graphFailures.push(`${node.sceneId}:event:${eventId}`)
  }
  check('NARRATIVE_GRAPH_REFS', graphFailures.length === 0, graphFailures)

  const actionPathFailures = actionList.flatMap(action => [
    ...(action.effectOps ?? []).filter(operation => !registeredPaths.has(operation.path)).map(operation => `${action.actionInstanceId}:write:${operation.path}`),
    ...(action.costs ?? []).filter(operation => !registeredPaths.has(operation.path)).map(operation => `${action.actionInstanceId}:cost:${operation.path}`),
    ...(action.preconditions ?? []).flatMap(condition => collectConditionPaths(condition).filter(conditionPath => !registeredPaths.has(conditionPath) && !derivedPaths.has(conditionPath)).map(conditionPath => `${action.actionInstanceId}:read:${conditionPath}`))
  ])
  check('STATE_PATHS_RECOMPUTED', actionPathFailures.length === 0, actionPathFailures)

  const actionReferenceIds = new Set(actionList.flatMap(action => [action.actionId, action.actionInstanceId]).filter(Boolean))
  const counteractionFailures = actionList.filter(action => action.counteractionId && !actionReferenceIds.has(action.counteractionId)).map(action => `${action.actionInstanceId}:${action.counteractionId}`)
  const strategyFailures = recipes.flatMap(recipe => (recipe.strategyOptions ?? []).flatMap(strategy => (strategy.path ?? []).filter(actionId => !actionReferenceIds.has(actionId)).map(actionId => `${strategy.strategyId}:${actionId}`)))
  check('ACTION_GRAPH_REFS_RECOMPUTED', counteractionFailures.length === 0 && strategyFailures.length === 0, { counteractionFailures, strategyFailures })

  const derivedFailures = (stateRegistry.derivedFields ?? []).filter(field => !field.path || !field.expression).map(field => field.path ?? '<missing-path>')
  check('DERIVED_FIELDS_EXECUTABLE', derivedFailures.length === 0, derivedFailures)

  const settlementFailures = []
  const settlementDiagnostics = []
  for (const vector of settlementVectors) {
    const vectorDiagnostics = []
    const result = evaluateSettlement(vector.state, settlementRules, stateRegistry, vectorDiagnostics)
    settlementDiagnostics.push(...vectorDiagnostics.map(item => ({ vectorId: vector.vectorId, ...item })))
    if (result.endingCode !== vector.expectedEndingCode) settlementFailures.push(`${vector.vectorId}:${result.endingCode}/${vector.expectedEndingCode}`)
  }
  check('SETTLEMENT_VECTORS_RECOMPUTED', settlementFailures.length === 0 && !settlementDiagnostics.some(item => item.severity === 'error'), { settlementFailures, diagnostics: settlementDiagnostics })

  const baselineTokens = actionGraphTokens(sceneOrder, baseline, null)
  const changedSceneFailures = recipes.filter(recipe => new Set((recipe.stageOverrides ?? []).map(stage => stage.sceneId)).size < profile.minimumChangedScenes).map(recipe => recipe.recipeId)
  const distances = recipes.map((recipe, index) => {
    const comparison = recipes.length > 1 ? recipes[(index + 1) % recipes.length] : null
    return {
      recipeId: recipe.recipeId,
      comparedWith: comparison?.recipeId ?? 'baseline',
      distance: jaccardDistance(actionGraphTokens(sceneOrder, baseline, recipe), comparison ? actionGraphTokens(sceneOrder, baseline, comparison) : baselineTokens)
    }
  })
  const distanceFailures = distances.filter(item => item.distance < profile.minimumActionGraphDistance)
  check('REPLAY_MECHANICS_RECOMPUTED', changedSceneFailures.length === 0 && distanceFailures.length === 0, { changedSceneFailures, distances })

  const cueReuseFailures = []
  if (recipes.length > 1) {
    for (let index = 0; index < recipes.length; index += 1) {
      const left = recipes[index].decisionCueIds ?? []
      const right = recipes[(index + 1) % recipes.length].decisionCueIds ?? []
      const reuse = 1 - jaccardDistance(left, right)
      if (reuse > profile.maximumDecisionCueReuse) cueReuseFailures.push(`${recipes[index].recipeId}:${reuse}`)
    }
  }
  check('DECISION_CUE_REUSE_RECOMPUTED', cueReuseFailures.length === 0, cueReuseFailures)

  const slotFailures = []
  for (const slot of productionRequest?.assetSlots ?? []) {
    if (!sceneIds.has(slot.sceneId)) slotFailures.push(`${slot.assetSlotId}:scene:${slot.sceneId}`)
    for (const characterId of slot.requiredCharacters ?? []) if (!characterIds.has(characterId)) slotFailures.push(`${slot.assetSlotId}:character:${characterId}`)
  }
  check('PRODUCTION_REQUEST_REFS', slotFailures.length === 0, slotFailures)
  check('PRODUCTION_AUTHORITY_BOUNDARY', !productionRequest || (
    productionRequest.authority?.narrativeOwner === 'bran' &&
    typeof productionRequest.authority?.materialOwner === 'string' &&
    productionRequest.authority?.rule?.includes('cannot mutate narrative world state')
  ), productionRequest?.authority ?? null)
  check('RUNTIME_AUTHORITY_BOUNDARY', !runtimeContract || (
    runtimeContract.authority?.content === 'hodor.bran' &&
    runtimeContract.authority?.stateMutationRule?.includes('typed action') &&
    runtimeContract.eventContracts?.WorldEvent &&
    runtimeContract.eventContracts?.RelationshipEventCandidate &&
    runtimeContract.eventContracts?.ContentFeedback
  ), runtimeContract?.authority ?? null)

  const agentContractFailures = (agentContract?.contracts ?? []).flatMap(contract => [
    ...(!characterIds.has(contract.agentId) ? [`${contract.agentId}:character`] : []),
    ...(contract.knowledgeFactIds ?? []).filter(factId => !factIds.has(factId)).map(factId => `${contract.agentId}:fact:${factId}`),
    ...(contract.actionAllowlist ?? []).filter(actionId => !actionReferenceIds.has(actionId)).map(actionId => `${contract.agentId}:action:${actionId}`),
    ...(!['none', 'candidate-only'].includes(contract.memoryAccess?.writeMode) ? [`${contract.agentId}:memory-write:${contract.memoryAccess?.writeMode}`] : [])
  ])
  check('AGENT_CONTRACT_REFS', agentContractFailures.length === 0, agentContractFailures)

  if (compileReceipt?.artifactHash && compileReceipt?.artifactHashFiles?.length) {
    const missingHashFiles = compileReceipt.artifactHashFiles.filter(name => !fs.existsSync(path.join(packageDir, name)))
    const currentHash = missingHashFiles.length ? null : artifactHash(packageDir, compileReceipt.artifactHashFiles)
    check('COMPILE_RECEIPT_FRESHNESS', missingHashFiles.length === 0 && currentHash === compileReceipt.artifactHash, { expected: compileReceipt.artifactHash, actual: currentHash, missingHashFiles })
  } else if (manifest.schemaVersion === '1.0.0') {
    check('COMPILE_RECEIPT_FRESHNESS', false, 'compile-receipt.json has no artifact hash')
  }

  if (reviewLedger && reviewReceipt) {
    const recomputedReview = buildReviewReceipt({ packageDir, manifest, ledger: reviewLedger, updatedAt: reviewReceipt.updatedAt })
    const coherent = [
      'requiredStages',
      'status',
      'latestStatusByStage',
      'reviewedArtifactHashes',
      'currentArtifactHashes',
      'staleStages',
      'ledgerHash',
      'manifestHash'
    ].every(key => JSON.stringify(reviewReceipt[key]) === JSON.stringify(recomputedReview[key]))
    const lifecycleValid = manifest.lifecycle === 'compiled'
      ? reviewReceipt.status !== 'pass'
      : ['reviewed', 'release'].includes(manifest.lifecycle) && reviewReceipt.status === 'pass'
    check('REVIEW_RECEIPT_COHERENT', coherent && lifecycleValid, { lifecycle: manifest.lifecycle, status: reviewReceipt.status, staleStages: recomputedReview.staleStages })
  } else if (manifest.schemaVersion === '1.0.0') {
    check('REVIEW_RECEIPT_COHERENT', false, 'review-ledger.jsonl or review-receipt.json is missing')
  }

  if (profile.level === 'release' && !hasErrors(diagnostics)) {
    auditRelease({ packageDir, manifest, profile, sceneOrder, scenes, baseline, recipes, settlementRules, stateRegistry, load, check })
  }

  if (!hasErrors(diagnostics)) {
    const validatorPath = ['validate-handoff-v4.mjs', 'validate-handoff-v3.mjs', 'validate-handoff.mjs']
      .map(name => path.join(projectRoot, 'tools', name))
      .find(candidate => fs.existsSync(candidate))
    if (validatorPath) {
      try {
        execFileSync(process.execPath, [validatorPath], { cwd: projectRoot, stdio: 'pipe' })
        checks.push({ id: 'PACKAGE_VALIDATOR_EXECUTED', pass: true, evidence: validatorPath })
      } catch (error) {
        diagnostics.push(createDiagnostic('PACKAGE_VALIDATOR_EXECUTED', 'error', error.stderr?.toString() || error.message))
      }
    }
  }

  return {
    result: hasErrors(diagnostics) ? 'fail' : 'pass',
    root: path.resolve(root),
    packageDir,
    level: profile.level,
    checks,
    diagnostics
  }
}

const auditRelease = ({ packageDir, manifest, profile, sceneOrder, baseline, recipes, settlementRules, stateRegistry, load, check }) => {
  const decisions = load('evidence-decisions.jsonl') ?? []
  const waiting = load('waiting-interactions.jsonl') ?? []
  const agentCases = load('agent-eval-cases.jsonl') ?? []
  const agentReceipt = load('agent-eval-receipt.json') ?? {}
  const carryovers = load('carryover-contracts.jsonl') ?? []
  const traces = load('playtest-traces.jsonl') ?? []
  const simulationReceipt = load('playtest-simulation-receipt.json') ?? {}
  const settlementReceipt = load('settlement-test-receipt.json') ?? {}
  const quality = load('quality-receipt.json') ?? {}
  const actionIds = new Set([...baseline, ...recipes.flatMap(recipe => (recipe.stageOverrides ?? []).flatMap(stage => stage.actions ?? []))].map(action => action.actionInstanceId))

  const decisionFailures = decisions.filter(decision => (
    (decision.visibleEvidence ?? []).length < profile.minimumEvidenceStatements ||
    (decision.options ?? []).length < 2 ||
    (decision.options ?? []).some(option => !actionIds.has(option.actionInstanceId) || !(option.stateEffects ?? []).length)
  )).map(decision => decision.decisionId)
  check('EVIDENCE_ACTION_LINKS_RECOMPUTED', decisionFailures.length === 0, decisionFailures)

  const waitingFailures = waiting.filter(item => (
    (item.availableWhileWaiting ?? []).length < profile.minimumWaitingActions ||
    !(item.visibleStateRefs ?? []).length ||
    !(item.willUnlock ?? []).length
  )).map(item => item.waitingId)
  check('WAITING_RECOMPUTED', waitingFailures.length === 0, waitingFailures)

  const agentCaseFailures = agentCases.filter(test => !(test.requiredInformationUnits ?? []).length || !test.fixtureAnswer || (test.nextActionId && !actionIds.has(test.nextActionId))).map(test => test.caseId)
  check('AGENT_CASES_RECOMPUTED', agentCaseFailures.length === 0 && agentReceipt.passRate >= profile.minimumAgentPassRate, { agentCaseFailures, passRate: agentReceipt.passRate })

  const consequenceClasses = new Set(carryovers.map(item => item.consequenceClass))
  check('CARRYOVER_CLASSES_RECOMPUTED', consequenceClasses.size >= profile.minimumCarryoverClasses, [...consequenceClasses].sort())

  const traceFailures = []
  for (const trace of traces) {
    const coveredScenes = new Set((trace.steps ?? []).map(step => step.sceneId))
    const receipts = new Map((trace.mergeReceipts ?? []).map(receipt => [receipt.sceneId, receipt]))
    const missingScenes = sceneOrder.filter(sceneId => !coveredScenes.has(sceneId))
    const mergeFailures = sceneOrder.filter(sceneId => {
      const receipt = receipts.get(sceneId)
      return !receipt || !receipt.mergePassed || (receipt.requiredSeats ?? []).some(seat => !receipt.executedBySeat?.[seat])
    })
    const actionFailures = (trace.steps ?? []).filter(step => !step.preconditionsPassed || !step.costsPaid).map(step => step.step)
    const settlementDiagnostics = []
    const derived = evaluateSettlement(trace.finalWorldState, settlementRules, stateRegistry, settlementDiagnostics)
    if (missingScenes.length) traceFailures.push(`${trace.runId}:missing-scenes:${missingScenes.join(',')}`)
    if (mergeFailures.length) traceFailures.push(`${trace.runId}:merge-failures:${mergeFailures.join(',')}`)
    if (actionFailures.length) traceFailures.push(`${trace.runId}:action-failures:${actionFailures.join(',')}`)
    if (settlementDiagnostics.some(item => item.severity === 'error') || derived.endingCode !== trace.actualEndingCode || trace.actualEndingCode !== trace.targetEndingCode) {
      traceFailures.push(`${trace.runId}:ending:${derived.endingCode}/${trace.actualEndingCode}/${trace.targetEndingCode}`)
    }
  }
  const runCountFailures = recipes.filter(recipe => traces.filter(trace => trace.recipeId === recipe.recipeId).length < profile.minimumRunsPerRecipe).map(recipe => recipe.recipeId)
  const intendedEndings = new Set((settlementRules.rules ?? []).map(rule => rule.endingCode))
  const coveredEndings = new Set(traces.map(trace => trace.actualEndingCode))
  const missingEndings = [...intendedEndings].filter(code => !coveredEndings.has(code))
  check('FULL_TRACES_RECOMPUTED', traceFailures.length === 0 && runCountFailures.length === 0 && missingEndings.length === 0, { traceFailures, runCountFailures, missingEndings })

  const dominanceFailures = []
  for (const recipe of recipes) {
    const runs = traces.filter(trace => trace.recipeId === recipe.recipeId)
    for (const left of runs) {
      const utilityKeys = Object.keys(left.computedUtility ?? {})
      const dominates = runs.filter(right => left.runId !== right.runId && utilityKeys.every(key => left.computedUtility[key] >= right.computedUtility?.[key]) && utilityKeys.some(key => left.computedUtility[key] > right.computedUtility?.[key]))
      if (runs.length > 1 && dominates.length === runs.length - 1) dominanceFailures.push(left.runId)
    }
  }
  check('NO_UNIVERSAL_DOMINANCE_RECOMPUTED', dominanceFailures.length === 0, dominanceFailures)

  if (quality.artifactHash && quality.artifactHashFiles?.length) {
    const missingHashFiles = quality.artifactHashFiles.filter(name => !fs.existsSync(path.join(packageDir, name)))
    const currentHash = missingHashFiles.length ? null : artifactHash(packageDir, quality.artifactHashFiles)
    check('QUALITY_RECEIPT_FRESHNESS', missingHashFiles.length === 0 && currentHash === quality.artifactHash, { expected: quality.artifactHash, actual: currentHash, missingHashFiles })
  } else {
    check('QUALITY_RECEIPT_FRESHNESS', false, 'quality-receipt.json has no artifact hash')
  }
  check('CACHED_RECEIPTS_COHERENT', quality.status === 'pass' && !(quality.blockers ?? []).length && simulationReceipt.pass && settlementReceipt.pass && agentReceipt.pass, {
    quality: quality.status,
    simulation: simulationReceipt.pass,
    settlement: settlementReceipt.pass,
    agent: agentReceipt.pass
  })
}
