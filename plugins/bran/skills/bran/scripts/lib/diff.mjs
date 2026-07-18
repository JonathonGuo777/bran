import path from 'node:path'
import { readJson, readJsonl, resolvePackageDirectory, sha256, stableStringify } from './common.mjs'

const loadPackage = root => {
  const packageDir = resolvePackageDirectory(root)
  const readRows = name => readJsonl(path.join(packageDir, name))
  const manifest = readJson(path.join(packageDir, 'source-manifest.json'))
  const recipes = readRows('recipe-stage-overrides.jsonl')
  return {
    packageDir,
    manifest,
    collections: {
      sourceEvents: readRows('source-events.jsonl'),
      characters: readRows('character-contracts.jsonl'),
      scenes: readRows('scene-scripts.jsonl'),
      actions: [
        ...readRows('baseline-stage-actions.jsonl'),
        ...recipes.flatMap(recipe => (recipe.stageOverrides ?? []).flatMap(stage => stage.actions ?? []))
      ],
      recipes,
      endings: readJson(path.join(packageDir, 'settlement-rules.json')).rules ?? []
    }
  }
}

const KEYS = {
  sourceEvents: 'eventId',
  characters: 'characterId',
  scenes: 'sceneId',
  actions: 'actionInstanceId',
  recipes: 'recipeId',
  endings: 'endingCode'
}

const compareCollection = (left, right, key) => {
  const leftMap = new Map(left.map(item => [item[key], item]))
  const rightMap = new Map(right.map(item => [item[key], item]))
  const added = [...rightMap.keys()].filter(id => !leftMap.has(id)).sort()
  const removed = [...leftMap.keys()].filter(id => !rightMap.has(id)).sort()
  const changed = [...leftMap.keys()].filter(id => rightMap.has(id) && sha256(stableStringify(leftMap.get(id))) !== sha256(stableStringify(rightMap.get(id)))).sort()
  const unchanged = [...leftMap.keys()].filter(id => rightMap.has(id) && !changed.includes(id)).sort()
  return { added, removed, changed, unchangedCount: unchanged.length }
}

export const diffPackages = ({ baseRoot, candidateRoot }) => {
  const base = loadPackage(baseRoot)
  const candidate = loadPackage(candidateRoot)
  const changes = Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [name, compareCollection(base.collections[name], candidate.collections[name], key)]))
  const totals = Object.values(changes).reduce((result, change) => ({
    added: result.added + change.added.length,
    removed: result.removed + change.removed.length,
    changed: result.changed + change.changed.length
  }), { added: 0, removed: 0, changed: 0 })
  const expectedParent = base.manifest.packageVersion
  const declaredParent = candidate.manifest.lineage?.parentPackageVersion ?? null
  return {
    result: 'pass',
    base: {
      packageDir: base.packageDir,
      projectId: base.manifest.projectId,
      packageVersion: base.manifest.packageVersion,
      lifecycle: base.manifest.lifecycle
    },
    candidate: {
      packageDir: candidate.packageDir,
      projectId: candidate.manifest.projectId,
      packageVersion: candidate.manifest.packageVersion,
      lifecycle: candidate.manifest.lifecycle
    },
    sameProject: base.manifest.projectId === candidate.manifest.projectId,
    lineage: {
      expectedParent,
      declaredParent,
      linked: declaredParent === expectedParent
    },
    changes,
    totals,
    breaking: Object.values(changes).some(change => change.removed.length > 0)
  }
}
