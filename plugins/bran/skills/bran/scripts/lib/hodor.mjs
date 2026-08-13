import fs from 'node:fs'
import path from 'node:path'
import {
  collectConditionPaths,
  createDiagnostic,
  hasErrors,
  readJson,
  readJsonl,
  resolvePackageDirectory,
  sha256,
  stableStringify,
  writeJson
} from './common.mjs'
import { auditPackage } from './auditor.mjs'

const HODOR_NODE_KINDS = new Set(['scene', 'branch', 'hub', 'ending'])
const HODOR_NODE_STATUSES = new Set(['draft', 'ready', 'producing', 'completed', 'blocked'])
const HODOR_VARIABLE_TYPES = new Set(['boolean', 'number', 'string', 'inventory'])
const HODOR_OPERATIONS = {
  boolean: new Set(['set', 'toggle']),
  number: new Set(['set', 'increment', 'decrement']),
  string: new Set(['set', 'append']),
  inventory: new Set(['set', 'append', 'remove'])
}
const HODOR_CONDITION_RESERVED_WORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'and',
  'or',
  'not',
  'includes',
  'contains'
])
const SUPPORTED_CONDITION_OPERATORS = new Set([
  'var',
  'and',
  'or',
  '!',
  '!!',
  '==',
  '===',
  '!=',
  '!==',
  '>',
  '>=',
  '<',
  '<=',
  'in',
  '+',
  '-',
  '*',
  '/',
  '%',
  'missing'
])

const bounded = (value, maximum) => String(value ?? '').slice(0, maximum)
const nodeKey = sceneId => `scene:${sceneId}`
const endingNodeKey = endingCode => `ending:${endingCode}`
const SETTLEMENT_HUB_KEY = 'hub:bran-settlement'

const asHodorVariableType = type => {
  if (type === 'integer' || type === 'number') return 'number'
  if (type === 'array' || type === 'inventory') return 'inventory'
  if (type === 'boolean' || type === 'string') return type
  return null
}

const defaultMatchesType = (value, type) => {
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'inventory') return Array.isArray(value)
  return false
}

const effectValueMatchesType = (effect, type) => {
  if (effect.operation === 'toggle') return effect.value === undefined
  if (effect.operation === 'increment' || effect.operation === 'decrement') return typeof effect.value === 'number' && Number.isFinite(effect.value)
  if (effect.operation === 'append' && type === 'string') return typeof effect.value === 'string'
  if (effect.operation === 'append' || effect.operation === 'remove') return effect.value !== undefined
  if (effect.operation === 'set') return defaultMatchesType(effect.value, type)
  return true
}

const conditionVariables = condition => {
  if (!condition) return []
  const withoutStrings = condition.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, ' ')
  return [...new Set(
    (withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? [])
      .filter(identifier => !HODOR_CONDITION_RESERVED_WORDS.has(identifier.toLowerCase()))
  )]
}

const buildVariableNames = fields => {
  const diagnostics = []
  const pathToName = new Map()
  const nameToPath = new Map()
  for (const field of fields) {
    let name = String(field.path ?? '')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_]+/gu, '__')
      .replace(/_+/gu, '_')
      .replace(/^([0-9])/u, 'v_$1')
      .replace(/^_+/u, 'v_')
      .replace(/_+$/u, '')
    if (!name) name = `v_${sha256(field.path ?? '').slice(0, 12)}`
    if (name.length > 112) name = `${name.slice(0, 99)}_${sha256(field.path).slice(0, 12)}`
    const collision = nameToPath.get(name)
    if (collision && collision !== field.path) {
      diagnostics.push(createDiagnostic(
        'HODOR_VARIABLE_NAME_COLLISION',
        'error',
        `State paths ${collision} and ${field.path} map to the same Hodor variable ${name}.`
      ))
      continue
    }
    pathToName.set(field.path, name)
    nameToPath.set(name, field.path)
  }
  return { pathToName, diagnostics }
}

const expandDerivedExpression = (expression, derivedByPath, stack = []) => {
  if (Array.isArray(expression)) return expression.map(item => expandDerivedExpression(item, derivedByPath, stack))
  if (!expression || typeof expression !== 'object') return expression
  if (Object.hasOwn(expression, 'var')) {
    const raw = Array.isArray(expression.var) ? expression.var : [expression.var]
    const variablePath = raw[0]
    if (derivedByPath.has(variablePath)) {
      if (stack.includes(variablePath)) throw new Error(`Derived-state cycle while exporting ${[...stack, variablePath].join(' -> ')}`)
      return expandDerivedExpression(derivedByPath.get(variablePath).expression, derivedByPath, [...stack, variablePath])
    }
  }
  if (expression.op && expression.path && derivedByPath.has(expression.path)) {
    if (stack.includes(expression.path)) throw new Error(`Derived-state cycle while exporting ${[...stack, expression.path].join(' -> ')}`)
    return {
      [expression.op]: [
        expandDerivedExpression(derivedByPath.get(expression.path).expression, derivedByPath, [...stack, expression.path]),
        expression.value
      ]
    }
  }
  return Object.fromEntries(Object.entries(expression).map(([key, value]) => [
    key,
    expandDerivedExpression(value, derivedByPath, stack)
  ]))
}

const expressionToHodor = (expression, pathToName) => {
  if (expression === true) return null
  if (expression === false) return 'false'
  if (expression === null || expression === undefined) return JSON.stringify(expression ?? null)
  if (typeof expression === 'string') return JSON.stringify(expression)
  if (typeof expression === 'number' || typeof expression === 'boolean') return String(expression)
  if (Array.isArray(expression)) return `[${expression.map(item => expressionToHodor(item, pathToName) ?? 'true').join(', ')}]`

  if (expression.always === true) return null
  if (Array.isArray(expression.all)) {
    return expression.all.map(item => `(${expressionToHodor(item, pathToName) ?? 'true'})`).join(' && ')
  }
  if (Array.isArray(expression.any)) {
    return expression.any.map(item => `(${expressionToHodor(item, pathToName) ?? 'true'})`).join(' || ')
  }
  if (expression.not !== undefined) return `!(${expressionToHodor(expression.not, pathToName) ?? 'true'})`
  if (Array.isArray(expression.includes) && expression.includes.length === 2) {
    const [statePath, expected] = expression.includes
    const variable = pathToName.get(statePath)
    if (!variable) throw new Error(`Condition reads state path that Hodor cannot bind: ${statePath}`)
    return `includes(${variable}, ${JSON.stringify(expected)})`
  }
  if (expression.op && expression.path) {
    const variable = pathToName.get(expression.path)
    if (!variable) throw new Error(`Condition reads state path that Hodor cannot bind: ${expression.path}`)
    return `(${variable} ${expression.op} ${JSON.stringify(expression.value)})`
  }

  const keys = Object.keys(expression)
  if (keys.length !== 1) throw new Error(`Condition expression needs exactly one operator: ${JSON.stringify(expression)}`)
  const operator = keys[0]
  if (!SUPPORTED_CONDITION_OPERATORS.has(operator)) throw new Error(`Hodor target does not support condition operator ${operator}.`)
  const rawArguments = expression[operator]
  const args = Array.isArray(rawArguments) ? rawArguments : [rawArguments]
  if (operator === 'var') {
    const variable = pathToName.get(args[0])
    if (!variable) throw new Error(`Condition reads state path that Hodor cannot bind: ${args[0]}`)
    return variable
  }
  if (operator === 'and' || operator === 'or') {
    const symbol = operator === 'and' ? '&&' : '||'
    return args.map(item => `(${expressionToHodor(item, pathToName) ?? 'true'})`).join(` ${symbol} `)
  }
  if (operator === '!' || operator === '!!') {
    return `${operator}(${expressionToHodor(args[0], pathToName) ?? 'true'})`
  }
  if (['==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(operator)) {
    return `(${expressionToHodor(args[0], pathToName) ?? 'true'} ${operator} ${expressionToHodor(args[1], pathToName) ?? 'true'})`
  }
  if (operator === 'in') {
    return `includes(${expressionToHodor(args[1], pathToName) ?? 'true'}, ${expressionToHodor(args[0], pathToName) ?? 'true'})`
  }
  if (operator === 'missing') {
    const paths = args.flat()
    return paths.map(statePath => {
      const variable = pathToName.get(statePath)
      if (!variable) throw new Error(`Condition reads state path that Hodor cannot bind: ${statePath}`)
      return `(${variable} == null)`
    }).join(' || ')
  }
  if (['+', '-', '*', '/', '%'].includes(operator)) {
    if (operator === '-' && args.length === 1) return `-(${expressionToHodor(args[0], pathToName)})`
    return `(${args.map(item => expressionToHodor(item, pathToName) ?? 'true').join(` ${operator} `)})`
  }
  throw new Error(`Hodor target cannot serialize condition operator ${operator}.`)
}

const combinePreconditions = preconditions => {
  if (!preconditions?.length) return true
  if (preconditions.length === 1) return preconditions[0]
  return { and: preconditions }
}

const renderSceneScript = (scene, actions) => {
  const explicit = scene.productionScript?.content ?? scene.script?.content
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  const beats = (scene.beats ?? []).map(beat => {
    const label = beat.kind ? `【${beat.kind}】` : ''
    return `${label}${beat.text ?? ''}`.trim()
  })
  const choices = actions.map(action => `- ${action.label}`)
  return [
    `# ${scene.title}`,
    '',
    `场景 ID：${scene.sceneId}`,
    `地点：${scene.locationId ?? '未指定'}`,
    `时间：${scene.time ?? '未指定'}`,
    '',
    ...beats,
    ...(choices.length ? ['', '## 玩家行动', ...choices] : []),
    '',
    '## 段尾状态',
    bounded(actions.map(action => action.publicEcho).filter(Boolean).join(' / ') || scene.summary || '进入下一剧情状态。', 4000)
  ].join('\n')
}

const renderEndingScript = rule => [
  `# ${rule.title ?? rule.endingCode}`,
  '',
  `结局代码：${rule.endingCode}`,
  '',
  `结算理由：${(rule.reasonCodes ?? []).join('、') || '由 Bran 结算规则确定。'}`,
  '',
  '该结局由 Bran 世界状态结算结果投影，生产环节不得改写其触发条件。'
].join('\n')

const renderSettlementScript = rules => [
  '# Bran 结算',
  '',
  '该节点根据累计世界状态进入对应结局。',
  '',
  ...rules.map(rule => `- ${rule.title ?? rule.endingCode}`)
].join('\n')

const mapEffects = ({ action, pathToName, fieldsByPath, diagnostics }) => {
  const effects = []
  for (const [kind, operations] of [['effect', action.effectOps ?? []], ['cost', action.costs ?? []]]) {
    for (const operation of operations) {
      const field = fieldsByPath.get(operation.path)
      const type = asHodorVariableType(field?.type)
      const mappedOperation = operation.op
      if (!field || !type) {
        diagnostics.push(createDiagnostic(
          'HODOR_EFFECT_PATH_UNSUPPORTED',
          'error',
          `Action ${action.actionInstanceId} ${kind} cannot bind state path ${operation.path}.`
        ))
        continue
      }
      if (!HODOR_OPERATIONS[type].has(mappedOperation)) {
        diagnostics.push(createDiagnostic(
          'HODOR_EFFECT_OPERATION_UNSUPPORTED',
          'error',
          `${type} variable ${operation.path} does not support ${mappedOperation} in Hodor.`,
          { evidence: { actionInstanceId: action.actionInstanceId, operation } }
        ))
        continue
      }
      effects.push({
        variable: pathToName.get(operation.path),
        operation: mappedOperation,
        ...(operation.value !== undefined ? { value: operation.value } : {})
      })
      const mappedEffect = effects.at(-1)
      if (!effectValueMatchesType(mappedEffect, type)) {
        diagnostics.push(createDiagnostic(
          'HODOR_EFFECT_VALUE_INVALID',
          'error',
          `Action ${action.actionInstanceId} provides an invalid ${mappedOperation} value for ${type} variable ${operation.path}.`,
          { evidence: operation }
        ))
      }
    }
  }
  return effects
}

const actionsForRecipe = ({ baseline, recipes, recipeId, diagnostics }) => {
  if (!recipeId || recipeId === 'baseline') return baseline
  const recipe = recipes.find(item => item.recipeId === recipeId)
  if (!recipe) {
    diagnostics.push(createDiagnostic('HODOR_RECIPE_NOT_FOUND', 'error', `Unknown recipe ${recipeId}.`))
    return []
  }
  const overrides = new Map((recipe.stageOverrides ?? []).map(stage => [stage.sceneId, stage.actions ?? []]))
  const sceneIds = new Set([...baseline.map(action => action.sceneId), ...overrides.keys()])
  return [...sceneIds].flatMap(sceneId => overrides.get(sceneId) ?? baseline.filter(action => action.sceneId === sceneId))
}

const assignPositions = nodes => {
  const groups = new Map()
  for (const node of nodes) {
    const existing = groups.get(node.depth) ?? []
    existing.push(node)
    groups.set(node.depth, existing)
  }
  for (const [depth, group] of [...groups.entries()].sort((left, right) => left[0] - right[0])) {
    group.sort((left, right) => left.order - right.order || left.nodeKey.localeCompare(right.nodeKey))
    for (const [index, node] of group.entries()) {
      node.position = {
        x: depth * 380,
        y: Math.round((index - (group.length - 1) / 2) * 240)
      }
      delete node.depth
      delete node.order
    }
  }
}

const graphDepths = ({ entrySceneId, scenes, edges }) => {
  const depths = new Map([[nodeKey(entrySceneId), 0]])
  const queue = [nodeKey(entrySceneId)]
  while (queue.length) {
    const current = queue.shift()
    const depth = depths.get(current)
    for (const edge of edges.filter(item => item.sourceNodeKey === current)) {
      if (!edge.targetNodeKey.startsWith('scene:')) continue
      const candidate = depth + 1
      if (!depths.has(edge.targetNodeKey) || candidate < depths.get(edge.targetNodeKey)) {
        depths.set(edge.targetNodeKey, candidate)
        queue.push(edge.targetNodeKey)
      }
    }
  }
  for (const scene of scenes) if (!depths.has(nodeKey(scene.sceneId))) depths.set(nodeKey(scene.sceneId), 0)
  return depths
}

export const validateHodorTarget = target => {
  const diagnostics = []
  if (target.contractVersion !== '1.0.0') diagnostics.push(createDiagnostic('HODOR_TARGET_VERSION_UNSUPPORTED', 'error', 'Hodor target contractVersion must be 1.0.0.'))
  if (!Number.isInteger(target.project?.projectId) || target.project.projectId <= 0) diagnostics.push(createDiagnostic('HODOR_PROJECT_ID_INVALID', 'error', 'Hodor projectId must be a positive integer.'))
  if (!target.entryNodeKey) diagnostics.push(createDiagnostic('HODOR_ENTRY_NODE_MISSING', 'error', 'Hodor target needs an entry node.'))

  const nodeKeys = new Set()
  for (const node of target.nodes ?? []) {
    if (!node.nodeKey || nodeKeys.has(node.nodeKey)) diagnostics.push(createDiagnostic('HODOR_NODE_KEY_INVALID', 'error', `Invalid or duplicate node key ${node.nodeKey}.`))
    nodeKeys.add(node.nodeKey)
    if (!HODOR_NODE_KINDS.has(node.kind)) diagnostics.push(createDiagnostic('HODOR_NODE_KIND_INVALID', 'error', `Node ${node.nodeKey} has invalid kind ${node.kind}.`))
    if (!HODOR_NODE_STATUSES.has(node.status)) diagnostics.push(createDiagnostic('HODOR_NODE_STATUS_INVALID', 'error', `Node ${node.nodeKey} has invalid status ${node.status}.`))
    if (!node.title || node.title.length > 500) diagnostics.push(createDiagnostic('HODOR_NODE_TITLE_INVALID', 'error', `Node ${node.nodeKey} title must contain 1 to 500 characters.`))
    if ((node.summary ?? '').length > 12000) diagnostics.push(createDiagnostic('HODOR_NODE_SUMMARY_TOO_LONG', 'error', `Node ${node.nodeKey} summary exceeds 12000 characters.`))
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) diagnostics.push(createDiagnostic('HODOR_NODE_POSITION_INVALID', 'error', `Node ${node.nodeKey} has an invalid position.`))
    if (!node.script?.name || node.script.name.length > 500 || typeof node.script?.content !== 'string' || node.script.content.length > 2_000_000) {
      diagnostics.push(createDiagnostic('HODOR_NODE_SCRIPT_INVALID', 'error', `Node ${node.nodeKey} does not satisfy the Hodor o_script binding contract.`))
    }
  }
  if (!nodeKeys.has(target.entryNodeKey)) diagnostics.push(createDiagnostic('HODOR_ENTRY_NODE_UNRESOLVED', 'error', `Entry node ${target.entryNodeKey} does not exist.`))

  const variableNames = new Set()
  for (const variable of target.variables ?? []) {
    if (!variable.name || variable.name.length > 128 || variableNames.has(variable.name)) diagnostics.push(createDiagnostic('HODOR_VARIABLE_NAME_INVALID', 'error', `Invalid or duplicate Hodor variable ${variable.name}.`))
    variableNames.add(variable.name)
    if (!HODOR_VARIABLE_TYPES.has(variable.type)) diagnostics.push(createDiagnostic('HODOR_VARIABLE_TYPE_INVALID', 'error', `Variable ${variable.name} has invalid type ${variable.type}.`))
    if (!defaultMatchesType(variable.initialValue, variable.type)) diagnostics.push(createDiagnostic('HODOR_VARIABLE_DEFAULT_INVALID', 'error', `Variable ${variable.name} default does not match ${variable.type}.`))
  }

  const edgeKeys = new Set()
  const outgoing = new Map()
  for (const edge of target.edges ?? []) {
    if (!edge.edgeKey || edgeKeys.has(edge.edgeKey)) diagnostics.push(createDiagnostic('HODOR_EDGE_KEY_INVALID', 'error', `Invalid or duplicate edge key ${edge.edgeKey}.`))
    edgeKeys.add(edge.edgeKey)
    if (!nodeKeys.has(edge.sourceNodeKey) || !nodeKeys.has(edge.targetNodeKey)) diagnostics.push(createDiagnostic('HODOR_EDGE_DANGLING', 'error', `Edge ${edge.edgeKey} has an unresolved endpoint.`))
    if (!edge.choiceText || edge.choiceText.length > 2000) diagnostics.push(createDiagnostic('HODOR_EDGE_CHOICE_INVALID', 'error', `Edge ${edge.edgeKey} choiceText must contain 1 to 2000 characters.`))
    if (edge.condition !== null && typeof edge.condition !== 'string') diagnostics.push(createDiagnostic('HODOR_EDGE_CONDITION_INVALID', 'error', `Edge ${edge.edgeKey} condition must be a string or null.`))
    if ((edge.condition ?? '').length > 4000) diagnostics.push(createDiagnostic('HODOR_EDGE_CONDITION_TOO_LONG', 'error', `Edge ${edge.edgeKey} condition exceeds 4000 characters.`))
    const missingConditionVariables = conditionVariables(edge.condition).filter(variable => !variableNames.has(variable))
    if (missingConditionVariables.length) diagnostics.push(createDiagnostic('HODOR_CONDITION_VARIABLE_MISSING', 'error', `Edge ${edge.edgeKey} condition references undefined Hodor variables.`, { evidence: missingConditionVariables }))
    const next = outgoing.get(edge.sourceNodeKey) ?? []
    next.push(edge.targetNodeKey)
    outgoing.set(edge.sourceNodeKey, next)
    for (const effect of edge.effects ?? []) {
      const variable = (target.variables ?? []).find(item => item.name === effect.variable)
      if (!variable) diagnostics.push(createDiagnostic('HODOR_EFFECT_VARIABLE_MISSING', 'error', `Edge ${edge.edgeKey} references missing variable ${effect.variable}.`))
      else if (!HODOR_OPERATIONS[variable.type].has(effect.operation)) diagnostics.push(createDiagnostic('HODOR_EFFECT_OPERATION_INVALID', 'error', `Edge ${edge.edgeKey} uses ${effect.operation} on ${variable.type} variable ${effect.variable}.`))
      else if (!effectValueMatchesType(effect, variable.type)) diagnostics.push(createDiagnostic('HODOR_EFFECT_VALUE_INVALID', 'error', `Edge ${edge.edgeKey} has an invalid ${effect.operation} value for ${variable.type} variable ${effect.variable}.`))
    }
  }

  const reachable = new Set()
  const queue = nodeKeys.has(target.entryNodeKey) ? [target.entryNodeKey] : []
  while (queue.length) {
    const current = queue.shift()
    if (reachable.has(current)) continue
    reachable.add(current)
    for (const targetKey of outgoing.get(current) ?? []) if (!reachable.has(targetKey)) queue.push(targetKey)
  }
  for (const node of target.nodes ?? []) {
    if (!reachable.has(node.nodeKey)) diagnostics.push(createDiagnostic('HODOR_NODE_UNREACHABLE', 'error', `Node ${node.nodeKey} is unreachable from the entry.`))
    if (node.kind === 'ending' && (outgoing.get(node.nodeKey) ?? []).length) diagnostics.push(createDiagnostic('HODOR_ENDING_HAS_OUTGOING_EDGE', 'error', `Ending ${node.nodeKey} has outgoing edges.`))
    if (node.kind !== 'ending' && !(outgoing.get(node.nodeKey) ?? []).length) diagnostics.push(createDiagnostic('HODOR_NON_ENDING_DEAD_END', 'error', `Node ${node.nodeKey} has no outgoing choice.`))
    if (node.kind === 'branch' && ((outgoing.get(node.nodeKey) ?? []).length < 2 || (outgoing.get(node.nodeKey) ?? []).length > 3)) {
      diagnostics.push(createDiagnostic('HODOR_BRANCH_CHOICE_COUNT_INVALID', 'error', `Branch ${node.nodeKey} must expose two or three player choices.`))
    }
  }
  if ((target.nodes ?? []).filter(node => node.kind === 'ending').length < 2) diagnostics.push(createDiagnostic('HODOR_ENDINGS_INSUFFICIENT', 'error', 'Hodor interactive output needs at least two endings.'))

  const hashInput = { ...target }
  delete hashInput.targetHash
  const actualHash = sha256(hashInput)
  if (target.targetHash && target.targetHash !== actualHash) diagnostics.push(createDiagnostic('HODOR_TARGET_HASH_STALE', 'error', 'Hodor target hash does not match its current content.', { evidence: { expected: target.targetHash, actual: actualHash } }))
  return diagnostics
}

export const buildHodorTarget = ({ root, projectId, recipeId = 'baseline', outputPath }) => {
  const packageDir = resolvePackageDirectory(root)
  const compileAudit = auditPackage({ root, level: 'compile' })
  if (compileAudit.result !== 'pass') {
    return {
      result: 'fail',
      diagnostics: [createDiagnostic('HODOR_SOURCE_PACKAGE_INVALID', 'error', 'Bran package must pass compile audit before Hodor export.', { evidence: compileAudit.diagnostics })]
    }
  }

  const manifest = readJson(path.join(packageDir, 'source-manifest.json'))
  const scenes = readJsonl(path.join(packageDir, 'scene-scripts.jsonl'))
  const baseline = readJsonl(path.join(packageDir, 'baseline-stage-actions.jsonl'))
  const recipes = readJsonl(path.join(packageDir, 'recipe-stage-overrides.jsonl'))
  const stateRegistry = readJson(path.join(packageDir, 'state-field-registry.json'))
  const settlement = readJson(path.join(packageDir, 'settlement-rules.json'))
  const compileReceipt = readJson(path.join(packageDir, 'compile-receipt.json'))
  const diagnostics = []
  const entrySceneId = manifest.entrySceneId ?? manifest.sceneOrder?.[0]
  const sceneById = new Map(scenes.map(scene => [scene.sceneId, scene]))
  const fieldsByPath = new Map((stateRegistry.fields ?? []).map(field => [field.path, field]))
  const derivedByPath = new Map((stateRegistry.derivedFields ?? []).map(field => [field.path, field]))
  const variableNames = buildVariableNames(stateRegistry.fields ?? [])
  diagnostics.push(...variableNames.diagnostics)
  const actions = actionsForRecipe({ baseline, recipes, recipeId, diagnostics })
  const actionsByScene = new Map()
  for (const action of actions) {
    const existing = actionsByScene.get(action.sceneId) ?? []
    existing.push(action)
    actionsByScene.set(action.sceneId, existing)
  }

  const variables = (stateRegistry.fields ?? []).map(field => {
    const type = asHodorVariableType(field.type)
    if (!type) diagnostics.push(createDiagnostic('HODOR_STATE_TYPE_UNSUPPORTED', 'error', `State field ${field.path} uses unsupported type ${field.type}.`))
    return {
      variableKey: `state:${field.path}`,
      sourcePath: field.path,
      name: variableNames.pathToName.get(field.path),
      label: bounded(field.label ?? field.path, 500),
      type,
      initialValue: field.defaultValue,
      description: bounded(field.description ?? `Bran state field ${field.path}; writers: ${(field.writers ?? []).join(', ')}`, 4000)
    }
  })

  const edges = []
  for (const scene of scenes) {
    const sceneActions = actionsByScene.get(scene.sceneId) ?? []
    for (const [index, action] of sceneActions.entries()) {
      let targetSceneId = action.targetSceneId
      if (!targetSceneId && (scene.nextSceneIds ?? []).length === 1) targetSceneId = scene.nextSceneIds[0]
      const targetKey = targetSceneId ? nodeKey(targetSceneId) : SETTLEMENT_HUB_KEY
      if (targetSceneId && !sceneById.has(targetSceneId)) {
        diagnostics.push(createDiagnostic('HODOR_ACTION_TARGET_UNRESOLVED', 'error', `Action ${action.actionInstanceId} targets unknown scene ${targetSceneId}.`))
      }
      if (!targetSceneId && (scene.nextSceneIds ?? []).length > 1) {
        diagnostics.push(createDiagnostic('HODOR_ACTION_TARGET_REQUIRED', 'error', `Action ${action.actionInstanceId} needs targetSceneId because ${scene.sceneId} has multiple next scenes.`))
      }
      let expandedCondition = true
      let condition = null
      try {
        expandedCondition = expandDerivedExpression(combinePreconditions(action.preconditions ?? []), derivedByPath)
        condition = expressionToHodor(expandedCondition, variableNames.pathToName)
      } catch (error) {
        diagnostics.push(createDiagnostic('HODOR_CONDITION_UNSUPPORTED', 'error', error.message, { evidence: { actionInstanceId: action.actionInstanceId } }))
      }
      edges.push({
        edgeKey: `action:${action.actionInstanceId}`,
        sourceNodeKey: nodeKey(scene.sceneId),
        targetNodeKey: targetKey,
        choiceText: bounded(action.label, 2000),
        condition,
        conditionAst: expandedCondition,
        conditionPaths: collectConditionPaths(expandedCondition),
        effects: mapEffects({ action, pathToName: variableNames.pathToName, fieldsByPath, diagnostics }),
        priority: Number.isInteger(action.priority) ? action.priority : sceneActions.length - index,
        sourceActionInstanceId: action.actionInstanceId
      })
    }
  }

  const maximumSceneDepth = Math.max(0, ...manifest.sceneOrder.map((_, index) => index))
  const settlementDepth = maximumSceneDepth + 1
  for (const [index, rule] of (settlement.rules ?? []).entries()) {
    let expandedCondition = rule.predicate
    let condition = null
    try {
      expandedCondition = expandDerivedExpression(rule.predicate, derivedByPath)
      condition = expressionToHodor(expandedCondition, variableNames.pathToName)
    } catch (error) {
      diagnostics.push(createDiagnostic('HODOR_SETTLEMENT_CONDITION_UNSUPPORTED', 'error', error.message, { evidence: { endingCode: rule.endingCode } }))
    }
    edges.push({
      edgeKey: `settlement:${rule.endingCode}`,
      sourceNodeKey: SETTLEMENT_HUB_KEY,
      targetNodeKey: endingNodeKey(rule.endingCode),
      choiceText: bounded(rule.title ?? rule.endingCode, 2000),
      condition,
      conditionAst: expandedCondition,
      conditionPaths: collectConditionPaths(expandedCondition),
      effects: [],
      priority: Number.isInteger(rule.priority) ? rule.priority : (settlement.rules.length - index),
      sourceEndingCode: rule.endingCode
    })
  }

  const depths = graphDepths({ entrySceneId, scenes, edges })
  const inbound = new Map()
  for (const edge of edges) inbound.set(edge.targetNodeKey, (inbound.get(edge.targetNodeKey) ?? 0) + 1)
  const nodes = scenes.map((scene, order) => {
    const sceneActions = actionsByScene.get(scene.sceneId) ?? []
    const outgoingCount = sceneActions.length
    const kind = outgoingCount >= 2 ? 'branch' : (inbound.get(nodeKey(scene.sceneId)) ?? 0) > 1 ? 'hub' : 'scene'
    return {
      nodeKey: nodeKey(scene.sceneId),
      sourceSceneId: scene.sceneId,
      kind,
      title: bounded(scene.title, 500),
      summary: bounded(scene.summary ?? (scene.beats ?? []).map(beat => beat.text).join(' '), 12000),
      depth: depths.get(nodeKey(scene.sceneId)) ?? order,
      order,
      position: { x: 0, y: 0 },
      status: 'ready',
      script: {
        name: bounded(scene.productionScript?.name ?? scene.script?.name ?? scene.title, 500),
        content: bounded(renderSceneScript(scene, sceneActions), 2_000_000)
      }
    }
  })
  nodes.push({
    nodeKey: SETTLEMENT_HUB_KEY,
    kind: 'hub',
    title: 'Bran 结算',
    summary: '根据累计世界状态执行确定性结算并进入对应结局。',
    depth: settlementDepth,
    order: 0,
    position: { x: 0, y: 0 },
    status: 'ready',
    script: { name: 'Bran 结算', content: renderSettlementScript(settlement.rules ?? []) }
  })
  for (const [index, rule] of (settlement.rules ?? []).entries()) {
    nodes.push({
      nodeKey: endingNodeKey(rule.endingCode),
      sourceEndingCode: rule.endingCode,
      kind: 'ending',
      title: bounded(rule.title ?? rule.endingCode, 500),
      summary: bounded(`Bran ending ${rule.endingCode}: ${(rule.reasonCodes ?? []).join(', ')}`, 12000),
      depth: settlementDepth + 1,
      order: index,
      position: { x: 0, y: 0 },
      status: 'ready',
      script: {
        name: bounded(rule.title ?? rule.endingCode, 500),
        content: renderEndingScript(rule)
      }
    })
  }
  assignPositions(nodes)

  const target = {
    $schema: 'https://github.com/JonathonGuo777/bran/schemas/hodor-interactive-story-target.schema.json',
    contractVersion: '1.0.0',
    target: 'hodor-interactive-story',
    source: {
      branPackageVersion: manifest.packageVersion,
      branProjectId: manifest.projectId,
      branArtifactHash: compileReceipt.artifactHash,
      recipeId
    },
    project: {
      projectId: Number(projectId),
      title: bounded(manifest.title, 500)
    },
    graph: {
      title: bounded(manifest.title, 500),
      status: 'ready'
    },
    entryNodeKey: nodeKey(entrySceneId),
    variables,
    nodes,
    edges,
    downstreamContract: {
      protocol: 'hodor.interactive-story-tools.v1',
      revisionPolicy: 'Read the latest revision after every mutation and use it as expectedRevision for the next mutation.',
      tools: {
        initialize: 'initialize_interactive_story',
        createNode: 'create_interactive_script_node',
        defineVariable: 'define_interactive_variable',
        connectNodes: 'connect_interactive_nodes',
        setEntry: 'set_interactive_entry_node',
        updateGraph: 'update_interactive_story_graph',
        validate: 'validate_interactive_story_graph'
      },
      importOrder: ['initialize', 'define-variables', 'create-nodes', 'connect-edges', 'set-entry', 'mark-ready', 'validate'],
      bindingReceiptRequired: true
    }
  }
  target.targetHash = sha256(target)
  diagnostics.push(...validateHodorTarget(target))
  if (hasErrors(diagnostics)) return { result: 'fail', diagnostics, target }
  if (outputPath) writeJson(path.resolve(outputPath), target)
  return {
    result: 'pass',
    outputPath: outputPath ? path.resolve(outputPath) : null,
    targetHash: target.targetHash,
    counts: {
      variables: target.variables.length,
      nodes: target.nodes.length,
      edges: target.edges.length,
      endings: target.nodes.filter(node => node.kind === 'ending').length
    },
    diagnostics,
    target
  }
}

const bindingDiagnostics = ({ target, receipt }) => {
  const diagnostics = []
  if (receipt.contractVersion !== '1.0.0') diagnostics.push(createDiagnostic('HODOR_RECEIPT_VERSION_UNSUPPORTED', 'error', 'Hodor import receipt contractVersion must be 1.0.0.'))
  if (receipt.status !== 'validated') diagnostics.push(createDiagnostic('HODOR_RECEIPT_STATUS_INVALID', 'error', 'Hodor import receipt status must be validated.'))
  if (receipt.targetHash !== target.targetHash) diagnostics.push(createDiagnostic('HODOR_RECEIPT_TARGET_STALE', 'error', 'Hodor import receipt does not match the current target hash.'))
  if (receipt.projectId !== target.project.projectId) diagnostics.push(createDiagnostic('HODOR_RECEIPT_PROJECT_MISMATCH', 'error', 'Hodor import receipt projectId does not match the target.'))
  if (!receipt.graphId || !Number.isInteger(receipt.revision) || receipt.revision < 0) diagnostics.push(createDiagnostic('HODOR_RECEIPT_GRAPH_INVALID', 'error', 'Hodor import receipt needs graphId and a non-negative revision.'))

  const compareBindings = (label, expected, actual, keyName, validate) => {
    const byKey = new Map((actual ?? []).map(item => [item[keyName], item]))
    const missing = expected.filter(key => !byKey.has(key))
    const invalid = expected.filter(key => byKey.has(key) && !validate(byKey.get(key)))
    const extra = [...byKey.keys()].filter(key => !expected.includes(key))
    if (missing.length || invalid.length || extra.length) {
      diagnostics.push(createDiagnostic(`HODOR_RECEIPT_${label.toUpperCase()}_BINDINGS_INVALID`, 'error', `${label} bindings are incomplete or invalid.`, { evidence: { missing, invalid, extra } }))
    }
  }
  compareBindings('node', target.nodes.map(item => item.nodeKey), receipt.nodeBindings, 'nodeKey', item => Boolean(item.nodeId) && Number.isInteger(item.scriptId) && item.scriptId > 0)
  compareBindings('edge', target.edges.map(item => item.edgeKey), receipt.edgeBindings, 'edgeKey', item => Boolean(item.edgeId))
  compareBindings('variable', target.variables.map(item => item.variableKey), receipt.variableBindings, 'variableKey', item => Boolean(item.variableId))
  if (receipt.validation?.valid !== true || (receipt.validation?.issues ?? []).length) diagnostics.push(createDiagnostic('HODOR_RECEIPT_VALIDATION_FAILED', 'error', 'Hodor graph validation must pass with zero issues.', { evidence: receipt.validation ?? null }))
  return diagnostics
}

export const verifyHodorReceipt = ({ targetPath, receiptPath }) => {
  const target = readJson(path.resolve(targetPath))
  const receipt = readJson(path.resolve(receiptPath))
  const diagnostics = [
    ...validateHodorTarget(target),
    ...bindingDiagnostics({ target, receipt })
  ]
  return {
    result: hasErrors(diagnostics) ? 'fail' : 'pass',
    targetPath: path.resolve(targetPath),
    receiptPath: path.resolve(receiptPath),
    targetHash: target.targetHash,
    graphId: receipt.graphId ?? null,
    revision: receipt.revision ?? null,
    diagnostics
  }
}

export const createHodorReceiptFixture = target => ({
  $schema: 'https://github.com/JonathonGuo777/bran/schemas/hodor-import-receipt.schema.json',
  contractVersion: '1.0.0',
  status: 'validated',
  targetHash: target.targetHash,
  projectId: target.project.projectId,
  graphId: 'graph-fixture',
  revision: target.variables.length + target.nodes.length + target.edges.length + 2,
  nodeBindings: target.nodes.map((node, index) => ({
    nodeKey: node.nodeKey,
    nodeId: `node-${index + 1}`,
    scriptId: index + 1
  })),
  edgeBindings: target.edges.map((edge, index) => ({ edgeKey: edge.edgeKey, edgeId: `edge-${index + 1}` })),
  variableBindings: target.variables.map((variable, index) => ({ variableKey: variable.variableKey, variableId: `variable-${index + 1}` })),
  validation: { valid: true, issues: [] },
  appliedAt: '2026-07-27T00:00:00.000Z'
})

const withoutKey = (value, key) => {
  const copy = { ...value }
  delete copy[key]
  return copy
}

const keyedChanges = (baseItems, candidateItems, key) => {
  const base = new Map((baseItems ?? []).map(item => [item[key], item]))
  const candidate = new Map((candidateItems ?? []).map(item => [item[key], item]))
  return {
    added: [...candidate.keys()].filter(itemKey => !base.has(itemKey)),
    removed: [...base.keys()].filter(itemKey => !candidate.has(itemKey)),
    changed: [...candidate.keys()].filter(itemKey =>
      base.has(itemKey) &&
      stableStringify(withoutKey(base.get(itemKey), key)) !== stableStringify(withoutKey(candidate.get(itemKey), key))
    )
  }
}

export const diffHodorTargets = ({ baseTargetPath, targetPath }) => {
  const absoluteBaseTarget = path.resolve(baseTargetPath)
  const absoluteTarget = path.resolve(targetPath)
  const base = readJson(absoluteBaseTarget)
  const target = readJson(absoluteTarget)
  const diagnostics = [
    ...validateHodorTarget(base),
    ...validateHodorTarget(target)
  ]
  if (base.project?.projectId !== target.project?.projectId) {
    diagnostics.push(createDiagnostic(
      'HODOR_TARGET_PROJECT_MISMATCH',
      'error',
      'Hodor target diff requires the same downstream projectId.'
    ))
  }
  const changes = {
    variables: keyedChanges(base.variables, target.variables, 'variableKey'),
    nodes: keyedChanges(base.nodes, target.nodes, 'nodeKey'),
    edges: keyedChanges(base.edges, target.edges, 'edgeKey'),
    entryChanged: base.entryNodeKey !== target.entryNodeKey,
    graphChanged: stableStringify(base.graph) !== stableStringify(target.graph)
  }
  const total = Object.values(changes.variables).reduce((sum, items) => sum + items.length, 0) +
    Object.values(changes.nodes).reduce((sum, items) => sum + items.length, 0) +
    Object.values(changes.edges).reduce((sum, items) => sum + items.length, 0) +
    Number(changes.entryChanged) +
    Number(changes.graphChanged)
  return {
    result: hasErrors(diagnostics) ? 'fail' : 'pass',
    baseTargetPath: absoluteBaseTarget,
    targetPath: absoluteTarget,
    baseTargetHash: base.targetHash,
    targetHash: target.targetHash,
    total,
    changes,
    diagnostics
  }
}

const hodorApi = ({ baseUrl, token }) => {
  const origin = String(baseUrl ?? '').replace(/\/+$/u, '')
  if (!/^https?:\/\//u.test(origin)) throw new Error('Hodor base URL must start with http:// or https://.')
  if (!token?.trim()) throw new Error('Hodor apply requires a bearer token supplied through an environment variable.')
  const post = async (route, body) => {
    const response = await fetch(`${origin}/api/interactiveStory/graph${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token.trim()}`
      },
      body: JSON.stringify(body)
    })
    const text = await response.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`Hodor ${route} returned non-JSON status ${response.status}: ${text.slice(0, 500)}`)
    }
    if (!response.ok || (payload?.code !== undefined && Number(payload.code) >= 400)) {
      const error = new Error(payload?.message ?? `Hodor ${route} failed with status ${response.status}.`)
      error.code = payload?.errorCode ?? `HTTP_${response.status}`
      error.details = payload?.details ?? null
      throw error
    }
    return payload?.data ?? payload
  }
  return { post }
}

const applyingReceipt = target => ({
  $schema: 'https://github.com/JonathonGuo777/bran/schemas/hodor-import-receipt.schema.json',
  contractVersion: '1.0.0',
  status: 'applying',
  targetHash: target.targetHash,
  projectId: target.project.projectId,
  graphId: null,
  revision: 0,
  nodeBindings: [],
  edgeBindings: [],
  variableBindings: [],
  validation: { valid: false, issues: [{ code: 'IMPORT_IN_PROGRESS', message: 'Hodor target application is incomplete.' }] },
  appliedAt: null
})

const assertResumeReceipt = (target, receipt) => {
  if (receipt.contractVersion !== '1.0.0' || receipt.targetHash !== target.targetHash || receipt.projectId !== target.project.projectId) {
    throw new Error('Existing Hodor receipt does not match this target and project.')
  }
  if (!['applying', 'validated', 'failed'].includes(receipt.status)) throw new Error(`Cannot resume Hodor receipt with status ${receipt.status}.`)
}

export const applyHodorTarget = async ({ targetPath, baseUrl, token, receiptPath }) => {
  const absoluteTarget = path.resolve(targetPath)
  const absoluteReceipt = path.resolve(receiptPath)
  const target = readJson(absoluteTarget)
  const targetDiagnostics = validateHodorTarget(target)
  if (hasErrors(targetDiagnostics)) return { result: 'fail', targetPath: absoluteTarget, receiptPath: absoluteReceipt, diagnostics: targetDiagnostics }

  let receipt = fs.existsSync(absoluteReceipt) ? readJson(absoluteReceipt) : applyingReceipt(target)
  try {
    assertResumeReceipt(target, receipt)
    if (receipt.status === 'validated') {
      const verified = verifyHodorReceipt({ targetPath: absoluteTarget, receiptPath: absoluteReceipt })
      return { ...verified, resumed: true }
    }
    if (receipt.status === 'failed') receipt.status = 'applying'
    const api = hodorApi({ baseUrl, token })
    await api.post('/initialize', { projectId: target.project.projectId, title: target.graph.title })
    let graph = await api.post('/get', { projectId: target.project.projectId })
    if (!graph?.id) throw new Error('Hodor graph initialization returned no graph ID.')
    if (receipt.graphId && receipt.graphId !== graph.id) throw new Error(`Resume receipt graph ${receipt.graphId} differs from Hodor graph ${graph.id}.`)
    const receiptHasBindings = Boolean(receipt.nodeBindings.length || receipt.edgeBindings.length || receipt.variableBindings.length)
    if (receipt.graphId && receiptHasBindings && receipt.revision !== graph.revision) {
      const error = new Error(`Hodor graph revision changed outside this import: receipt ${receipt.revision}, graph ${graph.revision}.`)
      error.code = 'HODOR_APPLY_REVISION_DRIFT'
      throw error
    }
    receipt.graphId = graph.id
    receipt.revision = graph.revision

    const hasReceiptBindings = receiptHasBindings
    if (!hasReceiptBindings && ((graph.nodes ?? []).length || (graph.edges ?? []).length || (graph.variables ?? []).length)) {
      throw new Error('Hodor project already has a non-empty interactive graph and no matching resume receipt.')
    }
    writeJson(absoluteReceipt, receipt)

    const refresh = async () => {
      graph = await api.post('/get', { projectId: target.project.projectId })
      if (!graph?.id || graph.id !== receipt.graphId) throw new Error('Hodor graph changed during import.')
      receipt.revision = graph.revision
      writeJson(absoluteReceipt, receipt)
      return graph
    }
    const mutate = async (route, body) => {
      const result = await api.post(route, {
        ...body,
        projectId: target.project.projectId,
        graphId: receipt.graphId,
        expectedRevision: receipt.revision
      })
      await refresh()
      return result
    }

    const variableBindings = new Map(receipt.variableBindings.map(item => [item.variableKey, item]))
    for (const variable of target.variables) {
      if (variableBindings.has(variable.variableKey)) continue
      const created = await mutate('/variables', {
        name: variable.name,
        label: variable.label,
        type: variable.type,
        initialValue: variable.initialValue,
        description: variable.description
      })
      const binding = { variableKey: variable.variableKey, variableId: created.id }
      receipt.variableBindings.push(binding)
      variableBindings.set(variable.variableKey, binding)
      writeJson(absoluteReceipt, receipt)
    }

    const nodeBindings = new Map(receipt.nodeBindings.map(item => [item.nodeKey, item]))
    for (const node of target.nodes) {
      if (nodeBindings.has(node.nodeKey)) continue
      const created = await mutate('/nodes/create', {
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        position: node.position,
        status: node.status,
        script: node.script
      })
      const binding = { nodeKey: node.nodeKey, nodeId: created.id, scriptId: created.scriptId }
      receipt.nodeBindings.push(binding)
      nodeBindings.set(node.nodeKey, binding)
      writeJson(absoluteReceipt, receipt)
    }

    const edgeBindings = new Map(receipt.edgeBindings.map(item => [item.edgeKey, item]))
    for (const edge of target.edges) {
      if (edgeBindings.has(edge.edgeKey)) continue
      const source = nodeBindings.get(edge.sourceNodeKey)
      const destination = nodeBindings.get(edge.targetNodeKey)
      if (!source || !destination) throw new Error(`Hodor node binding is missing for edge ${edge.edgeKey}.`)
      const created = await mutate('/edges', {
        sourceNodeId: source.nodeId,
        targetNodeId: destination.nodeId,
        choiceText: edge.choiceText,
        condition: edge.condition,
        effects: edge.effects,
        priority: edge.priority
      })
      const binding = { edgeKey: edge.edgeKey, edgeId: created.id }
      receipt.edgeBindings.push(binding)
      edgeBindings.set(edge.edgeKey, binding)
      writeJson(absoluteReceipt, receipt)
    }

    const entry = nodeBindings.get(target.entryNodeKey)
    if (!entry) throw new Error(`Hodor entry binding is missing for ${target.entryNodeKey}.`)
    if (graph.entryNodeId !== entry.nodeId) await mutate('/entry', { nodeId: entry.nodeId })
    if (graph.status !== target.graph.status) await mutate('/update', { status: target.graph.status })
    const validation = await api.post('/validate', { projectId: target.project.projectId, graphId: receipt.graphId })
    receipt.revision = validation.revision
    receipt.validation = { valid: Boolean(validation.valid), issues: validation.issues ?? [] }
    receipt.status = validation.valid && !(validation.issues ?? []).length ? 'validated' : 'failed'
    receipt.appliedAt = new Date().toISOString()
    writeJson(absoluteReceipt, receipt)
    const diagnostics = bindingDiagnostics({ target, receipt })
    return {
      result: hasErrors(diagnostics) ? 'fail' : 'pass',
      targetPath: absoluteTarget,
      receiptPath: absoluteReceipt,
      targetHash: target.targetHash,
      graphId: receipt.graphId,
      revision: receipt.revision,
      resumed: hasReceiptBindings,
      diagnostics
    }
  } catch (error) {
    const diagnosticCode = error.code === 'INTERACTIVE_STORY_REVISION_CONFLICT'
      ? 'HODOR_APPLY_REVISION_CONFLICT'
      : error.code === 'HODOR_APPLY_REVISION_DRIFT'
        ? 'HODOR_APPLY_REVISION_DRIFT'
        : 'HODOR_APPLY_FAILED'
    const diagnostic = createDiagnostic(
      diagnosticCode,
      'error',
      error.message,
      { evidence: error.details ?? undefined }
    )
    return {
      result: 'fail',
      targetPath: absoluteTarget,
      receiptPath: absoluteReceipt,
      partial: fs.existsSync(absoluteReceipt),
      graphId: receipt.graphId ?? null,
      revision: receipt.revision ?? null,
      diagnostics: [diagnostic]
    }
  }
}

const currentVariableMatches = (current, target) => current &&
  current.name === target.name &&
  current.label === target.label &&
  current.type === target.type &&
  stableStringify(current.initialValue) === stableStringify(target.initialValue) &&
  current.description === target.description

const currentNodeMatches = (current, target) => current &&
  current.kind === target.kind &&
  current.title === target.title &&
  current.summary === target.summary &&
  stableStringify(current.position) === stableStringify(target.position) &&
  current.status === target.status &&
  current.script?.name === target.script.name &&
  current.script?.content === target.script.content

const currentEdgeMatches = (current, target, nodeBindings) => current &&
  current.sourceNodeId === nodeBindings.get(target.sourceNodeKey)?.nodeId &&
  current.targetNodeId === nodeBindings.get(target.targetNodeKey)?.nodeId &&
  current.choiceText === target.choiceText &&
  current.condition === target.condition &&
  stableStringify(current.effects ?? []) === stableStringify(target.effects ?? []) &&
  current.priority === target.priority

const applyingSyncReceipt = ({ target, baseReceipt }) => ({
  ...structuredClone(baseReceipt),
  status: 'applying',
  targetHash: target.targetHash,
  validation: {
    valid: false,
    issues: [{ code: 'SYNC_IN_PROGRESS', message: 'Hodor target synchronization is incomplete.' }]
  },
  appliedAt: null
})

export const syncHodorTarget = async ({
  baseTargetPath,
  targetPath,
  baseReceiptPath,
  receiptPath,
  baseUrl,
  token
}) => {
  const absoluteBaseTarget = path.resolve(baseTargetPath)
  const absoluteTarget = path.resolve(targetPath)
  const absoluteBaseReceipt = path.resolve(baseReceiptPath)
  const absoluteReceipt = path.resolve(receiptPath)
  const target = readJson(absoluteTarget)
  const targetDiagnostics = validateHodorTarget(target)
  if (hasErrors(targetDiagnostics)) {
    return { result: 'fail', targetPath: absoluteTarget, receiptPath: absoluteReceipt, diagnostics: targetDiagnostics }
  }
  if (absoluteBaseReceipt === absoluteReceipt) {
    return {
      result: 'fail',
      targetPath: absoluteTarget,
      receiptPath: absoluteReceipt,
      diagnostics: [createDiagnostic(
        'HODOR_SYNC_RECEIPT_PATH_REUSED',
        'error',
        'Hodor sync must preserve the base receipt and write a separate candidate receipt.'
      )]
    }
  }

  const resumed = fs.existsSync(absoluteReceipt)
  let receipt
  let changes
  try {
    const targetDiff = diffHodorTargets({ baseTargetPath: absoluteBaseTarget, targetPath: absoluteTarget })
    if (targetDiff.result !== 'pass') {
      return {
        result: 'fail',
        targetPath: absoluteTarget,
        receiptPath: absoluteReceipt,
        diagnostics: targetDiff.diagnostics
      }
    }
    changes = targetDiff.changes
    if (resumed) {
      receipt = readJson(absoluteReceipt)
      assertResumeReceipt(target, receipt)
      if (receipt.status === 'validated') {
        const verified = verifyHodorReceipt({ targetPath: absoluteTarget, receiptPath: absoluteReceipt })
        return { ...verified, resumed: true, changes }
      }
      if (receipt.status === 'failed') receipt.status = 'applying'
    } else {
      const baseVerification = verifyHodorReceipt({
        targetPath: absoluteBaseTarget,
        receiptPath: absoluteBaseReceipt
      })
      if (baseVerification.result !== 'pass') {
        return {
          result: 'fail',
          targetPath: absoluteTarget,
          receiptPath: absoluteReceipt,
          diagnostics: [createDiagnostic(
            'HODOR_SYNC_BASE_UNVERIFIED',
            'error',
            'Hodor sync requires a valid base target and binding receipt.',
            { evidence: baseVerification.diagnostics }
          )]
        }
      }
      receipt = applyingSyncReceipt({
        target,
        baseReceipt: readJson(absoluteBaseReceipt)
      })
      writeJson(absoluteReceipt, receipt)
    }

    const api = hodorApi({ baseUrl, token })
    let graph = await api.post('/get', { projectId: target.project.projectId })
    if (!graph?.id || graph.id !== receipt.graphId) {
      throw new Error(`Hodor sync receipt graph ${receipt.graphId} differs from the current project graph ${graph?.id ?? 'missing'}.`)
    }
    if (receipt.revision !== graph.revision) {
      const error = new Error(`Hodor graph revision changed outside this sync: receipt ${receipt.revision}, graph ${graph.revision}.`)
      error.code = 'HODOR_APPLY_REVISION_DRIFT'
      throw error
    }

    const refresh = async () => {
      graph = await api.post('/get', { projectId: target.project.projectId })
      if (!graph?.id || graph.id !== receipt.graphId) throw new Error('Hodor graph changed during sync.')
      receipt.revision = graph.revision
      writeJson(absoluteReceipt, receipt)
      return graph
    }
    const mutate = async (route, body) => {
      const result = await api.post(route, {
        ...body,
        projectId: target.project.projectId,
        graphId: receipt.graphId,
        expectedRevision: receipt.revision
      })
      await refresh()
      return result
    }

    if (graph.status !== 'draft') await mutate('/update', { status: 'draft' })

    const variableBindings = new Map(receipt.variableBindings.map(item => [item.variableKey, item]))
    for (const variable of target.variables) {
      const binding = variableBindings.get(variable.variableKey)
      const current = binding ? graph.variables.find(item => item.id === binding.variableId) : null
      if (binding && !current) throw new Error(`Bound Hodor variable ${variable.variableKey} is missing from the graph.`)
      if (!currentVariableMatches(current, variable)) {
        const saved = await mutate('/variables', {
          name: variable.name,
          label: variable.label,
          type: variable.type,
          initialValue: variable.initialValue,
          description: variable.description
        })
        if (binding && saved.id !== binding.variableId) throw new Error(`Hodor variable binding changed for ${variable.variableKey}.`)
        if (!binding) {
          const next = { variableKey: variable.variableKey, variableId: saved.id }
          receipt.variableBindings.push(next)
          variableBindings.set(variable.variableKey, next)
          writeJson(absoluteReceipt, receipt)
        }
      }
    }

    const nodeBindings = new Map(receipt.nodeBindings.map(item => [item.nodeKey, item]))
    for (const node of target.nodes) {
      const binding = nodeBindings.get(node.nodeKey)
      const current = binding ? graph.nodes.find(item => item.id === binding.nodeId) : null
      if (binding && !current) throw new Error(`Bound Hodor node ${node.nodeKey} is missing from the graph.`)
      if (!binding) {
        const created = await mutate('/nodes/create', {
          kind: node.kind,
          title: node.title,
          summary: node.summary,
          position: node.position,
          status: node.status,
          script: node.script
        })
        const next = { nodeKey: node.nodeKey, nodeId: created.id, scriptId: created.scriptId }
        receipt.nodeBindings.push(next)
        nodeBindings.set(node.nodeKey, next)
        writeJson(absoluteReceipt, receipt)
      } else if (!currentNodeMatches(current, node)) {
        const updated = await mutate('/nodes/update', {
          nodeId: binding.nodeId,
          kind: node.kind,
          title: node.title,
          summary: node.summary,
          position: node.position,
          status: node.status,
          script: node.script
        })
        if (updated.scriptId && updated.scriptId !== binding.scriptId) throw new Error(`Hodor script binding changed for ${node.nodeKey}.`)
      }
    }

    const targetEdgeKeys = new Set(target.edges.map(item => item.edgeKey))
    for (const binding of [...receipt.edgeBindings]) {
      if (targetEdgeKeys.has(binding.edgeKey)) continue
      if (graph.edges.some(item => item.id === binding.edgeId)) await mutate('/edges/delete', { edgeId: binding.edgeId })
      receipt.edgeBindings = receipt.edgeBindings.filter(item => item.edgeKey !== binding.edgeKey)
      writeJson(absoluteReceipt, receipt)
    }

    const edgeBindings = new Map(receipt.edgeBindings.map(item => [item.edgeKey, item]))
    for (const edge of target.edges) {
      const source = nodeBindings.get(edge.sourceNodeKey)
      const destination = nodeBindings.get(edge.targetNodeKey)
      if (!source || !destination) throw new Error(`Hodor node binding is missing for edge ${edge.edgeKey}.`)
      const binding = edgeBindings.get(edge.edgeKey)
      const current = binding ? graph.edges.find(item => item.id === binding.edgeId) : null
      if (binding && !current) throw new Error(`Bound Hodor edge ${edge.edgeKey} is missing from the graph.`)
      const edgeBody = {
        sourceNodeId: source.nodeId,
        targetNodeId: destination.nodeId,
        choiceText: edge.choiceText,
        condition: edge.condition,
        effects: edge.effects,
        priority: edge.priority
      }
      if (!binding) {
        const created = await mutate('/edges', edgeBody)
        const next = { edgeKey: edge.edgeKey, edgeId: created.id }
        receipt.edgeBindings.push(next)
        edgeBindings.set(edge.edgeKey, next)
        writeJson(absoluteReceipt, receipt)
      } else if (!currentEdgeMatches(current, edge, nodeBindings)) {
        await mutate('/edges/update', { edgeId: binding.edgeId, ...edgeBody })
      }
    }

    const entry = nodeBindings.get(target.entryNodeKey)
    if (!entry) throw new Error(`Hodor entry binding is missing for ${target.entryNodeKey}.`)
    if (graph.entryNodeId !== entry.nodeId) await mutate('/entry', { nodeId: entry.nodeId })

    const targetNodeKeys = new Set(target.nodes.map(item => item.nodeKey))
    for (const binding of [...receipt.nodeBindings]) {
      if (targetNodeKeys.has(binding.nodeKey)) continue
      if (graph.nodes.some(item => item.id === binding.nodeId)) await mutate('/nodes/delete', { nodeId: binding.nodeId })
      receipt.nodeBindings = receipt.nodeBindings.filter(item => item.nodeKey !== binding.nodeKey)
      writeJson(absoluteReceipt, receipt)
    }

    const targetVariableKeys = new Set(target.variables.map(item => item.variableKey))
    for (const binding of [...receipt.variableBindings]) {
      if (targetVariableKeys.has(binding.variableKey)) continue
      if (graph.variables.some(item => item.id === binding.variableId)) await mutate('/variables/delete', { variableId: binding.variableId })
      receipt.variableBindings = receipt.variableBindings.filter(item => item.variableKey !== binding.variableKey)
      writeJson(absoluteReceipt, receipt)
    }

    if (graph.title !== target.graph.title || graph.status !== target.graph.status) {
      await mutate('/update', { title: target.graph.title, status: target.graph.status })
    }
    const validation = await api.post('/validate', {
      projectId: target.project.projectId,
      graphId: receipt.graphId
    })
    receipt.revision = validation.revision
    receipt.validation = { valid: Boolean(validation.valid), issues: validation.issues ?? [] }
    receipt.status = validation.valid && !(validation.issues ?? []).length ? 'validated' : 'failed'
    receipt.appliedAt = new Date().toISOString()
    writeJson(absoluteReceipt, receipt)
    const diagnostics = bindingDiagnostics({ target, receipt })
    return {
      result: hasErrors(diagnostics) ? 'fail' : 'pass',
      targetPath: absoluteTarget,
      receiptPath: absoluteReceipt,
      targetHash: target.targetHash,
      graphId: receipt.graphId,
      revision: receipt.revision,
      resumed,
      changes,
      diagnostics
    }
  } catch (error) {
    const diagnosticCode = error.code === 'INTERACTIVE_STORY_REVISION_CONFLICT'
      ? 'HODOR_SYNC_REVISION_CONFLICT'
      : error.code === 'HODOR_APPLY_REVISION_DRIFT'
        ? 'HODOR_SYNC_REVISION_DRIFT'
        : 'HODOR_SYNC_FAILED'
    return {
      result: 'fail',
      targetPath: absoluteTarget,
      receiptPath: absoluteReceipt,
      partial: fs.existsSync(absoluteReceipt),
      graphId: receipt?.graphId ?? null,
      revision: receipt?.revision ?? null,
      diagnostics: [createDiagnostic(
        diagnosticCode,
        'error',
        error.message,
        { evidence: error.details ?? undefined }
      )]
    }
  }
}
