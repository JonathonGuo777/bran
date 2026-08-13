import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPackage } from '../plugins/bran/skills/bran/scripts/lib/auditor.mjs'
import { artifactHash, readJson, readJsonl, sha256, writeJson, writeJsonl } from '../plugins/bran/skills/bran/scripts/lib/common.mjs'
import { compileBundle, validateInput } from '../plugins/bran/skills/bran/scripts/lib/compiler.mjs'
import { evaluateSettlement } from '../plugins/bran/skills/bran/scripts/lib/expressions.mjs'
import {
  applyHodorTarget,
  buildHodorTarget,
  createHodorReceiptFixture,
  diffHodorTargets,
  syncHodorTarget,
  validateHodorTarget,
  verifyHodorReceipt
} from '../plugins/bran/skills/bran/scripts/lib/hodor.mjs'
import { buildReviewReceipt, REQUIRED_REVIEW_STAGES, reviewPackage } from '../plugins/bran/skills/bran/scripts/lib/review.mjs'
import { diffPackages } from '../plugins/bran/skills/bran/scripts/lib/diff.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = path.join(root, 'plugins/bran/skills/bran/fixtures/harbor-signal/bran-input.json')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bran-core-test-'))

const startMockHodor = async ({ failOnceAtPath = null } = {}) => {
  const requests = []
  let remainingFailures = failOnceAtPath ? 1 : 0
  let variableSequence = 0
  let nodeSequence = 0
  let edgeSequence = 0
  const graph = {
    id: 'graph-mock',
    projectId: 1785137013680,
    title: 'Harbor Signal',
    entryNodeId: null,
    status: 'draft',
    revision: 0,
    nodes: [],
    edges: [],
    variables: []
  }
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    requests.push({ path: request.url, body, authorization: request.headers.authorization })
    const route = request.url.replace('/api/interactiveStory/graph', '')
    let data
    if (request.headers.authorization !== 'Bearer fixture-token') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 401, data: null, message: 'unauthorized' }))
      return
    }
    if (route === failOnceAtPath && remainingFailures > 0) {
      remainingFailures -= 1
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 503, data: null, message: 'transient fixture failure' }))
      return
    }
    if (!['/initialize', '/get', '/validate'].includes(route) && body.expectedRevision !== graph.revision) {
      response.writeHead(409, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        code: 409,
        data: null,
        message: `revision mismatch ${body.expectedRevision} != ${graph.revision}`,
        errorCode: 'INTERACTIVE_STORY_REVISION_CONFLICT'
      }))
      return
    }
    if (route === '/initialize' || route === '/get') data = structuredClone(graph)
    else if (route === '/variables') {
      const existing = graph.variables.find(item => item.name === body.name)
      const variable = { id: existing?.id ?? `variable-${++variableSequence}`, ...body }
      delete variable.projectId
      delete variable.graphId
      delete variable.expectedRevision
      if (existing) graph.variables.splice(graph.variables.indexOf(existing), 1, variable)
      else graph.variables.push(variable)
      graph.revision += 1
      data = variable
    } else if (route === '/nodes/create') {
      const node = {
        id: `node-${++nodeSequence}`,
        scriptId: nodeSequence,
        ...body
      }
      delete node.projectId
      delete node.graphId
      delete node.expectedRevision
      graph.nodes.push(node)
      graph.revision += 1
      data = node
    } else if (route === '/nodes/update') {
      const index = graph.nodes.findIndex(item => item.id === body.nodeId)
      assert.notEqual(index, -1)
      const current = graph.nodes[index]
      const node = {
        ...current,
        ...body,
        id: current.id,
        scriptId: current.scriptId,
        script: body.script ? { ...current.script, ...body.script } : current.script
      }
      delete node.projectId
      delete node.graphId
      delete node.nodeId
      delete node.expectedRevision
      graph.nodes[index] = node
      graph.revision += 1
      data = node
    } else if (route === '/nodes/delete') {
      graph.nodes = graph.nodes.filter(item => item.id !== body.nodeId)
      graph.edges = graph.edges.filter(item => item.sourceNodeId !== body.nodeId && item.targetNodeId !== body.nodeId)
      if (graph.entryNodeId === body.nodeId) graph.entryNodeId = null
      graph.revision += 1
      data = { graphId: graph.id, nodeId: body.nodeId }
    } else if (route === '/edges') {
      const edge = { id: `edge-${++edgeSequence}`, ...body }
      delete edge.projectId
      delete edge.graphId
      delete edge.expectedRevision
      graph.edges.push(edge)
      graph.revision += 1
      data = edge
    } else if (route === '/edges/update') {
      const index = graph.edges.findIndex(item => item.id === body.edgeId)
      assert.notEqual(index, -1)
      const edge = { ...graph.edges[index], ...body, id: graph.edges[index].id }
      delete edge.projectId
      delete edge.graphId
      delete edge.edgeId
      delete edge.expectedRevision
      graph.edges[index] = edge
      graph.revision += 1
      data = edge
    } else if (route === '/edges/delete') {
      graph.edges = graph.edges.filter(item => item.id !== body.edgeId)
      graph.revision += 1
      data = { graphId: graph.id, edgeId: body.edgeId }
    } else if (route === '/variables/delete') {
      graph.variables = graph.variables.filter(item => item.id !== body.variableId)
      graph.revision += 1
      data = { graphId: graph.id, variableId: body.variableId }
    } else if (route === '/entry') {
      graph.entryNodeId = body.nodeId
      graph.revision += 1
      data = structuredClone(graph)
    } else if (route === '/update') {
      graph.status = body.status ?? graph.status
      graph.title = body.title ?? graph.title
      graph.revision += 1
      data = structuredClone(graph)
    } else if (route === '/validate') {
      data = { graphId: graph.id, revision: graph.revision, valid: true, issues: [] }
    } else {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 404, data: null, message: `unknown route ${route}` }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ code: 200, data, message: 'success' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    graph,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

const makeCandidateHodorTarget = target => {
  const candidate = structuredClone(target)
  candidate.graph.title = `${candidate.graph.title} Updated`
  candidate.variables[0].label = `${candidate.variables[0].label} Updated`
  candidate.variables.push({
    variableKey: 'state:investigation.hidden',
    sourcePath: 'investigation.hidden',
    name: 'investigation_hidden',
    label: 'Hidden investigation',
    type: 'boolean',
    initialValue: false,
    description: 'Tracks whether the player opened the hidden investigation.'
  })
  candidate.nodes[0].title = `${candidate.nodes[0].title} Updated`
  candidate.nodes[0].script.name = candidate.nodes[0].title
  candidate.nodes[0].script.content = `${candidate.nodes[0].script.content}\n\nHidden investigation is now available.`

  const removedEnding = candidate.nodes.filter(node => node.kind === 'ending').at(-1)
  candidate.nodes = candidate.nodes.filter(node => node.nodeKey !== removedEnding.nodeKey)
  candidate.edges = candidate.edges.filter(edge => edge.targetNodeKey !== removedEnding.nodeKey)

  const outgoingCounts = new Map()
  for (const edge of candidate.edges) outgoingCounts.set(edge.sourceNodeKey, (outgoingCounts.get(edge.sourceNodeKey) ?? 0) + 1)
  const branch = candidate.nodes.find(node => node.kind === 'branch' && (outgoingCounts.get(node.nodeKey) ?? 0) < 3)
  assert.ok(branch)
  candidate.nodes.push({
    nodeKey: 'scene:HIDDEN-INVESTIGATION',
    sourceSceneId: 'HIDDEN-INVESTIGATION',
    kind: 'scene',
    title: 'Hidden Investigation',
    summary: 'A hidden evidence route introduced by a Bran package revision.',
    position: { x: branch.position.x + 380, y: branch.position.y + 360 },
    status: 'ready',
    script: {
      name: 'Hidden Investigation',
      content: '# Hidden Investigation\n\nInspect the concealed evidence before settlement.'
    }
  })
  candidate.edges[0].choiceText = `${candidate.edges[0].choiceText} Updated`
  candidate.edges.push({
    edgeKey: 'action:HIDDEN-INVESTIGATION-OPEN',
    sourceNodeKey: branch.nodeKey,
    targetNodeKey: 'scene:HIDDEN-INVESTIGATION',
    choiceText: 'Open the hidden investigation',
    condition: null,
    conditionAst: true,
    conditionPaths: [],
    effects: [{ variable: 'investigation_hidden', operation: 'set', value: true }],
    priority: -10,
    sourceActionInstanceId: 'HIDDEN-INVESTIGATION-OPEN'
  })
  candidate.edges.push({
    edgeKey: 'action:HIDDEN-INVESTIGATION-RETURN',
    sourceNodeKey: 'scene:HIDDEN-INVESTIGATION',
    targetNodeKey: 'hub:bran-settlement',
    choiceText: 'Return to settlement',
    condition: null,
    conditionAst: true,
    conditionPaths: [],
    effects: [],
    priority: 0,
    sourceActionInstanceId: 'HIDDEN-INVESTIGATION-RETURN'
  })
  delete candidate.targetHash
  candidate.targetHash = sha256(candidate)
  const diagnostics = validateHodorTarget(candidate)
  assert.deepEqual(diagnostics.filter(item => item.severity === 'error'), [])
  return candidate
}

const acceptAllReviewStages = outputRoot => {
  let finalReview
  for (const [index, stage] of REQUIRED_REVIEW_STAGES.entries()) {
    finalReview = reviewPackage({ root: outputRoot, stage, status: 'accepted', reviewer: 'core-test', reviewedAt: `2026-07-18T00:00:0${index}.000Z` })
  }
  return finalReview
}

const prepareReleaseFixture = outputRoot => {
  const packageDir = path.join(outputRoot, 'package')
  const releaseArtifacts = [
    ['ART-RECIPE-RECEIPTS', 'compiled-recipe-receipts.jsonl', 'jsonl'],
    ['ART-REPLAY-METRICS', 'replay-metrics.json', 'json'],
    ['ART-EVIDENCE-DECISIONS', 'evidence-decisions.jsonl', 'jsonl'],
    ['ART-WAITING', 'waiting-interactions.jsonl', 'jsonl'],
    ['ART-AGENT-EVAL-CASES', 'agent-eval-cases.jsonl', 'jsonl'],
    ['ART-AGENT-EVAL-RECEIPT', 'agent-eval-receipt.json', 'json'],
    ['ART-CARRYOVER', 'carryover-contracts.jsonl', 'jsonl'],
    ['ART-TRACES', 'playtest-traces.jsonl', 'jsonl'],
    ['ART-SIMULATION-RECEIPT', 'playtest-simulation-receipt.json', 'json'],
    ['ART-SETTLEMENT-RECEIPT', 'settlement-test-receipt.json', 'json'],
    ['ART-QUALITY-RECEIPT', 'quality-receipt.json', 'json']
  ]
  writeJsonl(path.join(packageDir, 'compiled-recipe-receipts.jsonl'), [
    { recipeId: 'RECIPE-OPEN', status: 'pass' },
    { recipeId: 'RECIPE-CAUTIOUS', status: 'pass' }
  ])
  writeJson(path.join(packageDir, 'replay-metrics.json'), { pass: true, minimumActionGraphDistance: 1, maximumDecisionCueReuse: 0 })
  writeJsonl(path.join(packageDir, 'evidence-decisions.jsonl'), [{
    decisionId: 'DECISION-RESPONSE',
    visibleEvidence: ['FACT-SIGNAL', 'FACT-WINDOW'],
    options: [
      { actionInstanceId: 'BASE:SCENE-03:mara:publish-response', stateEffects: [{ op: 'set', path: 'world.phase', value: 'settled' }] },
      { actionInstanceId: 'BASE:SCENE-03:orin:hold-with-reason', stateEffects: [{ op: 'set', path: 'world.phase', value: 'settled' }] }
    ]
  }])
  writeJsonl(path.join(packageDir, 'waiting-interactions.jsonl'), [{
    waitingId: 'WAIT-SCENE-02',
    visibleStateRefs: ['evidence.signalVerified'],
    availableWhileWaiting: [{ actionId: 'review' }, { actionId: 'ask-risk' }, { actionId: 'draft-condition' }],
    willUnlock: ['SCENE-03']
  }])
  writeJsonl(path.join(packageDir, 'agent-eval-cases.jsonl'), [{
    caseId: 'AGENT-CASE-01',
    requiredInformationUnits: ['FACT-MATCH'],
    fixtureAnswer: { visibleFact: 'FACT-MATCH', risk: 'Signal may still be stale.' },
    nextActionId: 'BASE:SCENE-01:orin:qualify-match'
  }])
  writeJson(path.join(packageDir, 'agent-eval-receipt.json'), { pass: true, passRate: 1 })
  writeJsonl(path.join(packageDir, 'carryover-contracts.jsonl'), [{ carryoverId: 'CARRY-TRUST', consequenceClass: 'TRUST_GAINED' }])

  const finalStates = {
    'ENDING-TRUSTED-RESCUE': { world: { phase: 'settled' }, evidence: { signalVerified: true }, relationship: { trust: 2 }, resources: { time: 1 }, choice: { shared: true } },
    'ENDING-QUALIFIED-RESCUE': { world: { phase: 'settled' }, evidence: { signalVerified: true }, relationship: { trust: 0 }, resources: { time: 1 }, choice: { shared: true } },
    'ENDING-HOLD': { world: { phase: 'settled' }, evidence: { signalVerified: false }, relationship: { trust: 1 }, resources: { time: 0 }, choice: { shared: false } }
  }
  const makeTrace = (runId, recipeId, endingCode, seat) => ({
    runId,
    recipeId,
    targetEndingCode: endingCode,
    actualEndingCode: endingCode,
    computedUtility: {
      truth: endingCode === 'ENDING-QUALIFIED-RESCUE' ? 3 : endingCode === 'ENDING-HOLD' ? 1 : 2,
      trust: endingCode === 'ENDING-TRUSTED-RESCUE' ? 2 : 1
    },
    steps: ['SCENE-01', 'SCENE-02', 'SCENE-03'].map((sceneId, index) => ({ step: index + 1, sceneId, seat, preconditionsPassed: true, costsPaid: true })),
    mergeReceipts: ['SCENE-01', 'SCENE-02', 'SCENE-03'].map(sceneId => ({ sceneId, requiredSeats: [seat], executedBySeat: { [seat]: true }, mergePassed: true })),
    finalWorldState: finalStates[endingCode]
  })
  writeJsonl(path.join(packageDir, 'playtest-traces.jsonl'), [
    makeTrace('RUN-OPEN-TRUSTED', 'RECIPE-OPEN', 'ENDING-TRUSTED-RESCUE', 'mara'),
    makeTrace('RUN-OPEN-QUALIFIED', 'RECIPE-OPEN', 'ENDING-QUALIFIED-RESCUE', 'mara'),
    makeTrace('RUN-CAUTIOUS-HOLD', 'RECIPE-CAUTIOUS', 'ENDING-HOLD', 'orin')
  ])
  writeJson(path.join(packageDir, 'playtest-simulation-receipt.json'), { pass: true, runs: 3 })
  writeJson(path.join(packageDir, 'settlement-test-receipt.json'), { pass: true, vectors: 3 })

  const manifestPath = path.join(packageDir, 'source-manifest.json')
  const manifest = readJson(manifestPath)
  manifest.lifecycle = 'release'
  manifest.auditProfile = { ...manifest.auditProfile, level: 'release', minimumRunsPerRecipe: 1, minimumCarryoverClasses: 1 }
  for (const [artifactId, artifactPath, format] of releaseArtifacts) manifest.artifactIndex.push({ artifactId, path: artifactPath, format, responsibility: 'release evidence fixture' })
  writeJson(manifestPath, manifest)
  const ledger = readJsonl(path.join(packageDir, 'review-ledger.jsonl'))
  const priorReviewReceipt = readJson(path.join(packageDir, 'review-receipt.json'))
  writeJson(path.join(packageDir, 'review-receipt.json'), buildReviewReceipt({ packageDir, manifest, ledger, updatedAt: priorReviewReceipt.updatedAt }))

  const qualityFiles = manifest.artifactIndex.map(item => item.path).filter(name => !['source-manifest.json', 'review-ledger.jsonl', 'review-receipt.json', 'compile-receipt.json', 'quality-receipt.json'].includes(name))
  writeJson(path.join(packageDir, 'quality-receipt.json'), {
    status: 'pass',
    blockers: [],
    artifactHashFiles: qualityFiles,
    artifactHash: artifactHash(packageDir, qualityFiles)
  })
}

try {
  const firstOutput = path.join(temporaryRoot, 'first')
  const secondOutput = path.join(temporaryRoot, 'second')
  const releaseOutput = path.join(temporaryRoot, 'release')
  const firstCompile = compileBundle({ inputPath: fixture, outputRoot: firstOutput })
  const secondCompile = compileBundle({ inputPath: fixture, outputRoot: secondOutput })
  const releaseCompile = compileBundle({ inputPath: fixture, outputRoot: releaseOutput })
  assert.equal(firstCompile.result, 'pass')
  assert.equal(secondCompile.result, 'pass')
  assert.equal(releaseCompile.result, 'pass')
  assert.equal(firstCompile.artifactHash, secondCompile.artifactHash, 'same input must compile to the same artifact hash')

  const firstHodorPath = path.join(temporaryRoot, 'first-hodor-target.json')
  const secondHodorPath = path.join(temporaryRoot, 'second-hodor-target.json')
  const firstHodor = buildHodorTarget({ root: firstOutput, projectId: 1785137013680, outputPath: firstHodorPath })
  const secondHodor = buildHodorTarget({ root: secondOutput, projectId: 1785137013680, outputPath: secondHodorPath })
  assert.equal(firstHodor.result, 'pass', JSON.stringify(firstHodor.diagnostics, null, 2))
  assert.equal(secondHodor.result, 'pass', JSON.stringify(secondHodor.diagnostics, null, 2))
  assert.equal(firstHodor.targetHash, secondHodor.targetHash, 'same Bran package must produce the same Hodor target hash')
  assert.deepEqual(firstHodor.counts, { variables: 5, nodes: 7, edges: 9, endings: 3 })
  assert.equal(firstHodor.target.entryNodeKey, 'scene:SCENE-01')
  assert.ok(firstHodor.target.variables.every(variable => !variable.name.includes('.')))
  assert.ok(firstHodor.target.nodes.every(node => node.script.content.length > 0))
  assert.ok(firstHodor.target.edges.every(edge => !(edge.condition ?? '').includes('derived.')))
  assert.equal(firstHodor.target.downstreamContract.tools.createNode, 'create_interactive_script_node')
  assert.equal(firstHodor.target.downstreamContract.tools.validate, 'validate_interactive_story_graph')
  const recipeHodor = buildHodorTarget({ root: firstOutput, projectId: 1785137013680, recipeId: 'RECIPE-OPEN' })
  assert.equal(recipeHodor.result, 'pass', JSON.stringify(recipeHodor.diagnostics, null, 2))
  assert.equal(recipeHodor.target.source.recipeId, 'RECIPE-OPEN')
  const missingRecipeHodor = buildHodorTarget({ root: firstOutput, projectId: 1785137013680, recipeId: 'RECIPE-MISSING' })
  assert.equal(missingRecipeHodor.result, 'fail')
  assert.ok(missingRecipeHodor.diagnostics.some(item => item.code === 'HODOR_RECIPE_NOT_FOUND'))

  const hodorReceiptPath = path.join(temporaryRoot, 'hodor-import-receipt.json')
  writeJson(hodorReceiptPath, createHodorReceiptFixture(firstHodor.target))
  const verifiedHodor = verifyHodorReceipt({ targetPath: firstHodorPath, receiptPath: hodorReceiptPath })
  assert.equal(verifiedHodor.result, 'pass', JSON.stringify(verifiedHodor.diagnostics, null, 2))
  const incompleteHodorReceipt = createHodorReceiptFixture(firstHodor.target)
  incompleteHodorReceipt.nodeBindings.pop()
  writeJson(hodorReceiptPath, incompleteHodorReceipt)
  const rejectedHodor = verifyHodorReceipt({ targetPath: firstHodorPath, receiptPath: hodorReceiptPath })
  assert.equal(rejectedHodor.result, 'fail')
  assert.ok(rejectedHodor.diagnostics.some(item => item.code === 'HODOR_RECEIPT_NODE_BINDINGS_INVALID'))

  const mockHodor = await startMockHodor()
  const appliedReceiptPath = path.join(temporaryRoot, 'applied-hodor-receipt.json')
  const candidateHodorPath = path.join(temporaryRoot, 'candidate-hodor-target.json')
  const candidateReceiptPath = path.join(temporaryRoot, 'candidate-hodor-receipt.json')
  try {
    const applied = await applyHodorTarget({
      targetPath: firstHodorPath,
      baseUrl: mockHodor.baseUrl,
      token: 'fixture-token',
      receiptPath: appliedReceiptPath
    })
    assert.equal(applied.result, 'pass', JSON.stringify(applied.diagnostics, null, 2))
    assert.equal(mockHodor.graph.variables.length, firstHodor.target.variables.length)
    assert.equal(mockHodor.graph.nodes.length, firstHodor.target.nodes.length)
    assert.equal(mockHodor.graph.edges.length, firstHodor.target.edges.length)
    assert.equal(mockHodor.graph.entryNodeId, 'node-1')
    assert.equal(mockHodor.graph.status, 'ready')
    assert.ok(mockHodor.requests.every(request => request.authorization === 'Bearer fixture-token'))
    const appliedReceipt = readJson(appliedReceiptPath)
    assert.equal(appliedReceipt.status, 'validated')
    assert.equal(appliedReceipt.validation.valid, true)
    const reapplied = await applyHodorTarget({
      targetPath: firstHodorPath,
      baseUrl: mockHodor.baseUrl,
      token: 'fixture-token',
      receiptPath: appliedReceiptPath
    })
    assert.equal(reapplied.result, 'pass')
    assert.equal(reapplied.resumed, true)

    const candidateHodor = makeCandidateHodorTarget(firstHodor.target)
    writeJson(candidateHodorPath, candidateHodor)
    const targetDiff = diffHodorTargets({
      baseTargetPath: firstHodorPath,
      targetPath: candidateHodorPath
    })
    assert.equal(targetDiff.result, 'pass', JSON.stringify(targetDiff.diagnostics, null, 2))
    assert.ok(targetDiff.total >= 8)
    assert.deepEqual(targetDiff.changes.nodes.added, ['scene:HIDDEN-INVESTIGATION'])
    assert.equal(targetDiff.changes.nodes.removed.length, 1)
    assert.equal(targetDiff.changes.graphChanged, true)

    const synced = await syncHodorTarget({
      baseTargetPath: firstHodorPath,
      targetPath: candidateHodorPath,
      baseReceiptPath: appliedReceiptPath,
      baseUrl: mockHodor.baseUrl,
      token: 'fixture-token',
      receiptPath: candidateReceiptPath
    })
    assert.equal(synced.result, 'pass', JSON.stringify(synced.diagnostics, null, 2))
    assert.equal(mockHodor.graph.variables.length, candidateHodor.variables.length)
    assert.equal(mockHodor.graph.nodes.length, candidateHodor.nodes.length)
    assert.equal(mockHodor.graph.edges.length, candidateHodor.edges.length)
    assert.equal(mockHodor.graph.title, candidateHodor.graph.title)
    assert.equal(mockHodor.graph.status, 'ready')
    assert.ok(mockHodor.graph.nodes.some(node => node.title === 'Hidden Investigation'))
    assert.ok(mockHodor.graph.edges.some(edge => edge.choiceText === 'Open the hidden investigation'))
    assert.ok(mockHodor.requests.some(request => request.path.endsWith('/nodes/update')))
    assert.ok(mockHodor.requests.some(request => request.path.endsWith('/nodes/delete')))
    assert.ok(mockHodor.requests.some(request => request.path.endsWith('/edges/update')))
    assert.ok(mockHodor.requests.some(request => request.path.endsWith('/edges/delete')))
    assert.ok(mockHodor.requests.some(request => request.path.endsWith('/variables')))
    const verifiedCandidate = verifyHodorReceipt({
      targetPath: candidateHodorPath,
      receiptPath: candidateReceiptPath
    })
    assert.equal(verifiedCandidate.result, 'pass', JSON.stringify(verifiedCandidate.diagnostics, null, 2))
    const resynced = await syncHodorTarget({
      baseTargetPath: firstHodorPath,
      targetPath: candidateHodorPath,
      baseReceiptPath: appliedReceiptPath,
      baseUrl: mockHodor.baseUrl,
      token: 'fixture-token',
      receiptPath: candidateReceiptPath
    })
    assert.equal(resynced.result, 'pass')
    assert.equal(resynced.resumed, true)
  } finally {
    await mockHodor.close()
  }

  const resumableMockHodor = await startMockHodor({ failOnceAtPath: '/edges' })
  const resumableReceiptPath = path.join(temporaryRoot, 'resumable-hodor-receipt.json')
  try {
    const interrupted = await applyHodorTarget({
      targetPath: firstHodorPath,
      baseUrl: resumableMockHodor.baseUrl,
      token: 'fixture-token',
      receiptPath: resumableReceiptPath
    })
    assert.equal(interrupted.result, 'fail')
    assert.equal(interrupted.partial, true)
    const applying = readJson(resumableReceiptPath)
    assert.equal(applying.status, 'applying')
    assert.equal(applying.nodeBindings.length, firstHodor.target.nodes.length)
    const resumed = await applyHodorTarget({
      targetPath: firstHodorPath,
      baseUrl: resumableMockHodor.baseUrl,
      token: 'fixture-token',
      receiptPath: resumableReceiptPath
    })
    assert.equal(resumed.result, 'pass', JSON.stringify(resumed.diagnostics, null, 2))
    assert.equal(resumed.resumed, true)
    assert.equal(resumableMockHodor.graph.nodes.length, firstHodor.target.nodes.length)
    assert.equal(resumableMockHodor.graph.edges.length, firstHodor.target.edges.length)
  } finally {
    await resumableMockHodor.close()
  }

  const audit = auditPackage({ root: firstOutput, level: 'compile' })
  assert.equal(audit.result, 'pass', JSON.stringify(audit.diagnostics, null, 2))
  assert.ok(audit.checks.every(check => typeof check.pass === 'boolean'))
  assert.ok(audit.checks.some(check => check.id === 'SETTLEMENT_VECTORS_RECOMPUTED' && check.pass))
  assert.ok(audit.checks.some(check => check.id === 'COMPILE_RECEIPT_FRESHNESS' && check.pass))
  assert.ok(audit.checks.some(check => check.id === 'NARRATIVE_GRAPH_REACHABILITY' && check.pass))
  assert.ok(audit.checks.some(check => check.id === 'ACTION_TARGETS_RECOMPUTED' && check.pass))
  assert.ok(audit.checks.some(check => check.id === 'STATE_TYPES_RECOMPUTED' && check.pass))

  const packageDir = path.join(firstOutput, 'package')
  const settlementDiagnostics = []
  const settlement = evaluateSettlement(
    { world: { phase: 'settled' }, evidence: { signalVerified: true }, relationship: { trust: 2 }, resources: { time: 1 }, choice: { shared: true } },
    readJson(path.join(packageDir, 'settlement-rules.json')),
    readJson(path.join(packageDir, 'state-field-registry.json')),
    settlementDiagnostics
  )
  assert.equal(settlement.endingCode, 'ENDING-TRUSTED-RESCUE')
  assert.deepEqual(settlementDiagnostics, [])

  const finalReview = acceptAllReviewStages(secondOutput)
  assert.equal(finalReview.lifecycle, 'reviewed')
  assert.equal(finalReview.reviewStatus, 'pass')
  const reviewedAudit = auditPackage({ root: secondOutput, level: 'compile' })
  assert.equal(reviewedAudit.result, 'pass', JSON.stringify(reviewedAudit.diagnostics, null, 2))
  assert.ok(reviewedAudit.checks.some(check => check.id === 'REVIEW_RECEIPT_COHERENT' && check.pass))
  const packageDiff = diffPackages({ baseRoot: firstOutput, candidateRoot: secondOutput })
  assert.deepEqual(packageDiff.totals, { added: 0, removed: 0, changed: 0 })
  assert.equal(packageDiff.candidate.lifecycle, 'reviewed')
  const productionRequestPath = path.join(secondOutput, 'package', 'production-request.json')
  const productionRequest = readJson(productionRequestPath)
  productionRequest.assetSlots[0].semanticPurpose = 'Tampered after review.'
  writeJson(productionRequestPath, productionRequest)
  const staleReviewAudit = auditPackage({ root: secondOutput, level: 'compile' })
  assert.equal(staleReviewAudit.result, 'fail')
  assert.ok(staleReviewAudit.diagnostics.some(item => item.code === 'REVIEW_RECEIPT_COHERENT'))

  acceptAllReviewStages(releaseOutput)
  prepareReleaseFixture(releaseOutput)
  const releaseAudit = auditPackage({ root: releaseOutput, level: 'release' })
  assert.equal(releaseAudit.result, 'pass', JSON.stringify(releaseAudit.diagnostics, null, 2))
  assert.ok(releaseAudit.checks.some(check => check.id === 'FULL_TRACES_RECOMPUTED' && check.pass))
  assert.ok(releaseAudit.checks.some(check => check.id === 'QUALITY_RECEIPT_FRESHNESS' && check.pass))

  const invalidInput = structuredClone(readJson(fixture))
  invalidInput.sourceEvents[1].causeEventIds = ['EV-DOES-NOT-EXIST']
  const inputDiagnostics = validateInput(invalidInput)
  assert.ok(inputDiagnostics.some(item => item.code === 'EVENT_CAUSE_UNRESOLVED' && item.severity === 'error'))

  const ambiguousBranchInput = structuredClone(readJson(fixture))
  ambiguousBranchInput.scenes[0].nextSceneIds.push('SCENE-03')
  const ambiguousBranchDiagnostics = validateInput(ambiguousBranchInput)
  assert.ok(ambiguousBranchDiagnostics.some(item => item.code === 'ACTION_TARGET_REQUIRED' && item.severity === 'error'))

  const unreachableSceneInput = structuredClone(readJson(fixture))
  unreachableSceneInput.project.entrySceneId = 'SCENE-02'
  const unreachableSceneDiagnostics = validateInput(unreachableSceneInput)
  assert.ok(unreachableSceneDiagnostics.some(item => item.code === 'SCENE_UNREACHABLE' && item.severity === 'error'))

  const invalidStateInput = structuredClone(readJson(fixture))
  invalidStateInput.stateModel.fields.find(field => field.path === 'relationship.trust').defaultValue = 'zero'
  invalidStateInput.scenes[0].actions[1].effectOps[0].value = 'one'
  const invalidStateDiagnostics = validateInput(invalidStateInput)
  assert.ok(invalidStateDiagnostics.some(item => item.code === 'STATE_FIELD_DEFAULT_INVALID' && item.severity === 'error'))
  assert.ok(invalidStateDiagnostics.some(item => item.code === 'ACTION_STATE_VALUE_INVALID' && item.severity === 'error'))

  const tamperedVectors = path.join(packageDir, 'settlement-test-vectors.jsonl')
  const vectors = fs.readFileSync(tamperedVectors, 'utf8').trim().split('\n').map(JSON.parse)
  vectors[0].expectedEndingCode = 'ENDING-HOLD'
  fs.writeFileSync(tamperedVectors, `${vectors.map(row => JSON.stringify(row)).join('\n')}\n`)
  const tamperedAudit = auditPackage({ root: firstOutput, level: 'compile' })
  assert.equal(tamperedAudit.result, 'fail')
  assert.ok(tamperedAudit.diagnostics.some(item => item.code === 'SETTLEMENT_VECTORS_RECOMPUTED'))
  assert.ok(tamperedAudit.diagnostics.some(item => item.code === 'COMPILE_RECEIPT_FRESHNESS'))

  const auditorSource = fs.readFileSync(path.join(root, 'plugins/bran/skills/bran/scripts/lib/auditor.mjs'), 'utf8')
  for (const projectSpecificToken of ['Delilah', 'Cheng', 'Archie', "'W01'", "'S00'"]) {
    assert.equal(auditorSource.includes(projectSpecificToken), false, `generic auditor contains project-specific token ${projectSpecificToken}`)
  }

  const schemaDirectory = path.join(root, 'plugins/bran/skills/bran/schemas')
  for (const name of fs.readdirSync(schemaDirectory).filter(name => name.endsWith('.json'))) readJson(path.join(schemaDirectory, name))

  console.log(JSON.stringify({ result: 'pass', tests: 89, fixture, artifactHash: firstCompile.artifactHash, hodorTargetHash: firstHodor.targetHash }, null, 2))
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
