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

export const sha256 = value => crypto
  .createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableStringify(value))
  .digest('hex')

export const ensureDirectory = directory => fs.mkdirSync(directory, { recursive: true })

export const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))

export const readJsonOrJsonl = filePath => {
  const text = fs.readFileSync(filePath, 'utf8').trim()
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch {
    return text.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${filePath}:${index + 1}: ${error.message}`)
      }
    })
  }
}

export const writeJson = (filePath, value) => {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export const writeText = (filePath, value) => {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, value)
}

export const createDiagnostic = (code, severity, message, options = {}) => ({
  code,
  severity,
  message,
  ...(options.path ? { path: options.path } : {}),
  ...(options.evidence !== undefined ? { evidence: options.evidence } : {})
})

export const hasErrors = diagnostics => diagnostics.some(item => item.severity === 'error')

export const unique = values => [...new Set(values)]

export const duplicates = values => {
  const seen = new Set()
  const repeated = new Set()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated].sort()
}

export const slug = (value, fallback = 'item') => {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return normalized || fallback
}

export const normalizeText = value => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/\u0000/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim()

export const stringsIn = value => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(stringsIn)
}

export const relativeArtifact = (root, filePath) => path.relative(path.resolve(root), path.resolve(filePath)).replaceAll(path.sep, '/')

export const workspacePaths = root => {
  const workspace = path.resolve(root)
  return {
    workspace,
    manifest: path.join(workspace, 'rewrite-manifest.json'),
    analyst: path.join(workspace, 'analyst'),
    writer: path.join(workspace, 'writer'),
    handoff: path.join(workspace, 'handoff'),
    receipts: path.join(workspace, 'receipts'),
    source: path.join(workspace, 'analyst', 'source.txt'),
    sourceRecord: path.join(workspace, 'analyst', 'source-record.json'),
    structuralExtraction: path.join(workspace, 'analyst', 'structural-extraction.json'),
    extraction: path.join(workspace, 'analyst', 'extraction-ledger.json'),
    dna: path.join(workspace, 'analyst', 'story-dna.json'),
    originalityBaseline: path.join(workspace, 'analyst', 'originality-baseline.json'),
    brief: path.join(workspace, 'writer', 'clean-room-brief.json'),
    draft: path.join(workspace, 'writer', 'rewrite-draft.json'),
    cleanRoomReceipt: path.join(workspace, 'receipts', 'clean-room-receipt.json'),
    auditReceipt: path.join(workspace, 'receipts', 'rewrite-audit-receipt.json'),
    branInput: path.join(workspace, 'handoff', 'bran-input.json'),
    branHandoff: path.join(workspace, 'handoff', 'bran'),
    hodorTarget: path.join(workspace, 'handoff', 'hodor-interactive-story-target.json'),
    tasteHandoff: path.join(workspace, 'handoff', 'taste-review-handoff.json')
  }
}

export const requireFile = (filePath, label = filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`)
  return filePath
}

export const updateManifest = (paths, stage, artifacts = {}) => {
  const manifest = fs.existsSync(paths.manifest)
    ? readJson(paths.manifest)
    : { schemaVersion: '1.0.0', projectId: path.basename(paths.workspace), stages: {}, artifacts: {} }
  manifest.currentStage = stage
  manifest.stages[stage] = {
    completedAt: new Date().toISOString(),
    artifacts: Object.keys(artifacts)
  }
  for (const [name, filePath] of Object.entries(artifacts)) {
    manifest.artifacts[name] = {
      path: relativeArtifact(paths.workspace, filePath),
      hash: sha256(fs.readFileSync(filePath))
    }
  }
  writeJson(paths.manifest, manifest)
  return manifest
}
