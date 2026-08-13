import fs from 'node:fs'
import path from 'node:path'
import {
  createDiagnostic,
  duplicates,
  ensureDirectory,
  hasErrors,
  readJson,
  relativeArtifact,
  requireFile,
  sha256,
  stringsIn,
  unique,
  updateManifest,
  workspacePaths,
  writeJson,
  writeText
} from './common.mjs'
import {
  buildStructuralExtraction,
  importLangExtract,
  importScriptBreak,
  mergeExtraction,
  readSourceFile,
  readSourceText,
  sourceSpecificTerms,
  structuralProjectId,
  validateEvidenceLedger
} from './source.mjs'
import { auditPackage } from '../../../bran/scripts/lib/auditor.mjs'
import { compileBundle, validateInput } from '../../../bran/scripts/lib/compiler.mjs'
import { buildHodorTarget } from '../../../bran/scripts/lib/hodor.mjs'

const RIGHTS = new Set(['owned', 'licensed', 'public-domain', 'internal-research', 'unknown'])
const GENERATION_RIGHTS = new Set(['owned', 'licensed', 'public-domain'])
const REDESIGN_CATEGORIES = new Set([
  'character-system',
  'relationship-topology',
  'world',
  'causal-chain',
  'key-events',
  'reversals',
  'climax',
  'ending',
  'dialogue'
])

const requiredString = (value, code, pathName, diagnostics) => {
  if (typeof value !== 'string' || !value.trim()) diagnostics.push(createDiagnostic(code, 'error', `${pathName} must be a non-empty string.`, { path: pathName }))
}

const requiredArray = (value, minimum, code, pathName, diagnostics) => {
  if (!Array.isArray(value) || value.length < minimum) diagnostics.push(createDiagnostic(code, 'error', `${pathName} needs at least ${minimum} record(s).`, { path: pathName }))
}

const sourceLeakDiagnostics = ({ value, terms, sourceText, pathName }) => {
  const diagnostics = []
  const candidateText = stringsIn(value).join('\n')
  const foldedCandidate = candidateText.toLocaleLowerCase()
  const leakedTerms = terms.filter(term => term.length >= 2 && foldedCandidate.includes(term.toLocaleLowerCase()))
  if (leakedTerms.length) {
    diagnostics.push(createDiagnostic('SOURCE_SPECIFIC_TERM_LEAK', 'error', `${pathName} contains source-specific names or distinctive expressions.`, {
      path: pathName,
      evidence: leakedTerms.slice(0, 20)
    }))
  }
  const phraseOverlaps = exactPhraseOverlaps(sourceText, candidateText)
  if (phraseOverlaps.blocking.length) {
    diagnostics.push(createDiagnostic('LONG_EXACT_SOURCE_PHRASE', 'error', `${pathName} contains long exact source phrases.`, {
      path: pathName,
      evidence: phraseOverlaps.blocking.slice(0, 10)
    }))
  }
  if (phraseOverlaps.warning.length) {
    diagnostics.push(createDiagnostic('SOURCE_PHRASE_OVERLAP_WARNING', 'warning', `${pathName} contains medium exact phrase overlap that needs human review.`, {
      path: pathName,
      evidence: phraseOverlaps.warning.slice(0, 10)
    }))
  }
  return diagnostics
}

const wordTokens = value => String(value ?? '').toLocaleLowerCase().match(/[\p{Letter}\p{Number}’'-]+/gu) ?? []
const cjkText = value => (String(value ?? '').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).join('')
const ngrams = (tokens, size) => {
  const values = []
  for (let index = 0; index <= tokens.length - size; index += 1) values.push(tokens.slice(index, index + size).join(' '))
  return values
}

export const exactPhraseOverlaps = (sourceText, candidateText) => {
  const sourceWords = wordTokens(sourceText)
  const candidateWords = wordTokens(candidateText)
  const sourceBlocking = new Set(ngrams(sourceWords, 8))
  const sourceWarning = new Set(ngrams(sourceWords, 6))
  const blocking = unique(ngrams(candidateWords, 8).filter(value => sourceBlocking.has(value)))
  const warning = unique(ngrams(candidateWords, 6).filter(value => sourceWarning.has(value)))

  const sourceCjk = cjkText(sourceText)
  const candidateCjk = cjkText(candidateText)
  const cjkBlocking = new Set(ngrams([...sourceCjk], 18).map(value => value.replaceAll(' ', '')))
  const cjkWarning = new Set(ngrams([...sourceCjk], 14).map(value => value.replaceAll(' ', '')))
  blocking.push(...unique(ngrams([...candidateCjk], 18).map(value => value.replaceAll(' ', '')).filter(value => cjkBlocking.has(value))))
  warning.push(...unique(ngrams([...candidateCjk], 14).map(value => value.replaceAll(' ', '')).filter(value => cjkWarning.has(value))))
  return { blocking: unique(blocking), warning: unique(warning) }
}

const rightsDiagnostics = sourceRecord => {
  const diagnostics = []
  const rights = sourceRecord.rights ?? {}
  if (!GENERATION_RIGHTS.has(rights.status)) {
    diagnostics.push(createDiagnostic('RIGHTS_GENERATION_BLOCKED', 'error', `Rights status ${rights.status ?? 'missing'} permits analysis only.`))
  }
  requiredString(rights.basis, 'RIGHTS_BASIS_MISSING', 'rights.basis', diagnostics)
  if (rights.status === 'public-domain') {
    requiredString(rights.jurisdiction, 'PUBLIC_DOMAIN_JURISDICTION_MISSING', 'rights.jurisdiction', diagnostics)
    requiredString(rights.verificationNote, 'PUBLIC_DOMAIN_VERIFICATION_MISSING', 'rights.verificationNote', diagnostics)
  }
  return diagnostics
}

const manifestHashDiagnostics = paths => {
  const diagnostics = []
  if (!fs.existsSync(paths.manifest)) return [createDiagnostic('REWRITE_MANIFEST_MISSING', 'error', 'rewrite-manifest.json is missing.')]
  const manifest = readJson(paths.manifest)
  for (const [name, artifact] of Object.entries(manifest.artifacts ?? {})) {
    const filePath = path.join(paths.workspace, artifact.path)
    if (!fs.existsSync(filePath)) {
      diagnostics.push(createDiagnostic('STAGE_ARTIFACT_MISSING', 'error', `Recorded artifact ${name} is missing.`, { path: artifact.path }))
      continue
    }
    const currentHash = sha256(fs.readFileSync(filePath))
    if (currentHash !== artifact.hash) diagnostics.push(createDiagnostic('STAGE_ARTIFACT_STALE', 'error', `Recorded artifact ${name} changed after its stage was sealed.`, { path: artifact.path }))
  }
  return diagnostics
}

const validateInteractiveDesign = ({ draft, sceneIdSet, characterIdSet }) => {
  const design = draft.interactiveDesign
  if (!design) return []
  const diagnostics = []
  if (!sceneIdSet.has(design.entrySceneId)) {
    diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_ENTRY_UNRESOLVED', 'error', `Interactive entry scene ${design.entrySceneId ?? '<missing>'} does not exist.`))
  }
  requiredArray(design.stateModel?.fields, 3, 'DRAFT_INTERACTIVE_STATE_EMPTY', 'interactiveDesign.stateModel.fields', diagnostics)
  requiredArray(design.choices, 1, 'DRAFT_INTERACTIVE_CHOICES_EMPTY', 'interactiveDesign.choices', diagnostics)
  requiredArray(design.settlement?.rules, 2, 'DRAFT_INTERACTIVE_ENDINGS_INSUFFICIENT', 'interactiveDesign.settlement.rules', diagnostics)
  requiredArray(design.settlement?.testVectors, 2, 'DRAFT_INTERACTIVE_VECTORS_INSUFFICIENT', 'interactiveDesign.settlement.testVectors', diagnostics)

  const fieldPaths = (design.stateModel?.fields ?? []).map(item => item.path)
  const choiceIds = (design.choices ?? []).map(item => item.actionId)
  const endingCodes = (design.settlement?.rules ?? []).map(item => item.endingCode)
  for (const [label, values] of [['state path', fieldPaths], ['choice', choiceIds], ['ending', endingCodes]]) {
    const repeated = duplicates(values.filter(Boolean))
    if (repeated.length) diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_ID_DUPLICATE', 'error', `Interactive design contains duplicate ${label} IDs.`, { evidence: repeated }))
  }

  const choicesByScene = new Map()
  for (const [index, choice] of (design.choices ?? []).entries()) {
    if (!sceneIdSet.has(choice.sceneId)) diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_CHOICE_SCENE_UNRESOLVED', 'error', `Choice ${choice.actionId ?? index} references unknown scene ${choice.sceneId}.`))
    if (choice.targetSceneId && !sceneIdSet.has(choice.targetSceneId)) diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_CHOICE_TARGET_UNRESOLVED', 'error', `Choice ${choice.actionId ?? index} targets unknown scene ${choice.targetSceneId}.`))
    if (!characterIdSet.has(choice.seat)) diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_CHOICE_SEAT_UNRESOLVED', 'error', `Choice ${choice.actionId ?? index} references unknown seat ${choice.seat}.`))
    for (const field of ['actionId', 'sceneId', 'seat', 'label', 'decisionCueId', 'publicEcho']) {
      requiredString(choice[field], 'DRAFT_INTERACTIVE_CHOICE_INCOMPLETE', `interactiveDesign.choices[${index}].${field}`, diagnostics)
    }
    requiredArray(choice.effectOps, 1, 'DRAFT_INTERACTIVE_CHOICE_EFFECTS_EMPTY', `interactiveDesign.choices[${index}].effectOps`, diagnostics)
    const existing = choicesByScene.get(choice.sceneId) ?? []
    existing.push(choice)
    choicesByScene.set(choice.sceneId, existing)
  }
  const scenesWithoutChoices = [...sceneIdSet].filter(sceneId => !(choicesByScene.get(sceneId) ?? []).length)
  if (scenesWithoutChoices.length) diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_SCENE_CHOICES_MISSING', 'error', 'Every interactive scene needs at least one typed player choice.', { evidence: scenesWithoutChoices }))
  const overcrowdedChoices = [...choicesByScene.entries()].filter(([, choices]) => choices.length > 3).map(([sceneId, choices]) => ({ sceneId, choices: choices.length }))
  if (overcrowdedChoices.length) diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_CHOICE_COUNT_INVALID', 'error', 'A Hodor branch scene may expose at most three player choices.', { evidence: overcrowdedChoices }))
  if (![...choicesByScene.values()].some(choices => choices.length >= 2)) {
    diagnostics.push(createDiagnostic('DRAFT_INTERACTIVE_BRANCH_MISSING', 'error', 'Interactive design needs at least one scene with two or more player choices.'))
  }
  return diagnostics
}

export const ingestSource = ({
  sourcePath,
  sourceText,
  sourceFormat = 'text',
  sourceName = 'pasted-source',
  outputRoot,
  rightsStatus,
  rightsBasis,
  title,
  language = 'en',
  sourceId = 'SRC-001',
  jurisdiction = '',
  verificationNote = '',
  evidenceRef = ''
}) => {
  if (!RIGHTS.has(rightsStatus)) throw new Error(`Unknown rights status ${rightsStatus}.`)
  if (!rightsBasis?.trim()) throw new Error('ingest needs --rights-basis with a traceable rights statement.')
  const paths = workspacePaths(outputRoot)
  if (fs.existsSync(paths.workspace) && fs.readdirSync(paths.workspace).length) {
    throw new Error(`Rewrite workspace must be absent or empty: ${paths.workspace}`)
  }
  const source = sourceText === undefined
    ? readSourceFile(sourcePath)
    : readSourceText({ text: sourceText, format: sourceFormat, name: sourceName })
  ensureDirectory(paths.analyst)
  ensureDirectory(paths.writer)
  ensureDirectory(paths.handoff)
  ensureDirectory(paths.receipts)
  writeText(paths.source, `${source.text}\n`)
  const normalizedSource = fs.readFileSync(paths.source, 'utf8').trimEnd()
  const sourceRecord = {
    schemaVersion: '1.0.0',
    sourceId,
    title: title?.trim() || path.basename(source.absolutePath, path.extname(source.absolutePath)),
    format: source.format,
    language,
    originalPath: source.absolutePath,
    normalizedPath: 'analyst/source.txt',
    contentHash: sha256(normalizedSource),
    rights: {
      status: rightsStatus,
      basis: rightsBasis.trim(),
      ...(jurisdiction ? { jurisdiction } : {}),
      ...(verificationNote ? { verificationNote } : {}),
      ...(evidenceRef ? { evidenceRef } : {})
    }
  }
  writeJson(paths.sourceRecord, sourceRecord)
  const structural = buildStructuralExtraction({ text: normalizedSource, sourceId, sourceHash: sourceRecord.contentHash })
  writeJson(paths.structuralExtraction, structural)
  writeJson(paths.manifest, {
    schemaVersion: '1.0.0',
    projectId: structuralProjectId(sourceRecord.title),
    title: sourceRecord.title,
    currentStage: 'initializing',
    accessBoundary: {
      analyst: 'source-visible',
      writer: 'clean-room-only',
      handoff: 'reviewable-output'
    },
    stages: {},
    artifacts: {}
  })
  updateManifest(paths, 'ingested', {
    source: paths.source,
    sourceRecord: paths.sourceRecord,
    structuralExtraction: paths.structuralExtraction
  })
  return {
    result: 'pass',
    workspace: paths.workspace,
    stage: 'ingested',
    rightsStatus,
    sourceHash: sourceRecord.contentHash,
    structuralCandidates: {
      scenes: structural.scenes.length,
      characters: structural.characters.length,
      dialogue: structural.dialogue.length
    }
  }
}

export const extractSource = ({
  workspace,
  inputPath,
  scriptBreakPath,
  langExtractPath
}) => {
  const paths = workspacePaths(workspace)
  const sourceText = fs.readFileSync(requireFile(paths.source, 'normalized source'), 'utf8').trimEnd()
  const sourceRecord = readJson(requireFile(paths.sourceRecord, 'source record'))
  const structural = readJson(requireFile(paths.structuralExtraction, 'structural extraction'))
  const native = inputPath ? readJson(path.resolve(inputPath)) : null
  const scriptBreakScenes = scriptBreakPath ? importScriptBreak({ filePath: path.resolve(scriptBreakPath), sourceText }) : []
  const langExtractRecords = langExtractPath ? importLangExtract({ filePath: path.resolve(langExtractPath), sourceText }) : []
  const ledger = mergeExtraction({ structural, native, scriptBreakScenes, langExtractRecords })
  const diagnostics = validateEvidenceLedger({ ledger, sourceText, sourceRecord })
  if (hasErrors(diagnostics)) return { result: 'fail', stage: 'extraction', diagnostics }
  if (!(ledger.characters ?? []).length) diagnostics.push(createDiagnostic('EXTRACTION_CHARACTERS_EMPTY', 'warning', 'No characters were extracted. Semantic enrichment is still required.'))
  if (!(ledger.relationships ?? []).length) diagnostics.push(createDiagnostic('EXTRACTION_RELATIONSHIPS_EMPTY', 'warning', 'No relationships were extracted.'))
  if (!(ledger.emotionNodes ?? []).length) diagnostics.push(createDiagnostic('EXTRACTION_EMOTIONS_EMPTY', 'warning', 'No emotion nodes were extracted.'))
  writeJson(paths.extraction, ledger)
  updateManifest(paths, 'extracted', { extraction: paths.extraction })
  return {
    result: 'pass',
    stage: 'extracted',
    adapters: ledger.adapters,
    counts: {
      scenes: ledger.scenes.length,
      characters: ledger.characters.length,
      relationships: ledger.relationships.length,
      events: ledger.events.length,
      emotionNodes: ledger.emotionNodes.length
    },
    diagnostics
  }
}

export const validateStoryDna = ({ dna, extraction, sourceText }) => {
  const diagnostics = []
  if (dna.schemaVersion !== '1.0.0') diagnostics.push(createDiagnostic('DNA_SCHEMA_VERSION_UNSUPPORTED', 'error', 'Story DNA schemaVersion must be 1.0.0.'))
  requiredString(dna.dnaId, 'DNA_ID_MISSING', 'dnaId', diagnostics)
  requiredString(dna.targetAudience, 'DNA_TARGET_AUDIENCE_MISSING', 'targetAudience', diagnostics)
  requiredString(dna.audiencePromise, 'DNA_AUDIENCE_PROMISE_MISSING', 'audiencePromise', diagnostics)
  requiredArray(dna.genreEnvelope, 1, 'DNA_GENRE_EMPTY', 'genreEnvelope', diagnostics)
  requiredArray(dna.emotionalRewards, 1, 'DNA_EMOTIONAL_REWARDS_EMPTY', 'emotionalRewards', diagnostics)
  requiredArray(dna.characterFunctions, 1, 'DNA_CHARACTER_FUNCTIONS_EMPTY', 'characterFunctions', diagnostics)
  requiredArray(dna.narrativeMechanics, 1, 'DNA_NARRATIVE_MECHANICS_EMPTY', 'narrativeMechanics', diagnostics)
  requiredArray(dna.independentDesignTargets, 7, 'DNA_REDESIGN_TARGETS_INSUFFICIENT', 'independentDesignTargets', diagnostics)
  const invalidTargets = (dna.independentDesignTargets ?? []).filter(item => !REDESIGN_CATEGORIES.has(item))
  if (invalidTargets.length) diagnostics.push(createDiagnostic('DNA_REDESIGN_TARGET_UNKNOWN', 'error', 'Story DNA contains unknown redesign categories.', { evidence: invalidTargets }))
  if (!dna.pacing || typeof dna.pacing !== 'object') diagnostics.push(createDiagnostic('DNA_PACING_MISSING', 'error', 'Story DNA needs a pacing object.'))
  if (!dna.marketConstraints || typeof dna.marketConstraints !== 'object') diagnostics.push(createDiagnostic('DNA_MARKET_CONSTRAINTS_MISSING', 'error', 'Story DNA needs market constraints.'))
  diagnostics.push(...sourceLeakDiagnostics({
    value: dna,
    terms: sourceSpecificTerms(extraction),
    sourceText,
    pathName: 'story-dna'
  }))
  return diagnostics
}

export const sealStoryDna = ({ workspace, inputPath }) => {
  const paths = workspacePaths(workspace)
  const sourceText = fs.readFileSync(requireFile(paths.source), 'utf8').trimEnd()
  const sourceRecord = readJson(requireFile(paths.sourceRecord))
  const extraction = readJson(requireFile(paths.extraction, 'extraction ledger'))
  const dna = readJson(path.resolve(inputPath))
  const diagnostics = [
    ...manifestHashDiagnostics(paths),
    ...validateStoryDna({ dna, extraction, sourceText })
  ]
  if (!(extraction.events ?? []).length) diagnostics.push(createDiagnostic('DNA_SOURCE_EVENTS_EMPTY', 'error', 'Story DNA cannot be sealed without extracted events.'))
  if (!(extraction.characters ?? []).length) diagnostics.push(createDiagnostic('DNA_SOURCE_CHARACTERS_EMPTY', 'error', 'Story DNA cannot be sealed without extracted characters.'))
  if (!(extraction.emotionNodes ?? []).length) diagnostics.push(createDiagnostic('DNA_SOURCE_EMOTIONS_EMPTY', 'error', 'Story DNA cannot be sealed without extracted emotion nodes.'))
  if (hasErrors(diagnostics)) return { result: 'fail', stage: 'dna', diagnostics }

  const terms = unique([sourceRecord.title, ...sourceSpecificTerms(extraction)].filter(Boolean))
  const baseline = {
    schemaVersion: '1.0.0',
    sourceId: extraction.sourceId,
    sourceHash: extraction.sourceHash,
    sourceSpecificTerms: terms,
    sourceCharacterNames: (extraction.characters ?? []).flatMap(item => [item.displayName, ...(item.aliases ?? [])]).filter(Boolean),
    distinctiveExpressionHashes: (extraction.distinctiveExpressions ?? []).map(item => ({
      expressionId: item.expressionId,
      hash: sha256(item.text ?? '')
    })),
    eventSequenceHash: sha256((extraction.events ?? []).map(item => ({
      order: item.order,
      participants: item.participants,
      action: item.action,
      result: item.result,
      causes: item.causeEventIds
    }))),
    exactPhrasePolicy: {
      englishBlockTokens: 8,
      englishWarnTokens: 6,
      cjkBlockCharacters: 18,
      cjkWarnCharacters: 14
    }
  }
  writeJson(paths.dna, dna)
  writeJson(paths.originalityBaseline, baseline)
  updateManifest(paths, 'dna-sealed', {
    storyDna: paths.dna,
    originalityBaseline: paths.originalityBaseline
  })
  return {
    result: 'pass',
    stage: 'dna-sealed',
    dnaHash: sha256(dna),
    sourceSpecificTerms: terms.length,
    diagnostics
  }
}

const cleanBriefFromDna = dna => ({
  schemaVersion: '1.0.0',
  briefId: `BRIEF-${dna.dnaId.toUpperCase()}`,
  sourceDisclosure: 'abstract-only',
  targetAudience: dna.targetAudience,
  audiencePromise: dna.audiencePromise,
  genreEnvelope: dna.genreEnvelope,
  themes: dna.themes ?? [],
  emotionalRewards: dna.emotionalRewards,
  characterFunctions: dna.characterFunctions,
  relationshipFunctions: dna.relationshipFunctions ?? [],
  narrativeMechanics: dna.narrativeMechanics,
  pacing: dna.pacing,
  marketConstraints: dna.marketConstraints,
  independentDesignTargets: dna.independentDesignTargets,
  writerConstraints: {
    mustCreate: [
      'new character identities and biographies',
      'new relationship topology',
      'new world rules and setting',
      'new causal chain and concrete events',
      'new reversals, climax, ending, scenes, and dialogue'
    ],
    mustNotRequest: [
      'source text',
      'source character sheet',
      'source event ledger',
      'source-specific exclusions'
    ],
    provenanceRule: 'The draft may cite Story DNA function IDs only.',
    legalRule: 'Machine checks provide risk signals and no legal conclusion.'
  }
})

export const buildCleanRoomBrief = ({ workspace }) => {
  const paths = workspacePaths(workspace)
  const sourceText = fs.readFileSync(requireFile(paths.source), 'utf8').trimEnd()
  const sourceRecord = readJson(requireFile(paths.sourceRecord))
  const extraction = readJson(requireFile(paths.extraction))
  const dna = readJson(requireFile(paths.dna, 'sealed Story DNA'))
  const baseline = readJson(requireFile(paths.originalityBaseline))
  const diagnostics = [
    ...manifestHashDiagnostics(paths),
    ...rightsDiagnostics(sourceRecord),
    ...validateStoryDna({ dna, extraction, sourceText })
  ]
  if (hasErrors(diagnostics)) return { result: 'fail', stage: 'brief', diagnostics }
  const brief = cleanBriefFromDna(dna)
  diagnostics.push(...sourceLeakDiagnostics({
    value: brief,
    terms: baseline.sourceSpecificTerms,
    sourceText,
    pathName: 'clean-room-brief'
  }))
  if (hasErrors(diagnostics)) return { result: 'fail', stage: 'brief', diagnostics }
  writeJson(paths.brief, brief)
  const receipt = {
    schemaVersion: '1.0.0',
    status: 'sealed',
    legalConclusion: 'not-provided',
    rightsStatus: sourceRecord.rights.status,
    rightsBasisHash: sha256(sourceRecord.rights.basis),
    sourceHash: sourceRecord.contentHash,
    extractionHash: sha256(extraction),
    storyDnaHash: sha256(dna),
    originalityBaselineHash: sha256(baseline),
    briefHash: sha256(brief),
    writerVisibleFiles: ['writer/clean-room-brief.json'],
    analystFilesExcluded: [
      'analyst/source.txt',
      'analyst/source-record.json',
      'analyst/extraction-ledger.json',
      'analyst/originality-baseline.json'
    ],
    sealedAt: new Date().toISOString()
  }
  writeJson(paths.cleanRoomReceipt, receipt)
  updateManifest(paths, 'brief-sealed', {
    cleanRoomBrief: paths.brief,
    cleanRoomReceipt: paths.cleanRoomReceipt
  })
  return {
    result: 'pass',
    stage: 'brief-sealed',
    briefPath: paths.brief,
    writerVisibleFiles: receipt.writerVisibleFiles,
    diagnostics
  }
}

export const validateRewriteDraft = ({ draft, brief, baseline, sourceText }) => {
  const diagnostics = []
  if (draft.schemaVersion !== '1.0.0') diagnostics.push(createDiagnostic('DRAFT_SCHEMA_VERSION_UNSUPPORTED', 'error', 'Rewrite draft schemaVersion must be 1.0.0.'))
  requiredString(draft.project?.projectId, 'DRAFT_PROJECT_ID_MISSING', 'project.projectId', diagnostics)
  requiredString(draft.project?.title, 'DRAFT_TITLE_MISSING', 'project.title', diagnostics)
  requiredString(draft.project?.language, 'DRAFT_LANGUAGE_MISSING', 'project.language', diagnostics)
  requiredString(draft.world?.premise, 'DRAFT_WORLD_PREMISE_MISSING', 'world.premise', diagnostics)
  requiredArray(draft.world?.rules, 1, 'DRAFT_WORLD_RULES_EMPTY', 'world.rules', diagnostics)
  requiredArray(draft.characters, 1, 'DRAFT_CHARACTERS_EMPTY', 'characters', diagnostics)
  requiredArray(draft.scenes, 3, 'DRAFT_SCENES_INSUFFICIENT', 'scenes', diagnostics)
  requiredArray(draft.causalChain, 2, 'DRAFT_CAUSAL_CHAIN_INSUFFICIENT', 'causalChain', diagnostics)
  requiredArray(draft.sellingPointMapping, 1, 'DRAFT_SELLING_POINT_MAPPING_EMPTY', 'sellingPointMapping', diagnostics)

  const characterIds = (draft.characters ?? []).map(item => item.characterId)
  const sceneIds = (draft.scenes ?? []).map(item => item.sceneId)
  const relationshipIds = (draft.relationships ?? []).map(item => item.relationshipId)
  for (const [label, values] of [['character', characterIds], ['scene', sceneIds], ['relationship', relationshipIds]]) {
    const repeated = duplicates(values.filter(Boolean))
    if (repeated.length) diagnostics.push(createDiagnostic('DRAFT_ID_DUPLICATE', 'error', `Draft contains duplicate ${label} IDs.`, { evidence: repeated }))
  }
  const characterIdSet = new Set(characterIds)
  const sceneIdSet = new Set(sceneIds)
  const sceneIndex = new Map(sceneIds.map((id, index) => [id, index]))
  for (const [index, character] of (draft.characters ?? []).entries()) {
    for (const field of ['characterId', 'displayName', 'role', 'want', 'need', 'fear', 'flaw', 'voice', 'arc']) {
      requiredString(character[field], 'DRAFT_CHARACTER_INCOMPLETE', `characters[${index}].${field}`, diagnostics)
    }
  }
  for (const [index, relationship] of (draft.relationships ?? []).entries()) {
    if (!characterIdSet.has(relationship.fromCharacterId) || !characterIdSet.has(relationship.toCharacterId)) {
      diagnostics.push(createDiagnostic('DRAFT_RELATIONSHIP_CHARACTER_UNRESOLVED', 'error', `Relationship ${relationship.relationshipId ?? index} references unknown characters.`))
    }
    requiredString(relationship.pressure, 'DRAFT_RELATIONSHIP_PRESSURE_MISSING', `relationships[${index}].pressure`, diagnostics)
  }
  let dialogueCount = 0
  const beatIds = []
  for (const [index, scene] of (draft.scenes ?? []).entries()) {
    for (const field of ['sceneId', 'title', 'locationId', 'summary', 'emotionalFunctionId']) {
      requiredString(scene[field], 'DRAFT_SCENE_INCOMPLETE', `scenes[${index}].${field}`, diagnostics)
    }
    requiredArray(scene.beats, 1, 'DRAFT_SCENE_BEATS_EMPTY', `scenes[${index}].beats`, diagnostics)
    for (const [beatIndex, beat] of (scene.beats ?? []).entries()) {
      requiredString(beat.beatId, 'DRAFT_BEAT_ID_MISSING', `scenes[${index}].beats[${beatIndex}].beatId`, diagnostics)
      requiredString(beat.kind, 'DRAFT_BEAT_KIND_MISSING', `scenes[${index}].beats[${beatIndex}].kind`, diagnostics)
      requiredString(beat.text, 'DRAFT_BEAT_TEXT_MISSING', `scenes[${index}].beats[${beatIndex}].text`, diagnostics)
      beatIds.push(beat.beatId)
      if (beat.kind === 'dialogue') {
        dialogueCount += 1
        if (!characterIdSet.has(beat.speakerId)) diagnostics.push(createDiagnostic('DRAFT_DIALOGUE_SPEAKER_UNRESOLVED', 'error', `Dialogue beat ${beat.beatId} references unknown speaker ${beat.speakerId}.`))
      }
    }
  }
  if (duplicates(beatIds).length) diagnostics.push(createDiagnostic('DRAFT_BEAT_ID_DUPLICATE', 'error', 'Beat IDs must be unique.'))
  if (!dialogueCount) diagnostics.push(createDiagnostic('DRAFT_DIALOGUE_EMPTY', 'error', 'Draft needs original dialogue before Taste review.'))

  for (const [index, link] of (draft.causalChain ?? []).entries()) {
    if (!sceneIdSet.has(link.causeSceneId) || !sceneIdSet.has(link.effectSceneId)) {
      diagnostics.push(createDiagnostic('DRAFT_CAUSAL_SCENE_UNRESOLVED', 'error', `Causal link ${link.linkId ?? index} references unknown scenes.`))
    } else if (sceneIndex.get(link.causeSceneId) >= sceneIndex.get(link.effectSceneId)) {
      diagnostics.push(createDiagnostic('DRAFT_CAUSAL_ORDER_INVALID', 'error', `Causal link ${link.linkId ?? index} does not move forward.`))
    }
    requiredString(link.rationale, 'DRAFT_CAUSAL_RATIONALE_MISSING', `causalChain[${index}].rationale`, diagnostics)
  }
  for (const sceneRef of [draft.project?.climaxSceneId, draft.project?.endingSceneId]) {
    if (!sceneIdSet.has(sceneRef)) diagnostics.push(createDiagnostic('DRAFT_STRUCTURE_SCENE_UNRESOLVED', 'error', `Draft climax or ending references unknown scene ${sceneRef}.`))
  }
  diagnostics.push(...validateInteractiveDesign({ draft, sceneIdSet, characterIdSet }))

  const mappedDnaIds = new Set((draft.sellingPointMapping ?? []).map(item => item.dnaRef))
  const requiredDnaIds = [
    ...(brief.emotionalRewards ?? []).map(item => item.rewardId),
    ...(brief.narrativeMechanics ?? []).map(item => item.mechanicId)
  ].filter(Boolean)
  const unmapped = requiredDnaIds.filter(id => !mappedDnaIds.has(id))
  if (unmapped.length) diagnostics.push(createDiagnostic('DRAFT_DNA_MAPPING_INCOMPLETE', 'error', 'Draft does not map every emotional reward and narrative mechanic.', { evidence: unmapped }))
  const validScriptRefs = new Set([...sceneIds, ...relationshipIds, ...beatIds])
  for (const [index, mapping] of (draft.sellingPointMapping ?? []).entries()) {
    requiredArray(mapping.scriptRefs, 1, 'DRAFT_DNA_MAPPING_REFS_EMPTY', `sellingPointMapping[${index}].scriptRefs`, diagnostics)
    const unresolvedRefs = (mapping.scriptRefs ?? []).filter(ref => !validScriptRefs.has(ref))
    if (unresolvedRefs.length) diagnostics.push(createDiagnostic('DRAFT_DNA_MAPPING_REF_UNRESOLVED', 'error', `Selling-point mapping ${mapping.dnaRef ?? index} references unknown draft records.`, { evidence: unresolvedRefs }))
  }
  const knownDnaIds = new Set(requiredDnaIds)
  for (const [index, scene] of (draft.scenes ?? []).entries()) {
    if (!knownDnaIds.has(scene.emotionalFunctionId)) diagnostics.push(createDiagnostic('DRAFT_SCENE_DNA_REF_UNRESOLVED', 'error', `Scene ${scene.sceneId ?? index} references unknown Story DNA function ${scene.emotionalFunctionId}.`))
  }

  const designChanges = draft.originality?.designChanges ?? []
  const designCategories = unique(designChanges.map(item => item.category))
  const missingCategories = (brief.independentDesignTargets ?? []).filter(category => !designCategories.includes(category))
  if (designCategories.filter(item => REDESIGN_CATEGORIES.has(item)).length < 7 || missingCategories.length) {
    diagnostics.push(createDiagnostic('DRAFT_INDEPENDENT_DESIGN_INCOMPLETE', 'error', 'Draft lacks required independent redesign declarations.', { evidence: { designCategories, missingCategories } }))
  }
  for (const [index, change] of designChanges.entries()) requiredString(change.description, 'DRAFT_DESIGN_CHANGE_DESCRIPTION_MISSING', `originality.designChanges[${index}].description`, diagnostics)
  diagnostics.push(...sourceLeakDiagnostics({
    value: draft,
    terms: baseline.sourceSpecificTerms ?? [],
    sourceText,
    pathName: 'rewrite-draft'
  }))
  return diagnostics
}

const buildBranInput = ({ draft, sourceRecord, brief, paths }) => {
  const firstEventId = 'GEN-EVENT-001'
  const allFactIds = []
  const canonFacts = [
    {
      factId: 'GEN-FACT-PREMISE',
      statement: draft.world.premise,
      sourceEventIds: [firstEventId],
      visibility: ['public'],
      status: 'adaptation',
      confidence: 1
    },
    ...draft.world.rules.map((rule, index) => ({
      factId: `GEN-FACT-RULE-${String(index + 1).padStart(3, '0')}`,
      statement: typeof rule === 'string' ? rule : rule.statement,
      sourceEventIds: [firstEventId],
      visibility: ['public'],
      status: 'adaptation',
      confidence: 1
    }))
  ]
  allFactIds.push(...canonFacts.map(item => item.factId))
  const generatedSourceId = 'GEN-SCRIPT'
  const protagonist = draft.characters.find(item => item.role.toLocaleLowerCase().includes('protagonist')) ?? draft.characters[0]
  const sourceEvents = draft.scenes.map((scene, index) => {
    const participants = unique((scene.beats ?? []).map(beat => beat.speakerId).filter(Boolean))
    const causeSceneIds = draft.causalChain.filter(link => link.effectSceneId === scene.sceneId).map(link => link.causeSceneId)
    return {
      eventId: `GEN-EVENT-${String(index + 1).padStart(3, '0')}`,
      order: index,
      title: scene.title,
      summary: scene.summary,
      sourceSpans: [{
        sourceId: generatedSourceId,
        locator: { jsonPath: `$.scenes[${index}]` },
        quoteHash: sha256(scene)
      }],
      participants,
      action: scene.beats[0]?.text ?? scene.summary,
      result: scene.beats.at(-1)?.text ?? scene.summary,
      causeEventIds: causeSceneIds.map(sceneId => `GEN-EVENT-${String(draft.scenes.findIndex(item => item.sceneId === sceneId) + 1).padStart(3, '0')}`),
      time: null,
      locationId: scene.locationId,
      canonStatus: 'adaptation',
      confidence: 1,
      reviewStatus: 'provisional',
      notes: `Generated from clean-room brief ${brief.briefId}.`
    }
  })
  const interaction = draft.interactiveDesign
  const choicesByScene = new Map()
  for (const choice of interaction?.choices ?? []) {
    const existing = choicesByScene.get(choice.sceneId) ?? []
    existing.push(choice)
    choicesByScene.set(choice.sceneId, existing)
  }
  const scenes = draft.scenes.map((scene, index) => {
    const finalScene = index === draft.scenes.length - 1
    const eventId = sourceEvents[index].eventId
    const interactiveChoices = choicesByScene.get(scene.sceneId)
    const actions = interactiveChoices?.length
      ? interactiveChoices.map(choice => ({
          actionId: choice.actionId,
          seat: choice.seat,
          label: choice.label,
          ...(choice.targetSceneId ? { targetSceneId: choice.targetSceneId } : {}),
          preconditions: choice.preconditions ?? [],
          effectOps: choice.effectOps ?? [],
          costs: choice.costs ?? [],
          ...(choice.counteractionId ? { counteractionId: choice.counteractionId } : {}),
          decisionCueId: choice.decisionCueId,
          publicEcho: choice.publicEcho
        }))
      : [{
          actionId: `advance-${String(index + 1).padStart(3, '0')}`,
          seat: protagonist.characterId,
          label: finalScene ? 'Complete the story' : `Advance to ${draft.scenes[index + 1].title}`,
          preconditions: [],
          effectOps: finalScene
            ? [{ op: 'set', path: 'story.completed', value: true }]
            : [{ op: 'set', path: 'world.sceneIndex', value: index + 1 }],
          costs: [],
          decisionCueId: `GEN-CUE-${String(index + 1).padStart(3, '0')}`,
          publicEcho: scene.beats.at(-1)?.text ?? scene.summary
        }]
    const nextSceneIds = interactiveChoices?.length
      ? unique(interactiveChoices.map(choice => choice.targetSceneId).filter(Boolean))
      : finalScene ? [] : [draft.scenes[index + 1].sceneId]
    return {
      sceneId: scene.sceneId,
      title: scene.title,
      summary: scene.summary,
      eventIds: [eventId],
      nextSceneIds,
      beats: scene.beats.map(beat => ({
        beatId: beat.beatId,
        kind: beat.kind,
        view: 'public',
        text: beat.kind === 'dialogue'
          ? `${draft.characters.find(character => character.characterId === beat.speakerId)?.displayName ?? 'Character'}: ${beat.text}`
          : beat.text,
        sourceEventIds: [eventId],
        visibility: ['public']
      })),
      productionScript: {
        name: scene.title,
        content: [
          `# ${scene.title}`,
          '',
          `场景：${scene.locationId}`,
          `时间：${scene.time ?? '未指定'}`,
          '',
          ...scene.beats.map(beat => beat.kind === 'dialogue'
            ? `${draft.characters.find(character => character.characterId === beat.speakerId)?.displayName ?? 'Character'}：${beat.text}`
            : beat.text),
          '',
          `段尾状态：${scene.summary}`
        ].join('\n')
      },
      actions
    }
  })
  const defaultStateModel = {
    fields: [
      { path: 'world.sceneIndex', type: 'integer', defaultValue: 0, writers: ['action', 'reducer'] },
      { path: 'story.completed', type: 'boolean', defaultValue: false, writers: ['action', 'reducer'] },
      { path: 'emotion.pressure', type: 'integer', defaultValue: 0, writers: ['action', 'reducer'] }
    ],
    derivedFields: [
      { path: 'derived.complete', expression: { var: 'story.completed' } }
    ],
    invariants: ['world.sceneIndex follows scene order']
  }
  const completedState = { world: { sceneIndex: draft.scenes.length - 1 }, story: { completed: true }, emotion: { pressure: 0 } }
  const incompleteState = { world: { sceneIndex: 0 }, story: { completed: false }, emotion: { pressure: 0 } }
  const defaultSettlement = {
    rules: [
      {
        endingCode: 'ENDING-REWRITE-COMPLETE',
        title: 'Rewrite complete',
        priority: 100,
        predicate: { var: 'derived.complete' },
        reasonCodes: ['SCRIPT_REACHED_ENDING']
      },
      {
        endingCode: 'ENDING-REWRITE-INCOMPLETE',
        title: 'Rewrite incomplete',
        priority: 0,
        predicate: true,
        reasonCodes: ['SCRIPT_NOT_FINISHED']
      }
    ],
    testVectors: [
      { vectorId: 'VECTOR-COMPLETE', state: completedState, expectedEndingCode: 'ENDING-REWRITE-COMPLETE' },
      { vectorId: 'VECTOR-INCOMPLETE', state: incompleteState, expectedEndingCode: 'ENDING-REWRITE-INCOMPLETE' }
    ],
    projectionContract: { fragments: ['story', 'emotion'] }
  }
  return {
    $schema: 'https://github.com/JonathonGuo777/bran/schemas/bran-input-bundle.schema.json',
    schemaVersion: '1.0.0',
    project: {
      projectId: draft.project.projectId,
      title: draft.project.title,
      language: draft.project.language,
      packageVersion: draft.project.packageVersion ?? '0.1.0',
      runtimeTarget: draft.project.runtimeTarget ?? (interaction ? 'hodor-interactive' : 'bran-linear-review'),
      entrySceneId: interaction?.entrySceneId ?? draft.scenes[0].sceneId,
      description: `Clean-room rewrite awaiting Taste review. Source rights: ${sourceRecord.rights.status}.`
    },
    sources: [{
      sourceId: generatedSourceId,
      path: relativeArtifact(paths.workspace, paths.draft),
      version: draft.project.packageVersion ?? '0.1.0',
      contentHash: sha256(draft),
      rights: `original-clean-room-output:${sourceRecord.rights.status}`,
      quotePolicy: 'Generated script is reviewable; analyst source remains segregated.'
    }],
    sourceEvents,
    canonFacts,
    characters: draft.characters.map(character => ({
      characterId: character.characterId,
      displayName: character.displayName,
      controller: 'human',
      seat: character.characterId,
      want: character.want,
      need: character.need,
      fear: character.fear,
      errorHabit: character.flaw,
      voice: character.voice,
      oocBoundaries: character.oocBoundaries ?? ['Does not import source-specific expression.'],
      knowledgeFactIds: allFactIds
    })),
    stateModel: interaction?.stateModel ?? defaultStateModel,
    scenes,
    recipes: [],
    settlement: interaction?.settlement ?? defaultSettlement,
    agents: { contracts: [] },
    runtime: {
      runtimeOwner: 'bran-review',
      relationshipOwner: 'brain-mesh',
      operations: ['loadPackage', 'getSceneView', 'listActions', 'submitAction', 'reduceWorldState', 'settle', 'verifyVersion'],
      eventContracts: {
        WorldEvent: { required: ['eventId', 'runId', 'sceneId', 'actionInstanceId', 'stateBeforeHash', 'stateAfterHash'] },
        RelationshipEventCandidate: { required: ['eventId', 'userId', 'characterId', 'evidenceRefs', 'proposedDelta', 'consentScope'] },
        ContentFeedback: { required: ['feedbackId', 'packageVersion', 'sceneId', 'category', 'evidenceRefs'] }
      }
    },
    productionHandoff: { materialOwner: 'neeboo-after-taste-review', assetSlots: [] },
    review: { status: 'draft', entries: [] },
    auditProfile: {
      level: 'compile',
      minimumChangedScenes: 0,
      minimumActionGraphDistance: 0,
      maximumDecisionCueReuse: 1
    }
  }
}

const currentArtifactHashes = paths => {
  const names = {
    sourceRecord: paths.sourceRecord,
    extraction: paths.extraction,
    storyDna: paths.dna,
    cleanRoomBrief: paths.brief,
    rewriteDraft: paths.draft,
    branInput: paths.branInput,
    hodorTarget: paths.hodorTarget
  }
  return Object.fromEntries(Object.entries(names).filter(([, filePath]) => fs.existsSync(filePath)).map(([name, filePath]) => [name, {
    path: relativeArtifact(paths.workspace, filePath),
    hash: sha256(fs.readFileSync(filePath))
  }]))
}

export const auditRewriteWorkspace = ({ workspace, writeReceipt = true }) => {
  const paths = workspacePaths(workspace)
  const priorReceipt = fs.existsSync(paths.auditReceipt) ? readJson(paths.auditReceipt) : null
  const diagnostics = [...manifestHashDiagnostics(paths)]
  let sourceRecord
  let sourceText = ''
  let baseline
  let brief
  let draft
  try {
    sourceRecord = readJson(requireFile(paths.sourceRecord))
    sourceText = fs.readFileSync(requireFile(paths.source), 'utf8').trimEnd()
    baseline = readJson(requireFile(paths.originalityBaseline))
    brief = readJson(requireFile(paths.brief))
    draft = readJson(requireFile(paths.draft))
    diagnostics.push(...rightsDiagnostics(sourceRecord))
    diagnostics.push(...sourceLeakDiagnostics({ value: brief, terms: baseline.sourceSpecificTerms ?? [], sourceText, pathName: 'clean-room-brief' }))
    diagnostics.push(...validateRewriteDraft({ draft, brief, baseline, sourceText }))
  } catch (error) {
    diagnostics.push(createDiagnostic('REWRITE_AUDIT_ARTIFACT_MISSING', 'error', error.message))
  }

  let branAudit = null
  if (fs.existsSync(paths.branHandoff)) {
    try {
      branAudit = auditPackage({ root: paths.branHandoff, level: 'compile' })
      if (branAudit.result !== 'pass') diagnostics.push(createDiagnostic('BRAN_COMPILE_AUDIT_FAILED', 'error', 'Generated Bran package failed compile audit.', { evidence: branAudit.diagnostics }))
    } catch (error) {
      diagnostics.push(createDiagnostic('BRAN_COMPILE_AUDIT_FAILED', 'error', error.message))
    }
  } else {
    diagnostics.push(createDiagnostic('BRAN_HANDOFF_MISSING', 'error', 'Compiled Bran handoff is missing.'))
  }

  const result = hasErrors(diagnostics) ? 'fail' : 'pass'
  const receipt = {
    schemaVersion: '1.0.0',
    result,
    legalConclusion: 'not-provided',
    machineAssessment: 'Risk-signal and contract checks only. Human rights and Taste review remain required.',
    rightsStatus: sourceRecord?.rights?.status ?? 'unknown',
    artifacts: currentArtifactHashes(paths),
    checks: {
      rightsGate: !diagnostics.some(item => item.code.startsWith('RIGHTS_') || item.code.startsWith('PUBLIC_DOMAIN_')),
      cleanRoomLeakCheck: !diagnostics.some(item => ['SOURCE_SPECIFIC_TERM_LEAK', 'LONG_EXACT_SOURCE_PHRASE'].includes(item.code)),
      independentDesignCheck: !diagnostics.some(item => item.code === 'DRAFT_INDEPENDENT_DESIGN_INCOMPLETE'),
      branCompileAudit: branAudit?.result === 'pass'
    },
    blockers: diagnostics.filter(item => item.severity === 'error'),
    warnings: diagnostics.filter(item => item.severity === 'warning'),
    auditedAt: priorReceipt?.auditedAt ?? new Date().toISOString()
  }
  if (writeReceipt) writeJson(paths.auditReceipt, receipt)
  return receipt
}

export const generateRewrite = ({ workspace, draftPath }) => {
  const paths = workspacePaths(workspace)
  const sourceText = fs.readFileSync(requireFile(paths.source), 'utf8').trimEnd()
  const sourceRecord = readJson(requireFile(paths.sourceRecord))
  const baseline = readJson(requireFile(paths.originalityBaseline))
  const brief = readJson(requireFile(paths.brief))
  const draft = readJson(path.resolve(draftPath))
  const diagnostics = [
    ...manifestHashDiagnostics(paths),
    ...rightsDiagnostics(sourceRecord),
    ...validateRewriteDraft({ draft, brief, baseline, sourceText })
  ]
  if (hasErrors(diagnostics)) return { result: 'fail', stage: 'generation', diagnostics }
  writeJson(paths.draft, draft)
  const branInput = buildBranInput({ draft, sourceRecord, brief, paths })
  const branInputDiagnostics = validateInput(branInput)
  diagnostics.push(...branInputDiagnostics)
  if (hasErrors(diagnostics)) return { result: 'fail', stage: 'generation', diagnostics }
  writeJson(paths.branInput, branInput)
  const compileResult = compileBundle({ inputPath: paths.branInput, outputRoot: paths.branHandoff })
  if (compileResult.result !== 'pass') {
    return { result: 'fail', stage: 'generation', diagnostics: [...diagnostics, ...(compileResult.diagnostics ?? [])] }
  }
  const branAudit = auditPackage({ root: paths.branHandoff, level: 'compile' })
  if (branAudit.result !== 'pass') {
    return {
      result: 'fail',
      stage: 'generation',
      diagnostics: [...diagnostics, createDiagnostic('BRAN_COMPILE_AUDIT_FAILED', 'error', 'Generated Bran package failed compile audit.', { evidence: branAudit.diagnostics })]
    }
  }
  let hodorExport = null
  if (draft.project.hodorProjectId !== undefined) {
    hodorExport = buildHodorTarget({
      root: paths.branHandoff,
      projectId: Number(draft.project.hodorProjectId),
      recipeId: draft.project.hodorRecipeId ?? 'baseline',
      outputPath: paths.hodorTarget
    })
    if (hodorExport.result !== 'pass') {
      return {
        result: 'fail',
        stage: 'generation',
        diagnostics: [...diagnostics, ...(hodorExport.diagnostics ?? [])]
      }
    }
  } else if (String(draft.project.runtimeTarget ?? '').includes('hodor')) {
    diagnostics.push(createDiagnostic('HODOR_PROJECT_BINDING_PENDING', 'warning', 'The interactive Bran package is compiled, but export-hodor still needs a numeric Hodor project ID.'))
  }
  const generatedArtifacts = {
    rewriteDraft: paths.draft,
    branInput: paths.branInput,
    branManifest: path.join(paths.branHandoff, 'package', 'source-manifest.json'),
    branCompileReceipt: path.join(paths.branHandoff, 'package', 'compile-receipt.json'),
    ...(hodorExport ? { hodorTarget: paths.hodorTarget } : {})
  }
  updateManifest(paths, 'generated', generatedArtifacts)
  const auditReceipt = auditRewriteWorkspace({ workspace, writeReceipt: true })
  if (auditReceipt.result !== 'pass') return { result: 'fail', stage: 'generation', diagnostics: auditReceipt.blockers }
  const tasteHandoff = {
    schemaVersion: '1.0.0',
    status: 'awaiting-taste-review',
    projectId: draft.project.projectId,
    title: draft.project.title,
    targetMarket: brief.marketConstraints,
    rightsStatus: sourceRecord.rights.status,
    rightsBasisHash: sha256(sourceRecord.rights.basis),
    artifacts: {
      storyDna: { path: 'analyst/story-dna.json', hash: sha256(readJson(paths.dna)) },
      cleanRoomBrief: { path: 'writer/clean-room-brief.json', hash: sha256(brief) },
      rewriteDraft: { path: 'writer/rewrite-draft.json', hash: sha256(draft) },
      branInput: { path: 'handoff/bran-input.json', hash: sha256(branInput) },
      branPackage: { path: 'handoff/bran/package/source-manifest.json', hash: sha256(fs.readFileSync(path.join(paths.branHandoff, 'package', 'source-manifest.json'))) },
      ...(hodorExport ? { hodorTarget: { path: 'handoff/hodor-interactive-story-target.json', hash: sha256(fs.readFileSync(paths.hodorTarget)) } } : {}),
      rewriteAuditReceipt: { path: 'receipts/rewrite-audit-receipt.json', hash: sha256(fs.readFileSync(paths.auditReceipt)) }
    },
    machineStatus: 'pass',
    legalConclusion: 'not-provided',
    requestedHumanReview: [
      'pace and episode rhythm',
      'target-market taste',
      'emotional payoff and cry points',
      'opening and episode hooks',
      'character appeal and relationship chemistry',
      'English localization and cultural fit'
    ],
    generatedAt: new Date().toISOString()
  }
  writeJson(paths.tasteHandoff, tasteHandoff)
  updateManifest(paths, 'awaiting-taste-review', {
    rewriteDraft: paths.draft,
    branInput: paths.branInput,
    branManifest: path.join(paths.branHandoff, 'package', 'source-manifest.json'),
    branCompileReceipt: path.join(paths.branHandoff, 'package', 'compile-receipt.json'),
    ...(hodorExport ? { hodorTarget: paths.hodorTarget } : {}),
    tasteReviewHandoff: paths.tasteHandoff
  })
  return {
    result: 'pass',
    stage: 'awaiting-taste-review',
    workspace: paths.workspace,
    draftPath: paths.draft,
    branInputPath: paths.branInput,
    branHandoff: paths.branHandoff,
    hodorTarget: hodorExport ? paths.hodorTarget : null,
    tasteReviewHandoff: paths.tasteHandoff,
    artifactHash: compileResult.artifactHash,
    diagnostics
  }
}

export const workspaceStatus = workspace => {
  const paths = workspacePaths(workspace)
  const manifest = readJson(requireFile(paths.manifest))
  return {
    result: 'pass',
    workspace: paths.workspace,
    projectId: manifest.projectId,
    currentStage: manifest.currentStage,
    artifacts: manifest.artifacts,
    hashDiagnostics: manifestHashDiagnostics(paths)
  }
}
