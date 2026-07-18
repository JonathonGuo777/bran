import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const stableStringify = value => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const sha256 = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex')

export const getPath = (value, dottedPath, fallback) => {
  if (!dottedPath) return value
  const result = String(dottedPath).split('.').reduce((current, key) => current?.[key], value)
  return result === undefined ? fallback : result
}

export const setPath = (target, dottedPath, value) => {
  const keys = String(dottedPath).split('.')
  let current = target
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== 'object') current[key] = {}
    current = current[key]
  }
  current[keys.at(-1)] = value
  return target
}

export const ensureDirectory = directory => fs.mkdirSync(directory, { recursive: true })

export const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))

export const readJsonl = filePath => {
  const text = fs.readFileSync(filePath, 'utf8').trim()
  return text ? text.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`${filePath}:${index + 1}: ${error.message}`)
    }
  }) : []
}

export const writeJson = (filePath, value) => {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export const writeJsonl = (filePath, rows) => {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '')
}

export const uniqueDuplicates = values => {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].sort()
}

export const createDiagnostic = (code, severity, message, options = {}) => ({
  code,
  severity,
  message,
  ...(options.path ? { path: options.path } : {}),
  ...(options.evidence !== undefined ? { evidence: options.evidence } : {})
})

export const hasErrors = diagnostics => diagnostics.some(item => item.severity === 'error')

export const resolvePackageDirectory = root => {
  const absolute = path.resolve(root)
  return path.basename(absolute) === 'package' ? absolute : path.join(absolute, 'package')
}

export const artifactHash = (directory, names) => sha256(names.slice().sort().map(name => {
  const filePath = path.join(directory, name)
  return `${name}\0${fs.readFileSync(filePath, 'utf8')}`
}).join('\0'))

export const collectConditionPaths = value => {
  if (Array.isArray(value)) return value.flatMap(collectConditionPaths)
  if (!value || typeof value !== 'object') return []
  const paths = []
  if (typeof value.path === 'string') paths.push(value.path)
  if (Object.hasOwn(value, 'var')) {
    const variable = Array.isArray(value.var) ? value.var[0] : value.var
    if (typeof variable === 'string' && variable) paths.push(variable)
  }
  return [...new Set(paths.concat(Object.values(value).flatMap(collectConditionPaths)))]
}
