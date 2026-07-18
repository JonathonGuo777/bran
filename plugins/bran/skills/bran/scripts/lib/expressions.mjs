import { createDiagnostic, getPath, setPath } from './common.mjs'

const truthy = value => Array.isArray(value) ? value.length > 0 : Boolean(value)

const compare = (operator, left, right) => {
  switch (operator) {
    case 'eq':
    case '==': return left === right
    case 'neq':
    case '!=': return left !== right
    case 'gt':
    case '>': return left > right
    case 'gte':
    case '>=': return left >= right
    case 'lt':
    case '<': return left < right
    case 'lte':
    case '<=': return left <= right
    case 'in': return Array.isArray(right) || typeof right === 'string' ? right.includes(left) : false
    default: throw new Error(`Unsupported comparison operator: ${operator}`)
  }
}

const evaluateLegacy = (expression, data, context) => {
  if (expression.always === true) return true
  if (Array.isArray(expression.all)) return expression.all.every(item => truthy(evaluateExpression(item, data, context)))
  if (Array.isArray(expression.any)) return expression.any.some(item => truthy(evaluateExpression(item, data, context)))
  if (expression.not !== undefined) return !truthy(evaluateExpression(expression.not, data, context))
  if (Array.isArray(expression.includes) && expression.includes.length === 2) {
    const [path, expected] = expression.includes
    const actual = getPath(data, path)
    return Array.isArray(actual) || typeof actual === 'string' ? actual.includes(expected) : false
  }
  if (expression.op && expression.path) {
    const actual = getPath(data, expression.path)
    if (actual === undefined) context?.missingPaths?.add(expression.path)
    return compare(expression.op, actual, expression.value)
  }
  return undefined
}

export const evaluateExpression = (expression, data, context = {}) => {
  if (Array.isArray(expression)) return expression.map(item => evaluateExpression(item, data, context))
  if (!expression || typeof expression !== 'object') return expression

  const legacy = evaluateLegacy(expression, data, context)
  if (legacy !== undefined) return legacy

  const keys = Object.keys(expression)
  if (keys.length !== 1) throw new Error(`Expression must contain exactly one operator: ${JSON.stringify(expression)}`)
  const operator = keys[0]
  const rawArguments = expression[operator]
  const args = Array.isArray(rawArguments) ? rawArguments : [rawArguments]

  if (operator === 'var') {
    const path = args[0]
    const value = getPath(data, path, args[1])
    if (value === undefined) context?.missingPaths?.add(path)
    return value
  }
  if (operator === 'and') {
    let result = true
    for (const item of args) {
      result = evaluateExpression(item, data, context)
      if (!truthy(result)) return result
    }
    return result
  }
  if (operator === 'or') {
    for (const item of args) {
      const result = evaluateExpression(item, data, context)
      if (truthy(result)) return result
    }
    return false
  }
  if (operator === '!') return !truthy(evaluateExpression(args[0], data, context))
  if (operator === '!!') return truthy(evaluateExpression(args[0], data, context))
  if (['==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(operator)) {
    const values = args.map(item => evaluateExpression(item, data, context))
    const normalized = operator === '===' ? '==' : operator === '!==' ? '!=' : operator
    return compare(normalized, values[0], values[1])
  }
  if (operator === 'in') {
    const values = args.map(item => evaluateExpression(item, data, context))
    return compare('in', values[0], values[1])
  }
  if (operator === 'if') {
    for (let index = 0; index < args.length - 1; index += 2) {
      if (truthy(evaluateExpression(args[index], data, context))) return evaluateExpression(args[index + 1], data, context)
    }
    return args.length % 2 === 1 ? evaluateExpression(args.at(-1), data, context) : null
  }
  if (['+', '-', '*', '/', '%', 'min', 'max'].includes(operator)) {
    const values = args.map(item => Number(evaluateExpression(item, data, context)))
    if (operator === '+') return values.reduce((sum, value) => sum + value, 0)
    if (operator === '*') return values.reduce((product, value) => product * value, 1)
    if (operator === '-') return values.length === 1 ? -values[0] : values.slice(1).reduce((result, value) => result - value, values[0])
    if (operator === '/') return values.slice(1).reduce((result, value) => result / value, values[0])
    if (operator === '%') return values[0] % values[1]
    return Math[operator](...values)
  }
  if (operator === 'cat') return args.map(item => evaluateExpression(item, data, context)).join('')
  if (operator === 'missing') {
    return args.flat().filter(path => {
      const value = getPath(data, path)
      return value === undefined || value === null || value === ''
    })
  }
  throw new Error(`Unsupported expression operator: ${operator}`)
}

export const materializeDerivedState = (worldState, stateRegistry, diagnostics = []) => {
  const state = structuredClone(worldState)
  const pending = (stateRegistry.derivedFields ?? []).map((field, index) => ({ field, index }))
  const pendingPaths = new Set(pending.map(item => item.field.path).filter(Boolean))
  while (pending.length) {
    let progressed = false
    for (let cursor = pending.length - 1; cursor >= 0; cursor -= 1) {
      const { field, index } = pending[cursor]
      if (!field.path) {
        diagnostics.push(createDiagnostic('DERIVED_FIELD_PATH_MISSING', 'error', 'Derived field has no path.', { path: `derivedFields[${index}]` }))
        pending.splice(cursor, 1)
        progressed = true
        continue
      }
      if (!field.expression) {
        diagnostics.push(createDiagnostic('DERIVED_FIELD_NOT_EXECUTABLE', 'error', `Derived field ${field.path} has prose only and cannot be independently recomputed.`, { path: `derivedFields[${index}]`, evidence: field.formula }))
        pendingPaths.delete(field.path)
        pending.splice(cursor, 1)
        progressed = true
        continue
      }
      try {
        const context = { missingPaths: new Set() }
        const value = evaluateExpression(field.expression, state, context)
        if (context.missingPaths.size) {
          const unresolvedDerived = [...context.missingPaths].filter(path => pendingPaths.has(path))
          if (unresolvedDerived.length === context.missingPaths.size) continue
          diagnostics.push(createDiagnostic('DERIVED_FIELD_INPUT_MISSING', 'error', `Derived field ${field.path} reads missing state paths.`, { path: `derivedFields[${index}].expression`, evidence: [...context.missingPaths].sort() }))
          pendingPaths.delete(field.path)
          pending.splice(cursor, 1)
          progressed = true
          continue
        }
        setPath(state, field.path, value)
        pendingPaths.delete(field.path)
        pending.splice(cursor, 1)
        progressed = true
      } catch (error) {
        diagnostics.push(createDiagnostic('DERIVED_FIELD_EXPRESSION_INVALID', 'error', error.message, { path: `derivedFields[${index}].expression` }))
        pendingPaths.delete(field.path)
        pending.splice(cursor, 1)
        progressed = true
      }
    }
    if (!progressed) {
      diagnostics.push(createDiagnostic('DERIVED_FIELD_DEPENDENCY_CYCLE', 'error', 'Derived fields contain a dependency cycle or unresolved derived reference.', { evidence: [...pendingPaths].sort() }))
      break
    }
  }
  return state
}

export const evaluateSettlement = (worldState, settlementRules, stateRegistry, diagnostics = []) => {
  const state = materializeDerivedState(worldState, stateRegistry, diagnostics)
  const priority = new Map((settlementRules.priorityOrder ?? []).map((code, index, list) => [code, list.length - index]))
  const rules = (settlementRules.rules ?? []).slice().sort((left, right) => {
    return (right.priority ?? priority.get(right.endingCode) ?? 0) - (left.priority ?? priority.get(left.endingCode) ?? 0)
  })

  for (const [index, rule] of rules.entries()) {
    try {
      const context = { missingPaths: new Set() }
      const matches = truthy(evaluateExpression(rule.predicate, state, context))
      if (context.missingPaths.size) {
        diagnostics.push(createDiagnostic('SETTLEMENT_PATH_MISSING', 'error', `Settlement rule ${rule.endingCode} reads missing state paths.`, { path: `rules[${index}].predicate`, evidence: [...context.missingPaths].sort() }))
      }
      if (matches && context.missingPaths.size === 0) {
        return {
          endingCode: rule.endingCode,
          reasonCodes: rule.reasonCodes ?? [],
          rule,
          state
        }
      }
    } catch (error) {
      diagnostics.push(createDiagnostic('SETTLEMENT_EXPRESSION_INVALID', 'error', error.message, { path: `rules[${index}].predicate` }))
    }
  }
  diagnostics.push(createDiagnostic('SETTLEMENT_NO_MATCH', 'error', 'No settlement rule matched the reduced world state.'))
  return { endingCode: null, reasonCodes: [], rule: null, state }
}
