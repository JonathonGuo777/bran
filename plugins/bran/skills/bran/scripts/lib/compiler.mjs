import fs from 'node:fs'
import path from 'node:path'
import {
  artifactHash,
  collectConditionPaths,
  createDiagnostic,
  ensureDirectory,
  hasErrors,
  readJson,
  sha256,
  uniqueDuplicates,
  writeJson,
  writeJsonl
} from './common.mjs'
import { evaluateSettlement } from './expressions.mjs'
import { buildReviewReceipt, normalizeInitialReview } from './review.mjs'

const SCHEMA_BASE = 'https://github.com/JonathonGuo777/bran/schemas'
const operationsByStateType = {
  boolean: new Set(['set', 'toggle']),
  integer: new Set(['set', 'increment', 'decrement']),
  number: new Set(['set', 'increment', 'decrement']),
  string: new Set(['set', 'append']),
  array: new Set(['set', 'append', 'remove']),
  inventory: new Set(['set', 'append', 'remove'])
}

const valueMatchesStateType = (value, type) => {
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'array' || type === 'inventory') return Array.isArray(value)
  return false
}

const operationValueMatches = (operation, type) => {
  if (operation.op === 'toggle') return operation.value === undefined
  if (operation.op === 'increment' || operation.op === 'decrement') return typeof operation.value === 'number' && Number.isFinite(operation.value)
  if (operation.op === 'append' && type === 'string') return typeof operation.value === 'string'
  if (operation.op === 'append' || operation.op === 'remove') return operation.value !== undefined
  if (operation.op === 'set') return valueMatchesStateType(operation.value, type)
  return false
}

const validateIdentifiers = (label, values, diagnostics) => {
  const missing = values.map((value, index) => value ? null : index).filter(value => value !== null)
  const duplicates = uniqueDuplicates(values.filter(Boolean))
  if (missing.length) diagnostics.push(createDiagnostic('ID_MISSING', 'error', `${label} contains records without stable IDs.`, { evidence: missing }))
  if (duplicates.length) diagnostics.push(createDiagnostic('ID_DUPLICATE', 'error', `${label} contains duplicate IDs.`, { evidence: duplicates }))
}

const validateInput = bundle => {
  const diagnostics = []
  const required = ['schemaVersion', 'project', 'sources', 'sourceEvents', 'canonFacts', 'characters', 'stateModel', 'scenes', 'recipes', 'settlement', 'agents', 'runtime', 'productionHandoff', 'review']
  for (const key of required) {
    if (bundle[key] === undefined) diagnostics.push(createDiagnostic('INPUT_REQUIRED_FIELD_MISSING', 'error', `Input bundle is missing ${key}.`, { path: key }))
  }
  if (hasErrors(diagnostics)) return diagnostics
  if (bundle.schemaVersion !== '1.0.0') diagnostics.push(createDiagnostic('INPUT_SCHEMA_VERSION_UNSUPPORTED', 'error', `Unsupported input schema version ${bundle.schemaVersion}.`))

  validateIdentifiers('sources', bundle.sources.map(item => item.sourceId), diagnostics)
  validateIdentifiers('source events', bundle.sourceEvents.map(item => item.eventId), diagnostics)
  validateIdentifiers('canon facts', bundle.canonFacts.map(item => item.factId), diagnostics)
  validateIdentifiers('characters', bundle.characters.map(item => item.characterId), diagnostics)
  validateIdentifiers('scenes', bundle.scenes.map(item => item.sceneId), diagnostics)
  validateIdentifiers('recipes', bundle.recipes.map(item => item.recipeId), diagnostics)
  validateIdentifiers('settlement rules', bundle.settlement.rules.map(item => item.endingCode), diagnostics)
  validateIdentifiers('settlement vectors', bundle.settlement.testVectors.map(item => item.vectorId), diagnostics)

  const sourceIds = new Set(bundle.sources.map(item => item.sourceId))
  const eventIds = new Set(bundle.sourceEvents.map(item => item.eventId))
  const factIds = new Set(bundle.canonFacts.map(item => item.factId))
  const characterIds = new Set(bundle.characters.map(item => item.characterId))
  const sceneIds = new Set(bundle.scenes.map(item => item.sceneId))
  const fieldPaths = new Set((bundle.stateModel.fields ?? []).map(item => item.path))
  const fieldsByPath = new Map((bundle.stateModel.fields ?? []).map(item => [item.path, item]))
  const derivedPaths = new Set((bundle.stateModel.derivedFields ?? []).map(item => item.path))
  const entrySceneId = bundle.project.entrySceneId ?? bundle.scenes[0]?.sceneId
  if (!entrySceneId || !sceneIds.has(entrySceneId)) {
    diagnostics.push(createDiagnostic('ENTRY_SCENE_UNRESOLVED', 'error', `Project entry scene ${entrySceneId ?? '<missing>'} does not exist.`))
  }

  for (const [index, event] of bundle.sourceEvents.entries()) {
    if (!event.eventId || !Number.isInteger(event.order) || !event.title || !event.summary || !event.action || !event.result) {
      diagnostics.push(createDiagnostic('SOURCE_EVENT_INCOMPLETE', 'error', 'Source event is missing required narrative fields.', { path: `sourceEvents[${index}]` }))
    }
    if (!Array.isArray(event.sourceSpans) || event.sourceSpans.length === 0) {
      diagnostics.push(createDiagnostic('SOURCE_EVENT_UNGROUNDED', 'error', `Source event ${event.eventId} has no source spans.`, { path: `sourceEvents[${index}].sourceSpans` }))
    }
    for (const span of event.sourceSpans ?? []) {
      if (!sourceIds.has(span.sourceId)) diagnostics.push(createDiagnostic('SOURCE_REFERENCE_UNRESOLVED', 'error', `Source event ${event.eventId} references unknown source ${span.sourceId}.`))
    }
    for (const causeId of event.causeEventIds ?? []) {
      if (!eventIds.has(causeId)) diagnostics.push(createDiagnostic('EVENT_CAUSE_UNRESOLVED', 'error', `Source event ${event.eventId} references unknown cause ${causeId}.`))
      const cause = bundle.sourceEvents.find(item => item.eventId === causeId)
      if (cause && cause.order >= event.order) diagnostics.push(createDiagnostic('EVENT_CAUSAL_ORDER_INVALID', 'error', `Source event ${event.eventId} depends on ${causeId} at the same or a later order.`))
    }
  }

  for (const fact of bundle.canonFacts) {
    for (const eventId of fact.sourceEventIds ?? []) {
      if (!eventIds.has(eventId)) diagnostics.push(createDiagnostic('CANON_EVENT_UNRESOLVED', 'error', `Canon fact ${fact.factId} references unknown event ${eventId}.`))
    }
  }
  for (const character of bundle.characters) {
    for (const factId of character.knowledgeFactIds ?? []) {
      if (!factIds.has(factId)) diagnostics.push(createDiagnostic('CHARACTER_FACT_UNRESOLVED', 'error', `Character ${character.characterId} references unknown canon fact ${factId}.`))
    }
  }

  for (const [index, field] of (bundle.stateModel.fields ?? []).entries()) {
    if (!field.path || !field.type || !Object.hasOwn(field, 'defaultValue') || !Array.isArray(field.writers) || field.writers.length === 0) {
      diagnostics.push(createDiagnostic('STATE_FIELD_INCOMPLETE', 'error', 'State field needs path, type, defaultValue, and at least one authorized writer.', { path: `stateModel.fields[${index}]` }))
    }
    const allowedTypes = new Set(['boolean', 'integer', 'number', 'string', 'array', 'inventory'])
    if (field.type && !allowedTypes.has(field.type)) {
      diagnostics.push(createDiagnostic('STATE_FIELD_TYPE_UNSUPPORTED', 'error', `State field ${field.path} uses unsupported type ${field.type}.`))
    } else if (Object.hasOwn(field, 'defaultValue') && !valueMatchesStateType(field.defaultValue, field.type)) {
      diagnostics.push(createDiagnostic('STATE_FIELD_DEFAULT_INVALID', 'error', `State field ${field.path} default does not match ${field.type}.`))
    }
  }
  validateIdentifiers('state fields', (bundle.stateModel.fields ?? []).map(item => item.path), diagnostics)
  for (const [index, field] of (bundle.stateModel.derivedFields ?? []).entries()) {
    if (!field.path || !field.expression) diagnostics.push(createDiagnostic('DERIVED_FIELD_NOT_EXECUTABLE', 'error', 'Derived fields need a path and machine-readable expression.', { path: `stateModel.derivedFields[${index}]` }))
    for (const conditionPath of collectConditionPaths(field.expression)) {
      if (!fieldPaths.has(conditionPath) && !derivedPaths.has(conditionPath)) {
        diagnostics.push(createDiagnostic('DERIVED_INPUT_UNREGISTERED', 'error', `Derived field ${field.path} reads unregistered path ${conditionPath}.`))
      }
    }
  }

  const allActions = []
  for (const [index, scene] of bundle.scenes.entries()) {
    for (const eventId of scene.eventIds ?? []) {
      if (!eventIds.has(eventId)) diagnostics.push(createDiagnostic('SCENE_EVENT_UNRESOLVED', 'error', `Scene ${scene.sceneId} references unknown event ${eventId}.`))
    }
    for (const nextSceneId of scene.nextSceneIds ?? []) {
      if (!sceneIds.has(nextSceneId)) diagnostics.push(createDiagnostic('SCENE_EDGE_UNRESOLVED', 'error', `Scene ${scene.sceneId} points to unknown scene ${nextSceneId}.`))
    }
    if (!Array.isArray(scene.beats) || scene.beats.length === 0) diagnostics.push(createDiagnostic('SCENE_BEATS_MISSING', 'error', `Scene ${scene.sceneId} has no beats.`, { path: `scenes[${index}].beats` }))
    if (!Array.isArray(scene.actions) || scene.actions.length === 0) diagnostics.push(createDiagnostic('SCENE_ACTIONS_MISSING', 'error', `Scene ${scene.sceneId} has no executable actions.`, { path: `scenes[${index}].actions` }))
    if (scene.productionScript !== undefined) {
      if (!scene.productionScript?.name?.trim() || !scene.productionScript?.content?.trim()) {
        diagnostics.push(createDiagnostic('SCENE_PRODUCTION_SCRIPT_INCOMPLETE', 'error', `Scene ${scene.sceneId} productionScript needs name and content.`))
      }
    }
    for (const action of scene.actions ?? []) allActions.push({ ...action, sceneId: scene.sceneId, source: 'baseline' })
  }
  for (const recipe of bundle.recipes) {
    for (const stage of recipe.stageOverrides ?? []) {
      if (!sceneIds.has(stage.sceneId)) diagnostics.push(createDiagnostic('RECIPE_SCENE_UNRESOLVED', 'error', `Recipe ${recipe.recipeId} overrides unknown scene ${stage.sceneId}.`))
      for (const action of stage.actions ?? []) allActions.push({ ...action, sceneId: stage.sceneId, source: recipe.recipeId })
    }
  }
  const actionReferenceIds = new Set(allActions.flatMap(action => [
    action.actionId,
    action.actionInstanceId,
    `${action.source === 'baseline' ? 'BASE' : action.source}:${action.sceneId}:${action.seat}:${action.actionId}`
  ]).filter(Boolean))
  for (const action of allActions) {
    if (!action.actionId || !action.seat || !action.label) diagnostics.push(createDiagnostic('ACTION_INCOMPLETE', 'error', 'Action needs actionId, seat, and label.', { evidence: action }))
    if (!Array.isArray(action.effectOps) || action.effectOps.length === 0) diagnostics.push(createDiagnostic('ACTION_EFFECTS_MISSING', 'error', `Action ${action.actionId} has no state effects.`))
    for (const operation of action.effectOps ?? []) {
      if (!fieldPaths.has(operation.path)) diagnostics.push(createDiagnostic('ACTION_STATE_PATH_UNREGISTERED', 'error', `Action ${action.actionId} writes unregistered path ${operation.path}.`))
      else {
        const field = fieldsByPath.get(operation.path)
        if (!operationsByStateType[field.type]?.has(operation.op)) diagnostics.push(createDiagnostic('ACTION_STATE_OPERATION_UNSUPPORTED', 'error', `Action ${action.actionId} cannot use ${operation.op} on ${field.type} path ${operation.path}.`))
        else if (!operationValueMatches(operation, field.type)) diagnostics.push(createDiagnostic('ACTION_STATE_VALUE_INVALID', 'error', `Action ${action.actionId} provides an invalid ${operation.op} value for ${field.type} path ${operation.path}.`))
      }
    }
    for (const operation of action.costs ?? []) {
      if (!fieldPaths.has(operation.path)) diagnostics.push(createDiagnostic('ACTION_COST_PATH_UNREGISTERED', 'error', `Action ${action.actionId} charges unregistered path ${operation.path}.`))
      else {
        const field = fieldsByPath.get(operation.path)
        if (!operationsByStateType[field.type]?.has(operation.op)) diagnostics.push(createDiagnostic('ACTION_COST_OPERATION_UNSUPPORTED', 'error', `Action ${action.actionId} cannot charge ${operation.op} on ${field.type} path ${operation.path}.`))
        else if (!operationValueMatches(operation, field.type)) diagnostics.push(createDiagnostic('ACTION_COST_VALUE_INVALID', 'error', `Action ${action.actionId} provides an invalid ${operation.op} cost for ${field.type} path ${operation.path}.`))
      }
    }
    for (const condition of action.preconditions ?? []) {
      for (const conditionPath of collectConditionPaths(condition)) {
        if (!fieldPaths.has(conditionPath) && !derivedPaths.has(conditionPath)) diagnostics.push(createDiagnostic('ACTION_CONDITION_PATH_UNREGISTERED', 'error', `Action ${action.actionId} reads unregistered path ${conditionPath}.`))
      }
    }
    const scene = bundle.scenes.find(item => item.sceneId === action.sceneId)
    if (action.targetSceneId && !sceneIds.has(action.targetSceneId)) {
      diagnostics.push(createDiagnostic('ACTION_TARGET_UNRESOLVED', 'error', `Action ${action.actionId} targets unknown scene ${action.targetSceneId}.`))
    }
    if (action.targetSceneId && scene && !(scene.nextSceneIds ?? []).includes(action.targetSceneId)) {
      diagnostics.push(createDiagnostic('ACTION_TARGET_NOT_DECLARED', 'error', `Action ${action.actionId} targets ${action.targetSceneId}, which is not declared in ${scene.sceneId}.nextSceneIds.`))
    }
    if (!action.targetSceneId && (scene?.nextSceneIds ?? []).length > 1) {
      diagnostics.push(createDiagnostic('ACTION_TARGET_REQUIRED', 'error', `Action ${action.actionId} needs targetSceneId because scene ${scene.sceneId} has multiple next scenes.`))
    }
    if (action.counteractionId && !actionReferenceIds.has(action.counteractionId)) diagnostics.push(createDiagnostic('COUNTERACTION_UNRESOLVED', 'error', `Action ${action.actionId} references unknown counteraction ${action.counteractionId}.`))
  }
  for (const recipe of bundle.recipes) {
    for (const strategy of recipe.strategyOptions ?? []) {
      for (const actionId of strategy.path ?? []) {
        if (!actionReferenceIds.has(actionId)) diagnostics.push(createDiagnostic('STRATEGY_ACTION_UNRESOLVED', 'error', `Strategy ${strategy.strategyId} references unknown action ${actionId}.`))
      }
    }
  }

  for (const rule of bundle.settlement.rules) {
    if (!rule.predicate) diagnostics.push(createDiagnostic('SETTLEMENT_PREDICATE_MISSING', 'error', `Ending ${rule.endingCode} has no predicate.`))
    for (const conditionPath of collectConditionPaths(rule.predicate)) {
      if (!fieldPaths.has(conditionPath) && !derivedPaths.has(conditionPath)) diagnostics.push(createDiagnostic('SETTLEMENT_PATH_UNREGISTERED', 'error', `Ending ${rule.endingCode} reads unregistered path ${conditionPath}.`))
    }
  }

  for (const slot of bundle.productionHandoff.assetSlots ?? []) {
    if (!slot.assetSlotId || !slot.sceneId || !slot.semanticPurpose || !slot.runtimeCue || !slot.fallbackPolicy) {
      diagnostics.push(createDiagnostic('ASSET_SLOT_INCOMPLETE', 'error', 'Asset slot is missing required semantic handoff fields.', { evidence: slot }))
    }
    if (!sceneIds.has(slot.sceneId)) diagnostics.push(createDiagnostic('ASSET_SLOT_SCENE_UNRESOLVED', 'error', `Asset slot ${slot.assetSlotId} references unknown scene ${slot.sceneId}.`))
    for (const characterId of slot.requiredCharacters ?? []) {
      if (!characterIds.has(characterId)) diagnostics.push(createDiagnostic('ASSET_SLOT_CHARACTER_UNRESOLVED', 'error', `Asset slot ${slot.assetSlotId} references unknown character ${characterId}.`))
    }
  }

  for (const eventType of ['WorldEvent', 'RelationshipEventCandidate', 'ContentFeedback']) {
    if (!bundle.runtime.eventContracts?.[eventType]) diagnostics.push(createDiagnostic('RUNTIME_EVENT_CONTRACT_MISSING', 'error', `Runtime contract is missing ${eventType}.`))
  }

  for (const [index, contract] of (bundle.agents.contracts ?? []).entries()) {
    if (!characterIds.has(contract.agentId)) diagnostics.push(createDiagnostic('AGENT_CHARACTER_UNRESOLVED', 'error', `Agent contract references unknown character ${contract.agentId}.`, { path: `agents.contracts[${index}]` }))
    for (const factId of contract.knowledgeFactIds ?? []) {
      if (!factIds.has(factId)) diagnostics.push(createDiagnostic('AGENT_FACT_UNRESOLVED', 'error', `Agent ${contract.agentId} references unknown fact ${factId}.`))
    }
    for (const actionId of contract.actionAllowlist ?? []) {
      if (!actionReferenceIds.has(actionId)) diagnostics.push(createDiagnostic('AGENT_ACTION_UNRESOLVED', 'error', `Agent ${contract.agentId} references unknown action ${actionId}.`))
    }
    if (!contract.role || !contract.goal || !(contract.refusalBoundary ?? []).length || !(contract.responseSchema ?? []).length) {
      diagnostics.push(createDiagnostic('AGENT_CONTRACT_INCOMPLETE', 'error', `Agent ${contract.agentId ?? index} is missing role, goal, refusal, or response fields.`))
    }
    if (!['none', 'candidate-only'].includes(contract.memoryAccess?.writeMode)) diagnostics.push(createDiagnostic('AGENT_MEMORY_WRITE_INVALID', 'error', `Agent ${contract.agentId ?? index} must use memory writeMode none or candidate-only.`))
  }

  for (const vector of bundle.settlement.testVectors) {
    const vectorDiagnostics = []
    const result = evaluateSettlement(vector.state, { rules: bundle.settlement.rules }, bundle.stateModel, vectorDiagnostics)
    diagnostics.push(...vectorDiagnostics.map(item => ({ ...item, path: `settlement.testVectors.${vector.vectorId}${item.path ? `.${item.path}` : ''}` })))
    if (result.endingCode !== vector.expectedEndingCode) diagnostics.push(createDiagnostic('SETTLEMENT_VECTOR_FAILED', 'error', `Vector ${vector.vectorId} expected ${vector.expectedEndingCode} but derived ${result.endingCode}.`))
  }

  if (entrySceneId && sceneIds.has(entrySceneId)) {
    const reachable = new Set()
    const queue = [entrySceneId]
    while (queue.length) {
      const current = queue.shift()
      if (reachable.has(current)) continue
      reachable.add(current)
      const scene = bundle.scenes.find(item => item.sceneId === current)
      for (const nextSceneId of scene?.nextSceneIds ?? []) if (!reachable.has(nextSceneId)) queue.push(nextSceneId)
    }
    const unreachable = [...sceneIds].filter(sceneId => !reachable.has(sceneId))
    if (unreachable.length) diagnostics.push(createDiagnostic('SCENE_UNREACHABLE', 'error', 'Scenes are unreachable from the project entry scene.', { evidence: unreachable }))
  }

  return diagnostics
}

const compileAction = (action, sceneId, prefix) => ({
  ...action,
  actionInstanceId: action.actionInstanceId ?? `${prefix}:${sceneId}:${action.seat}:${action.actionId}`,
  sceneId
})

const artifact = (artifactId, filePath, format, responsibility) => ({ artifactId, path: filePath, format, responsibility })

export const compileBundle = ({ inputPath, outputRoot }) => {
  const absoluteInput = path.resolve(inputPath)
  const absoluteOutput = path.resolve(outputRoot)
  if (fs.existsSync(absoluteOutput) && fs.readdirSync(absoluteOutput).length > 0) {
    throw new Error(`Output directory must be absent or empty: ${absoluteOutput}`)
  }
  const bundle = readJson(absoluteInput)
  const diagnostics = validateInput(bundle)
  if (hasErrors(diagnostics)) return { result: 'fail', diagnostics, inputPath: absoluteInput, outputRoot: absoluteOutput }

  const packageDir = path.join(absoluteOutput, 'package')
  ensureDirectory(packageDir)
  const project = bundle.project
  const sceneOrder = bundle.scenes.map(scene => scene.sceneId)
  const baselineActions = bundle.scenes.flatMap(scene => scene.actions.map(action => compileAction(action, scene.sceneId, 'BASE')))
  const recipes = bundle.recipes.map(recipe => ({
    ...recipe,
    stageOverrides: (recipe.stageOverrides ?? []).map(stage => ({
      ...stage,
      actions: (stage.actions ?? []).map(action => compileAction(action, stage.sceneId, recipe.recipeId))
    }))
  }))
  const scenes = bundle.scenes.map(scene => ({
    ...scene,
    actions: undefined,
    availableActionIds: scene.actions.map(action => action.actionInstanceId ?? `BASE:${scene.sceneId}:${action.seat}:${action.actionId}`)
  }))

  const artifacts = [
    artifact('ART-MANIFEST', 'source-manifest.json', 'json', 'package identity, lineage, and artifact index'),
    artifact('ART-SOURCE-EVENTS', 'source-events.jsonl', 'jsonl', 'grounded source event ledger'),
    artifact('ART-CANON', 'canon-visibility.json', 'json', 'canon and seat visibility'),
    artifact('ART-CHARACTERS', 'character-contracts.jsonl', 'jsonl', 'character and Agent boundaries'),
    artifact('ART-SCENES', 'scene-scripts.jsonl', 'jsonl', 'compiled scene graph units'),
    artifact('ART-GRAPH', 'narrative-graph.json', 'json', 'scene edges and event grounding'),
    artifact('ART-STATE', 'state-field-registry.json', 'json', 'writable and derived state registry'),
    artifact('ART-BASE-ACTIONS', 'baseline-stage-actions.jsonl', 'jsonl', 'baseline typed actions'),
    artifact('ART-RECIPES', 'recipe-stage-overrides.jsonl', 'jsonl', 'recipe action overrides'),
    artifact('ART-SETTLEMENT', 'settlement-rules.json', 'json', 'declarative ending reducer'),
    artifact('ART-SETTLEMENT-VECTORS', 'settlement-test-vectors.jsonl', 'jsonl', 'settlement golden vectors'),
    artifact('ART-AGENTS', 'agent-runtime-contract.json', 'json', 'character Agent knowledge and tool boundary'),
    artifact('ART-RUNTIME', 'runtime-contract.json', 'json', 'UYI-facing runtime operations and event envelopes'),
    artifact('ART-PRODUCTION-REQUEST', 'production-request.json', 'json', 'semantic asset slots for downstream material production'),
    artifact('ART-REVIEW', 'review-ledger.jsonl', 'jsonl', 'author approvals and revisions'),
    artifact('ART-REVIEW-RECEIPT', 'review-receipt.json', 'json', 'review stage hashes and lifecycle authority'),
    artifact('ART-COMPILE-RECEIPT', 'compile-receipt.json', 'json', 'compiler diagnostics and artifact hash')
  ]

  const auditProfile = {
    level: 'compile',
    minimumChangedScenes: 3,
    minimumActionGraphDistance: 0.30,
    maximumDecisionCueReuse: 0.40,
    minimumEvidenceStatements: 2,
    minimumWaitingActions: 3,
    minimumAgentPassRate: 0.80,
    minimumCarryoverClasses: 4,
    minimumRunsPerRecipe: 3,
    ...(bundle.auditProfile ?? {})
  }
  const manifest = {
    $schema: `${SCHEMA_BASE}/narrative-package.schema.json`,
    schemaVersion: '1.0.0',
    packageVersion: project.packageVersion,
    projectId: project.projectId,
    title: project.title,
    language: project.language,
    lifecycle: 'compiled',
    runtimeTarget: project.runtimeTarget,
    description: project.description ?? '',
    sourceFiles: bundle.sources,
    entrySceneId: project.entrySceneId ?? sceneOrder[0],
    sceneOrder,
    artifactIndex: artifacts,
    auditProfile,
    lineage: bundle.lineage ?? { parentPackageVersion: null, forkEventId: null }
  }

  writeJsonl(path.join(packageDir, 'source-events.jsonl'), bundle.sourceEvents.slice().sort((left, right) => left.order - right.order || left.eventId.localeCompare(right.eventId)))
  writeJson(path.join(packageDir, 'canon-visibility.json'), { schemaVersion: '1.0.0', canonFacts: bundle.canonFacts })
  writeJsonl(path.join(packageDir, 'character-contracts.jsonl'), bundle.characters)
  writeJsonl(path.join(packageDir, 'scene-scripts.jsonl'), scenes)
  writeJson(path.join(packageDir, 'narrative-graph.json'), {
    schemaVersion: '1.0.0',
    entrySceneId: project.entrySceneId ?? sceneOrder[0],
    sceneOrder,
    nodes: scenes.map(scene => ({ sceneId: scene.sceneId, eventIds: scene.eventIds ?? [], nextSceneIds: scene.nextSceneIds ?? [] }))
  })
  writeJson(path.join(packageDir, 'state-field-registry.json'), { schemaVersion: '1.0.0', ...bundle.stateModel })
  writeJsonl(path.join(packageDir, 'baseline-stage-actions.jsonl'), baselineActions)
  writeJsonl(path.join(packageDir, 'recipe-stage-overrides.jsonl'), recipes)
  writeJson(path.join(packageDir, 'settlement-rules.json'), {
    schemaVersion: '1.0.0',
    packageVersion: project.packageVersion,
    priorityOrder: bundle.settlement.rules.slice().sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0)).map(rule => rule.endingCode),
    rules: bundle.settlement.rules,
    projectionContract: bundle.settlement.projectionContract ?? {}
  })
  writeJsonl(path.join(packageDir, 'settlement-test-vectors.jsonl'), bundle.settlement.testVectors)
  writeJson(path.join(packageDir, 'agent-runtime-contract.json'), {
    $schema: `${SCHEMA_BASE}/agent-runtime-contract.schema.json`,
    schemaVersion: '1.0.0',
    projectId: project.projectId,
    packageVersion: project.packageVersion,
    ...bundle.agents
  })
  writeJson(path.join(packageDir, 'runtime-contract.json'), {
    $schema: `${SCHEMA_BASE}/runtime-contract.schema.json`,
    schemaVersion: '1.0.0',
    projectId: project.projectId,
    packageVersion: project.packageVersion,
    authority: {
      content: 'hodor.bran',
      runtime: bundle.runtime.runtimeOwner ?? 'uyi',
      relationship: bundle.runtime.relationshipOwner ?? 'brain-mesh',
      stateMutationRule: 'Natural language and character prose must resolve to a typed action before world state changes.'
    },
    operations: bundle.runtime.operations ?? ['loadPackage', 'getSceneView', 'listActions', 'resolveIntent', 'submitAction', 'reduceWorldState', 'settle', 'pause', 'resume', 'verifyVersion'],
    eventContracts: bundle.runtime.eventContracts
  })
  writeJson(path.join(packageDir, 'production-request.json'), {
    $schema: `${SCHEMA_BASE}/production-request.schema.json`,
    schemaVersion: '1.0.0',
    projectId: project.projectId,
    packageVersion: project.packageVersion,
    authority: {
      narrativeOwner: 'bran',
      materialOwner: bundle.productionHandoff.materialOwner ?? 'downstream-material-team',
      rule: 'Material production may fill asset references but cannot mutate narrative world state or settlement.'
    },
    assetSlots: bundle.productionHandoff.assetSlots
  })
  writeJson(path.join(packageDir, 'source-manifest.json'), manifest)

  const reviewEntries = normalizeInitialReview({ packageDir, entries: bundle.review.entries ?? [] })
  writeJsonl(path.join(packageDir, 'review-ledger.jsonl'), reviewEntries)
  let reviewReceipt = buildReviewReceipt({
    packageDir,
    manifest,
    ledger: reviewEntries,
    updatedAt: project.compiledAt ?? new Date().toISOString()
  })
  if (reviewReceipt.status === 'pass') {
    manifest.lifecycle = 'reviewed'
    writeJson(path.join(packageDir, 'source-manifest.json'), manifest)
    reviewReceipt = buildReviewReceipt({ packageDir, manifest, ledger: reviewEntries, updatedAt: reviewReceipt.updatedAt })
  }
  writeJson(path.join(packageDir, 'review-receipt.json'), reviewReceipt)

  const mutableReviewFiles = new Set(['source-manifest.json', 'review-ledger.jsonl', 'review-receipt.json', 'compile-receipt.json'])
  const hashFiles = artifacts.map(item => item.path).filter(name => !mutableReviewFiles.has(name))
  const receipt = {
    schemaVersion: '1.0.0',
    compiler: 'bran-core',
    compilerVersion: '0.3.0',
    projectId: project.projectId,
    packageVersion: project.packageVersion,
    inputHash: sha256(bundle),
    artifactHashFiles: hashFiles,
    artifactHash: artifactHash(packageDir, hashFiles),
    diagnostics,
    status: 'pass',
    compiledAt: project.compiledAt ?? new Date().toISOString()
  }
  writeJson(path.join(packageDir, 'compile-receipt.json'), receipt)

  return {
    result: 'pass',
    inputPath: absoluteInput,
    outputRoot: absoluteOutput,
    packageDir,
    artifactHash: receipt.artifactHash,
    artifacts: artifacts.length,
    diagnostics
  }
}

export { validateInput }
