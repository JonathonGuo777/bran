import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditRewriteWorkspace,
  buildCleanRoomBrief,
  extractSource,
  generateRewrite,
  ingestSource,
  sealStoryDna,
  validateRewriteDraft,
  workspaceStatus
} from '../plugins/bran/skills/bran-rewrite/scripts/lib/pipeline.mjs'
import {
  readJson,
  sha256,
  workspacePaths,
  writeJson
} from '../plugins/bran/skills/bran-rewrite/scripts/lib/common.mjs'
import {
  importLangExtract,
  importScriptBreak,
  readSourceText,
  textFromDocxXml
} from '../plugins/bran/skills/bran-rewrite/scripts/lib/source.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, 'plugins/bran/skills/bran-rewrite/fixtures/clean-room-demo')
const sourceFixture = path.join(fixtureRoot, 'source.fountain')
const dnaFixture = path.join(fixtureRoot, 'story-dna.json')
const draftFixture = path.join(fixtureRoot, 'rewrite-draft.json')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bran-rewrite-test-'))

const makeSpan = (text, quote) => {
  const start = text.indexOf(quote)
  assert.ok(start >= 0, `fixture quote must exist: ${quote}`)
  return { start, end: start + quote.length, quoteHash: sha256(quote) }
}

const buildExtraction = paths => {
  const sourceText = fs.readFileSync(paths.source, 'utf8').trimEnd()
  const sourceRecord = readJson(paths.sourceRecord)
  const structural = readJson(paths.structuralExtraction)
  const nameToId = new Map(structural.characters.map(item => [item.displayName, item.characterId]))
  const mira = nameToId.get('MIRA VOSS')
  const elias = nameToId.get('ELIAS RUNE')
  const nora = nameToId.get('NORA VALE')
  assert.ok(mira && elias && nora, 'structural extraction should find screenplay character cues')
  return {
    schemaVersion: '1.0.0',
    sourceId: sourceRecord.sourceId,
    sourceHash: sourceRecord.contentHash,
    adapters: ['bran-native', 'fixture-semantic'],
    scenes: structural.scenes.map(item => ({ ...item, status: 'accepted' })),
    characters: structural.characters.map(item => ({
      ...item,
      aliases: [],
      role: item.characterId === mira ? 'protagonist' : item.characterId === elias ? 'antagonist' : 'witness',
      confidence: 1,
      status: 'accepted'
    })),
    relationships: [
      {
        relationshipId: 'SRC-REL-001',
        fromCharacterId: mira,
        toCharacterId: elias,
        type: 'professional intimacy under coercive leverage',
        state: 'trust becomes conditional',
        evidenceSpans: [makeSpan(sourceText, 'Elias offers her the blue room studio if she withdraws the accusation.')],
        confidence: 1,
        status: 'accepted'
      },
      {
        relationshipId: 'SRC-REL-002',
        fromCharacterId: mira,
        toCharacterId: nora,
        type: 'witness alliance',
        state: 'private doubt becomes a public strategy',
        evidenceSpans: [makeSpan(sourceText, 'Then make them defend the lie in public.')],
        confidence: 1,
        status: 'accepted'
      }
    ],
    events: structural.events.map((item, index) => ({
      ...item,
      participants: index === 0 ? [mira, elias] : index === 1 ? [mira, elias, nora] : [mira, elias],
      action: [
        'The protagonist discovers physical evidence that an institutional record was altered.',
        'She verifies the record while an intimate rival offers a private settlement.',
        'She uses the proof in public and redirects the recovered resource toward a community.'
      ][index],
      result: [
        'The official account becomes contestable.',
        'Silence gains an emotionally credible price.',
        'Authority and the meaning of legacy change.'
      ][index],
      confidence: 1,
      status: 'accepted'
    })),
    emotionNodes: [
      {
        emotionNodeId: 'SRC-EMOTION-001',
        emotion: 'betrayal',
        subjectCharacterId: mira,
        intensity: 4,
        triggerEventId: structural.events[1].eventId,
        payoffFunction: 'private safety is revealed as a demand for silence',
        evidenceSpans: [makeSpan(sourceText, 'Elias offers her the blue room studio if she withdraws the accusation.')],
        confidence: 1,
        status: 'accepted'
      },
      {
        emotionNodeId: 'SRC-EMOTION-002',
        emotion: 'recognition',
        subjectCharacterId: mira,
        intensity: 5,
        triggerEventId: structural.events[2].eventId,
        payoffFunction: 'private loss becomes public value',
        evidenceSpans: [makeSpan(sourceText, 'She rejects private ownership of the studio and converts it into a public workshop for young artists.')],
        confidence: 1,
        status: 'accepted'
      }
    ],
    distinctiveExpressions: [
      {
        expressionId: 'SRC-EXPR-001',
        text: 'silver moth seal',
        evidenceSpans: [makeSpan(sourceText, 'silver moth seal')],
        status: 'accepted'
      }
    ],
    dialogue: structural.dialogue,
    unresolved: []
  }
}

const prepareWorkspace = ({ name, rightsStatus = 'owned' }) => {
  const workspace = path.join(temporaryRoot, name)
  const ingest = ingestSource({
    sourcePath: sourceFixture,
    outputRoot: workspace,
    rightsStatus,
    rightsBasis: rightsStatus === 'owned' ? 'Original internal fixture written for Bran tests.' : 'Unlicensed comparison for internal research only.',
    title: 'The Glass Catalogue',
    language: 'en'
  })
  assert.equal(ingest.result, 'pass')
  const paths = workspacePaths(workspace)
  const extractionPath = path.join(temporaryRoot, `${name}-extraction.json`)
  writeJson(extractionPath, buildExtraction(paths))
  const extraction = extractSource({ workspace, inputPath: extractionPath })
  assert.equal(extraction.result, 'pass', JSON.stringify(extraction.diagnostics, null, 2))
  const dna = sealStoryDna({ workspace, inputPath: dnaFixture })
  assert.equal(dna.result, 'pass', JSON.stringify(dna.diagnostics, null, 2))
  return { workspace, paths }
}

try {
  const docxText = textFromDocxXml(`<?xml version="1.0"?>
    <w:document><w:body>
      <w:p><w:r><w:t>INT. TEST ROOM - DAY</w:t></w:r></w:p>
      <w:p><w:r><w:t>ADA</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>The branch is grounded.</w:t></w:r></w:p>
    </w:body></w:document>`)
  assert.equal(docxText, 'INT. TEST ROOM - DAY\nADA\tThe branch is grounded.')
  const pastedSource = readSourceText({ text: '# Pasted source\r\n\r\nA choice appears.', format: 'markdown', name: 'pasted' })
  assert.equal(pastedSource.format, 'markdown')
  assert.equal(pastedSource.absolutePath, 'stdin:pasted')
  assert.equal(pastedSource.text, '# Pasted source\n\nA choice appears.')
  const pastedWorkspace = path.join(temporaryRoot, 'pasted')
  const pastedIngest = ingestSource({
    sourceText: 'INT. TEST ROOM - DAY\nADA:\nThe branch is grounded.',
    sourceFormat: 'text',
    sourceName: 'pasted-e2e',
    outputRoot: pastedWorkspace,
    rightsStatus: 'owned',
    rightsBasis: 'Original pasted fixture.',
    title: 'Pasted fixture',
    language: 'en'
  })
  assert.equal(pastedIngest.result, 'pass')
  assert.equal(readJson(workspacePaths(pastedWorkspace).sourceRecord).originalPath, 'stdin:pasted-e2e')

  const { workspace, paths } = prepareWorkspace({ name: 'allowed' })
  const sourceTextForAdapters = fs.readFileSync(paths.source, 'utf8').trimEnd()
  const langExtractPath = path.join(temporaryRoot, 'langextract.jsonl')
  fs.writeFileSync(langExtractPath, `${JSON.stringify({
    document_id: 'fixture',
    extractions: [{
      extraction_class: 'emotion',
      extraction_text: 'Then make them defend the lie in public.',
      attributes: { emotion: 'defiance' }
    }]
  })}\n`)
  const langExtractRecords = importLangExtract({ filePath: langExtractPath, sourceText: sourceTextForAdapters })
  assert.equal(langExtractRecords.length, 1)
  assert.equal(langExtractRecords[0].status, 'provisional')
  assert.equal(langExtractRecords[0].evidenceSpans[0].quoteHash, sha256('Then make them defend the lie in public.'))

  const scriptBreakPath = path.join(temporaryRoot, 'scriptbreak.json')
  writeJson(scriptBreakPath, {
    scenes: [{
      id: 'SB-001',
      heading: 'INT. CITY ARCHIVE - MORNING',
      text: 'INT. CITY ARCHIVE - MORNING',
      characters: ['MIRA VOSS', 'NORA VALE']
    }]
  })
  const scriptBreakScenes = importScriptBreak({ filePath: scriptBreakPath, sourceText: sourceTextForAdapters })
  assert.equal(scriptBreakScenes.length, 1)
  assert.equal(scriptBreakScenes[0].status, 'provisional')

  const adapterWorkspace = path.join(temporaryRoot, 'adapters')
  const adapterIngest = ingestSource({
    sourcePath: sourceFixture,
    outputRoot: adapterWorkspace,
    rightsStatus: 'owned',
    rightsBasis: 'Original adapter fixture.',
    title: 'Adapter fixture',
    language: 'en'
  })
  assert.equal(adapterIngest.result, 'pass')
  const adapterExtraction = extractSource({
    workspace: adapterWorkspace,
    scriptBreakPath,
    langExtractPath
  })
  assert.equal(adapterExtraction.result, 'pass', JSON.stringify(adapterExtraction.diagnostics, null, 2))
  assert.ok(adapterExtraction.adapters.includes('scriptbreak'))
  assert.ok(adapterExtraction.adapters.includes('langextract'))
  assert.equal(adapterExtraction.counts.emotionNodes, 1)

  const fdxPath = path.join(temporaryRoot, 'fixture.fdx')
  fs.writeFileSync(fdxPath, `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft><Content>
<Paragraph Type="Scene Heading"><Text>INT. TEST LAB - DAY</Text></Paragraph>
<Paragraph Type="Character"><Text>ADA</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>The result is reproducible.</Text></Paragraph>
</Content></FinalDraft>`)
  const fdxWorkspace = path.join(temporaryRoot, 'fdx')
  const fdxIngest = ingestSource({
    sourcePath: fdxPath,
    outputRoot: fdxWorkspace,
    rightsStatus: 'owned',
    rightsBasis: 'Original FDX parser fixture.',
    title: 'FDX fixture',
    language: 'en'
  })
  assert.equal(fdxIngest.result, 'pass')
  assert.equal(fdxIngest.structuralCandidates.scenes, 1)
  assert.equal(fdxIngest.structuralCandidates.characters, 1)

  const briefResult = buildCleanRoomBrief({ workspace })
  assert.equal(briefResult.result, 'pass', JSON.stringify(briefResult.diagnostics, null, 2))
  const briefText = fs.readFileSync(paths.brief, 'utf8')
  for (const forbidden of ['The Glass Catalogue', 'MIRA VOSS', 'ELIAS RUNE', 'NORA VALE', 'silver moth seal']) assert.equal(briefText.includes(forbidden), false)
  const cleanReceipt = readJson(paths.cleanRoomReceipt)
  assert.deepEqual(cleanReceipt.writerVisibleFiles, ['writer/clean-room-brief.json'])
  assert.equal(cleanReceipt.legalConclusion, 'not-provided')

  const generated = generateRewrite({ workspace, draftPath: draftFixture })
  assert.equal(generated.result, 'pass', JSON.stringify(generated.diagnostics, null, 2))
  assert.equal(generated.stage, 'awaiting-taste-review')
  assert.ok(fs.existsSync(paths.branInput))
  assert.ok(fs.existsSync(path.join(paths.branHandoff, 'package', 'compile-receipt.json')))
  assert.ok(fs.existsSync(paths.hodorTarget))
  const hodorTarget = readJson(paths.hodorTarget)
  assert.equal(hodorTarget.project.projectId, 1785137013680)
  assert.equal(hodorTarget.source.recipeId, 'baseline')
  assert.equal(hodorTarget.variables.length, 4)
  assert.equal(hodorTarget.nodes.length, 9)
  assert.equal(hodorTarget.edges.length, 13)
  assert.equal(hodorTarget.nodes.filter(node => node.kind === 'ending').length, 3)
  assert.ok(hodorTarget.nodes.every(node => node.script.content.length > 0))
  const tasteHandoff = readJson(paths.tasteHandoff)
  assert.equal(tasteHandoff.status, 'awaiting-taste-review')
  assert.equal(tasteHandoff.machineStatus, 'pass')
  assert.equal(tasteHandoff.legalConclusion, 'not-provided')
  assert.equal(tasteHandoff.artifacts.hodorTarget.path, 'handoff/hodor-interactive-story-target.json')

  const audit = auditRewriteWorkspace({ workspace, writeReceipt: true })
  assert.equal(audit.result, 'pass', JSON.stringify(audit.blockers, null, 2))
  assert.equal(audit.checks.branCompileAudit, true)
  assert.equal(audit.checks.cleanRoomLeakCheck, true)
  const status = workspaceStatus(workspace)
  assert.equal(status.currentStage, 'awaiting-taste-review')
  assert.deepEqual(status.hashDiagnostics, [])

  const restricted = prepareWorkspace({ name: 'restricted', rightsStatus: 'internal-research' })
  const blockedBrief = buildCleanRoomBrief({ workspace: restricted.workspace })
  assert.equal(blockedBrief.result, 'fail')
  assert.ok(blockedBrief.diagnostics.some(item => item.code === 'RIGHTS_GENERATION_BLOCKED'))
  assert.equal(fs.existsSync(restricted.paths.brief), false)

  const contaminatedDraft = structuredClone(readJson(draftFixture))
  contaminatedDraft.characters[0].displayName = 'MIRA VOSS'
  const contaminatedDiagnostics = validateRewriteDraft({
    draft: contaminatedDraft,
    brief: readJson(paths.brief),
    baseline: readJson(paths.originalityBaseline),
    sourceText: fs.readFileSync(paths.source, 'utf8').trimEnd()
  })
  assert.ok(contaminatedDiagnostics.some(item => item.code === 'SOURCE_SPECIFIC_TERM_LEAK' && item.severity === 'error'))

  const incompleteDesign = structuredClone(readJson(draftFixture))
  incompleteDesign.originality.designChanges = incompleteDesign.originality.designChanges.slice(0, 4)
  const designDiagnostics = validateRewriteDraft({
    draft: incompleteDesign,
    brief: readJson(paths.brief),
    baseline: readJson(paths.originalityBaseline),
    sourceText: fs.readFileSync(paths.source, 'utf8').trimEnd()
  })
  assert.ok(designDiagnostics.some(item => item.code === 'DRAFT_INDEPENDENT_DESIGN_INCOMPLETE' && item.severity === 'error'))

  const branInput = readJson(paths.branInput)
  assert.equal(branInput.review.status, 'draft')
  assert.equal(branInput.sources[0].rights, 'original-clean-room-output:owned')
  assert.equal(branInput.productionHandoff.assetSlots.length, 0)
  assert.equal(branInput.project.runtimeTarget, 'hodor-interactive')
  assert.equal(branInput.project.entrySceneId, 'SCENE-001')
  assert.equal(branInput.scenes.flatMap(scene => scene.actions).length, 10)
  assert.equal(branInput.settlement.rules.length, 3)
  assert.equal(readJson(path.join(paths.branHandoff, 'package', 'source-manifest.json')).lifecycle, 'compiled')

  const incompleteInteractiveDraft = structuredClone(readJson(draftFixture))
  incompleteInteractiveDraft.interactiveDesign.choices = incompleteInteractiveDraft.interactiveDesign.choices.filter(choice => choice.sceneId !== 'SCENE-004')
  const incompleteInteractiveDiagnostics = validateRewriteDraft({
    draft: incompleteInteractiveDraft,
    brief: readJson(paths.brief),
    baseline: readJson(paths.originalityBaseline),
    sourceText: fs.readFileSync(paths.source, 'utf8').trimEnd()
  })
  assert.ok(incompleteInteractiveDiagnostics.some(item => item.code === 'DRAFT_INTERACTIVE_SCENE_CHOICES_MISSING' && item.severity === 'error'))

  console.log(JSON.stringify({
    result: 'pass',
    tests: 55,
    fixture: fixtureRoot,
    stage: tasteHandoff.status,
    branArtifactHash: generated.artifactHash,
    hodorTargetHash: hodorTarget.targetHash
  }, null, 2))
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
