import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  createDiagnostic,
  normalizeText,
  readJsonOrJsonl,
  sha256,
  slug,
  unique
} from './common.mjs'

const decodeXml = value => String(value ?? '')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&amp;', '&')

const textFromFdx = xml => {
  const paragraphs = []
  const paragraphPattern = /<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/giu
  for (const match of xml.matchAll(paragraphPattern)) {
    const type = match[1].match(/\bType="([^"]+)"/iu)?.[1] ?? 'Action'
    const texts = [...match[2].matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/giu)].map(item => decodeXml(item[1].replace(/<[^>]+>/gu, '')))
    if (!texts.length) continue
    const content = texts.join('')
    if (type === 'Scene Heading') paragraphs.push(content.toUpperCase())
    else if (type === 'Character') paragraphs.push(content.toUpperCase())
    else paragraphs.push(content)
  }
  return paragraphs.join('\n')
}

export const textFromDocxXml = xml => {
  const paragraphs = []
  const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/giu
  for (const paragraphMatch of String(xml ?? '').matchAll(paragraphPattern)) {
    const content = paragraphMatch[1]
      .replace(/<w:tab\b[^>]*\/?>/giu, '\t')
      .replace(/<w:br\b[^>]*\/?>/giu, '\n')
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/giu, (_match, text) => decodeXml(text.replace(/<[^>]+>/gu, '')))
      .replace(/<[^>]+>/gu, '')
      .trim()
    if (content) paragraphs.push(content)
  }
  return paragraphs.join('\n')
}

const textFromJson = filePath => {
  const payload = readJsonOrJsonl(filePath)
  if (typeof payload === 'string') return payload
  if (!Array.isArray(payload)) {
    for (const candidate of [payload.text, payload.rawText, payload.content, payload.script?.text, payload.document?.text]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
  }
  throw new Error('JSON source has no text, rawText, content, script.text, or document.text field.')
}

export const readSourceFile = filePath => {
  const absolutePath = path.resolve(filePath)
  const extension = path.extname(absolutePath).toLowerCase()
  let text
  let format
  if (extension === '.pdf') {
    try {
      text = execFileSync('pdftotext', ['-layout', absolutePath, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch (error) {
      throw new Error(`PDF ingestion needs pdftotext (Poppler), or a ScriptBreak/text export. ${error.message}`)
    }
    format = 'pdf'
  } else if (extension === '.fdx') {
    text = textFromFdx(fs.readFileSync(absolutePath, 'utf8'))
    format = 'fdx'
  } else if (extension === '.docx') {
    try {
      const documentXml = execFileSync('unzip', ['-p', absolutePath, 'word/document.xml'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
      })
      text = textFromDocxXml(documentXml)
    } catch (error) {
      throw new Error(`DOCX ingestion needs unzip and a valid word/document.xml entry. ${error.message}`)
    }
    format = 'docx'
  } else if (['.fountain', '.spmd'].includes(extension)) {
    text = fs.readFileSync(absolutePath, 'utf8')
    format = 'fountain'
  } else if (extension === '.md') {
    text = fs.readFileSync(absolutePath, 'utf8')
    format = 'markdown'
  } else if (extension === '.json' || extension === '.jsonl' || extension === '.scriptbreak') {
    text = textFromJson(absolutePath)
    format = 'json'
  } else {
    text = fs.readFileSync(absolutePath, 'utf8')
    format = 'text'
  }
  const normalized = normalizeText(text)
  if (!normalized) throw new Error(`Source contains no extractable text: ${absolutePath}`)
  return { absolutePath, format, text: normalized }
}

export const readSourceText = ({ text, format = 'text', name = 'pasted-source' }) => {
  const normalized = normalizeText(text)
  if (!normalized) throw new Error('Pasted source contains no extractable text.')
  const allowedFormats = new Set(['text', 'markdown', 'fountain'])
  if (!allowedFormats.has(format)) throw new Error(`Pasted source format must be one of: ${[...allowedFormats].join(', ')}.`)
  return {
    absolutePath: `stdin:${String(name).trim() || 'pasted-source'}`,
    format,
    text: normalized
  }
}

const lineRecords = text => {
  const rows = []
  let offset = 0
  for (const [index, line] of text.split('\n').entries()) {
    rows.push({ line: index + 1, text: line, start: offset, end: offset + line.length })
    offset += line.length + 1
  }
  return rows
}

const isSceneHeading = value => /^(?:(?:INT|EXT|INT\/EXT|EXT\/INT)\.?\s|(?:内景|外景|内外景)[：:\s])/iu.test(value.trim())
const isCharacterCue = value => {
  const trimmed = value.trim().replace(/\s*\([^)]*\)\s*$/u, '')
  if (!trimmed || trimmed.length > 40 || isSceneHeading(trimmed)) return false
  if (/^[A-Z][A-Z0-9 ._'’-]{1,38}$/u.test(trimmed)) return true
  return /^[\p{Script=Han}]{2,8}[：:]?$/u.test(trimmed) && /[：:]$/u.test(value.trim())
}

const makeEvidence = (text, start, end) => ({
  start,
  end,
  quoteHash: sha256(text.slice(start, end))
})

const paragraphScenes = text => {
  const paragraphs = [...text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/gu)]
  return paragraphs.map((match, index) => ({
    sceneId: `SRC-SCENE-${String(index + 1).padStart(3, '0')}`,
    order: index,
    title: `Source unit ${index + 1}`,
    location: null,
    characterIds: [],
    evidenceSpans: [makeEvidence(text, match.index, match.index + match[0].length)],
    status: 'provisional'
  }))
}

export const buildStructuralExtraction = ({ text, sourceId, sourceHash }) => {
  const lines = lineRecords(text)
  const headingLines = lines.filter(row => isSceneHeading(row.text))
  const scenes = []
  if (headingLines.length) {
    for (const [index, heading] of headingLines.entries()) {
      const nextStart = headingLines[index + 1]?.start ?? text.length
      scenes.push({
        sceneId: `SRC-SCENE-${String(index + 1).padStart(3, '0')}`,
        order: index,
        title: heading.text.trim(),
        location: heading.text.trim(),
        characterIds: [],
        evidenceSpans: [makeEvidence(text, heading.start, nextStart)],
        status: 'provisional'
      })
    }
  } else {
    scenes.push(...paragraphScenes(text))
  }

  const characterNames = unique(lines.filter(row => isCharacterCue(row.text)).map(row => row.text.trim().replace(/[：:]$/u, '').replace(/\s*\([^)]*\)\s*$/u, '')))
  const characters = characterNames.map((displayName, index) => {
    const rows = lines.filter(row => row.text.includes(displayName))
    return {
      characterId: `SRC-CHAR-${String(index + 1).padStart(3, '0')}`,
      displayName,
      aliases: [],
      role: 'unresolved',
      evidenceSpans: rows.slice(0, 5).map(row => makeEvidence(text, row.start, row.end)),
      confidence: 0.65,
      status: 'provisional'
    }
  })
  const characterIdByName = new Map(characters.map(item => [item.displayName, item.characterId]))
  for (const scene of scenes) {
    const span = scene.evidenceSpans[0]
    scene.characterIds = characters
      .filter(character => text.slice(span.start, span.end).includes(character.displayName))
      .map(character => character.characterId)
  }

  const events = scenes.map((scene, index) => {
    const span = scene.evidenceSpans[0]
    const excerpt = text.slice(span.start, span.end).replace(/\s+/gu, ' ').trim()
    return {
      eventId: `SRC-EVENT-${String(index + 1).padStart(3, '0')}`,
      order: index,
      sceneId: scene.sceneId,
      participants: scene.characterIds,
      action: excerpt.slice(0, 180) || 'Unresolved source action',
      result: 'Requires semantic extraction',
      causeEventIds: index ? [`SRC-EVENT-${String(index).padStart(3, '0')}`] : [],
      evidenceSpans: [span],
      confidence: 0.35,
      status: 'provisional'
    }
  })

  const dialogue = []
  for (const [index, row] of lines.entries()) {
    if (!isCharacterCue(row.text)) continue
    const name = row.text.trim().replace(/[：:]$/u, '').replace(/\s*\([^)]*\)\s*$/u, '')
    const next = lines[index + 1]
    if (!next?.text.trim()) continue
    dialogue.push({
      dialogueId: `SRC-DIALOGUE-${String(dialogue.length + 1).padStart(3, '0')}`,
      characterId: characterIdByName.get(name) ?? null,
      evidenceSpans: [makeEvidence(text, next.start, next.end)],
      status: 'provisional'
    })
  }

  return {
    schemaVersion: '1.0.0',
    sourceId,
    sourceHash,
    adapters: ['bran-structural'],
    scenes,
    characters,
    relationships: [],
    events,
    emotionNodes: [],
    distinctiveExpressions: [],
    dialogue,
    unresolved: [
      { code: 'SEMANTIC_ENRICHMENT_REQUIRED', message: 'Confirm event action/result, relationships, and emotion nodes with evidence.' }
    ]
  }
}

const flattenDocuments = payload => {
  if (Array.isArray(payload)) return payload.flatMap(flattenDocuments)
  if (payload?.documents) return flattenDocuments(payload.documents)
  return [payload]
}

const alignText = (sourceText, extractionText, preferredStart) => {
  if (Number.isInteger(preferredStart) && sourceText.slice(preferredStart, preferredStart + extractionText.length) === extractionText) {
    return { start: preferredStart, end: preferredStart + extractionText.length }
  }
  const start = sourceText.indexOf(extractionText)
  return start >= 0 ? { start, end: start + extractionText.length } : null
}

export const importLangExtract = ({ filePath, sourceText }) => {
  const payload = readJsonOrJsonl(filePath)
  const records = []
  for (const document of flattenDocuments(payload)) {
    for (const extraction of document?.extractions ?? []) {
      const extractionText = extraction.extraction_text ?? extraction.text ?? ''
      const interval = extraction.char_interval ?? extraction.charInterval ?? {}
      const aligned = alignText(sourceText, extractionText, interval.start_pos ?? interval.start)
      records.push({
        class: String(extraction.extraction_class ?? extraction.class ?? extraction.type ?? 'unclassified').toLowerCase(),
        text: extractionText,
        attributes: extraction.attributes ?? {},
        evidenceSpans: aligned ? [{ ...aligned, quoteHash: sha256(sourceText.slice(aligned.start, aligned.end)) }] : [],
        status: aligned ? 'provisional' : 'unresolved'
      })
    }
  }
  return records
}

const collectScriptBreakScenes = payload => payload?.scenes ?? payload?.script?.scenes ?? payload?.data?.scenes ?? []

export const importScriptBreak = ({ filePath, sourceText }) => {
  const payload = readJsonOrJsonl(filePath)
  const documents = Array.isArray(payload) ? payload : [payload]
  const scenes = []
  for (const document of documents) {
    for (const [index, scene] of collectScriptBreakScenes(document).entries()) {
      const title = scene.heading ?? scene.title ?? scene.slugline ?? `Imported scene ${index + 1}`
      const sceneText = scene.text ?? scene.content ?? scene.rawText ?? ''
      const aligned = sceneText ? alignText(sourceText, sceneText, scene.start ?? scene.startOffset) : null
      scenes.push({
        sceneId: scene.id ?? `SB-SCENE-${String(scenes.length + 1).padStart(3, '0')}`,
        order: scene.order ?? scenes.length,
        title,
        location: scene.location ?? title,
        characterNames: (scene.characters ?? []).map(item => typeof item === 'string' ? item : item.name).filter(Boolean),
        evidenceSpans: aligned ? [{ ...aligned, quoteHash: sha256(sourceText.slice(aligned.start, aligned.end)) }] : [],
        status: aligned ? 'provisional' : 'unresolved'
      })
    }
  }
  return scenes
}

export const mergeExtraction = ({ structural, native, langExtractRecords = [], scriptBreakScenes = [] }) => {
  if (native) {
    return {
      ...native,
      schemaVersion: '1.0.0',
      sourceId: structural.sourceId,
      sourceHash: structural.sourceHash,
      adapters: unique([...(native.adapters ?? ['bran-native']), 'bran-native'])
    }
  }
  const ledger = structuredClone(structural)
  if (scriptBreakScenes.length) {
    ledger.adapters.push('scriptbreak')
    ledger.scriptBreakRecords = scriptBreakScenes
  }
  if (langExtractRecords.length) {
    ledger.adapters.push('langextract')
    ledger.langExtractRecords = langExtractRecords
    const characterIdByName = new Map(ledger.characters.flatMap(item => [item.displayName, ...(item.aliases ?? [])].map(name => [String(name).toLocaleLowerCase(), item.characterId])))
    const sceneForSpan = span => ledger.scenes.find(scene => {
      const sceneSpan = scene.evidenceSpans?.[0]
      return sceneSpan && span && span.start >= sceneSpan.start && span.start < sceneSpan.end
    })
    const eventForSpan = span => ledger.events.find(event => {
      const eventSpan = event.evidenceSpans?.[0]
      return eventSpan && span && span.start >= eventSpan.start && span.start < eventSpan.end
    })
    for (const record of langExtractRecords) {
      const className = record.class
      const attributes = record.attributes ?? {}
      const evidenceSpans = record.evidenceSpans ?? []
      if (className.includes('character') || className.includes('person')) {
        const displayName = record.text.trim()
        if (displayName && !characterIdByName.has(displayName.toLocaleLowerCase())) {
          const characterId = `LX-CHAR-${String(ledger.characters.length + 1).padStart(3, '0')}`
          ledger.characters.push({
            characterId,
            displayName,
            aliases: [],
            role: attributes.role ?? 'unresolved',
            evidenceSpans,
            confidence: Number(attributes.confidence ?? 0.7),
            status: evidenceSpans.length ? 'provisional' : 'unresolved'
          })
          characterIdByName.set(displayName.toLocaleLowerCase(), characterId)
        }
      } else if (className.includes('relationship')) {
        const fromName = attributes.from ?? attributes.source_character ?? attributes.character_a
        const toName = attributes.to ?? attributes.target_character ?? attributes.character_b
        ledger.relationships.push({
          relationshipId: `LX-REL-${String(ledger.relationships.length + 1).padStart(3, '0')}`,
          fromCharacterId: characterIdByName.get(String(fromName ?? '').toLocaleLowerCase()) ?? null,
          toCharacterId: characterIdByName.get(String(toName ?? '').toLocaleLowerCase()) ?? null,
          type: attributes.type ?? record.text,
          state: attributes.state ?? 'requires semantic confirmation',
          evidenceSpans,
          confidence: Number(attributes.confidence ?? 0.7),
          status: evidenceSpans.length && fromName && toName ? 'provisional' : 'unresolved'
        })
      } else if (className.includes('emotion') || className.includes('sentiment')) {
        const subjectName = attributes.subject ?? attributes.character
        const span = evidenceSpans[0]
        ledger.emotionNodes.push({
          emotionNodeId: `LX-EMOTION-${String(ledger.emotionNodes.length + 1).padStart(3, '0')}`,
          emotion: attributes.emotion ?? attributes.sentiment ?? record.text,
          subjectCharacterId: characterIdByName.get(String(subjectName ?? '').toLocaleLowerCase()) ?? null,
          intensity: Number(attributes.intensity ?? 3),
          triggerEventId: attributes.event_id ?? eventForSpan(span)?.eventId ?? null,
          payoffFunction: attributes.payoff_function ?? 'requires semantic confirmation',
          evidenceSpans,
          confidence: Number(attributes.confidence ?? 0.7),
          status: evidenceSpans.length ? 'provisional' : 'unresolved'
        })
      } else if (className.includes('event')) {
        const span = evidenceSpans[0]
        const scene = sceneForSpan(span) ?? ledger.scenes[0]
        ledger.events.push({
          eventId: `LX-EVENT-${String(ledger.events.length + 1).padStart(3, '0')}`,
          order: ledger.events.length,
          sceneId: attributes.scene_id ?? scene?.sceneId ?? null,
          participants: [],
          action: attributes.action ?? record.text,
          result: attributes.result ?? 'requires semantic confirmation',
          causeEventIds: [],
          evidenceSpans,
          confidence: Number(attributes.confidence ?? 0.7),
          status: evidenceSpans.length && scene ? 'provisional' : 'unresolved'
        })
      } else if (className.includes('distinctive') || className.includes('signature')) {
        ledger.distinctiveExpressions.push({
          expressionId: `LX-EXPR-${String(ledger.distinctiveExpressions.length + 1).padStart(3, '0')}`,
          text: record.text,
          evidenceSpans,
          status: evidenceSpans.length ? 'provisional' : 'unresolved'
        })
      }
    }
  }
  ledger.adapters = unique(ledger.adapters)
  return ledger
}

export const validateEvidenceLedger = ({ ledger, sourceText, sourceRecord }) => {
  const diagnostics = []
  if (ledger.sourceId !== sourceRecord.sourceId) diagnostics.push(createDiagnostic('EXTRACTION_SOURCE_ID_MISMATCH', 'error', 'Extraction sourceId does not match the source record.'))
  if (ledger.sourceHash !== sourceRecord.contentHash) diagnostics.push(createDiagnostic('EXTRACTION_SOURCE_HASH_MISMATCH', 'error', 'Extraction sourceHash does not match normalized source content.'))

  const collections = ['scenes', 'characters', 'relationships', 'events', 'emotionNodes', 'distinctiveExpressions', 'dialogue', 'langExtractRecords', 'scriptBreakRecords']
  for (const collection of collections) {
    for (const [index, record] of (ledger[collection] ?? []).entries()) {
      const spans = record.evidenceSpans ?? []
      if (!spans.length && record.status !== 'unresolved') {
        diagnostics.push(createDiagnostic('EXTRACTION_RECORD_UNGROUNDED', 'error', `${collection} record has no evidence span.`, { path: `${collection}[${index}]` }))
      }
      for (const [spanIndex, span] of spans.entries()) {
        if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > sourceText.length) {
          diagnostics.push(createDiagnostic('EVIDENCE_RANGE_INVALID', 'error', 'Evidence range is outside the normalized source.', { path: `${collection}[${index}].evidenceSpans[${spanIndex}]`, evidence: span }))
          continue
        }
        const expected = sha256(sourceText.slice(span.start, span.end))
        if (span.quoteHash !== expected) diagnostics.push(createDiagnostic('EVIDENCE_HASH_MISMATCH', 'error', 'Evidence quoteHash is stale or incorrect.', { path: `${collection}[${index}].evidenceSpans[${spanIndex}]` }))
      }
    }
  }

  const sceneIds = new Set((ledger.scenes ?? []).map(item => item.sceneId))
  const characterIds = new Set((ledger.characters ?? []).map(item => item.characterId))
  const eventIds = new Set((ledger.events ?? []).map(item => item.eventId))
  const ids = [
    ...[...(ledger.scenes ?? [])].map(item => item.sceneId),
    ...[...(ledger.characters ?? [])].map(item => item.characterId),
    ...[...(ledger.relationships ?? [])].map(item => item.relationshipId),
    ...[...(ledger.events ?? [])].map(item => item.eventId),
    ...[...(ledger.emotionNodes ?? [])].map(item => item.emotionNodeId)
  ].filter(Boolean)
  if (ids.length !== new Set(ids).size) diagnostics.push(createDiagnostic('EXTRACTION_ID_DUPLICATE', 'error', 'Extraction stable IDs must be unique across record types.'))
  for (const [index, event] of (ledger.events ?? []).entries()) {
    if (!sceneIds.has(event.sceneId)) diagnostics.push(createDiagnostic('EXTRACTION_EVENT_SCENE_UNRESOLVED', 'error', `Event ${event.eventId} references an unknown scene.`, { path: `events[${index}].sceneId` }))
    for (const characterId of event.participants ?? []) {
      if (!characterIds.has(characterId)) diagnostics.push(createDiagnostic('EXTRACTION_EVENT_CHARACTER_UNRESOLVED', 'error', `Event ${event.eventId} references unknown character ${characterId}.`))
    }
    for (const causeId of event.causeEventIds ?? []) {
      if (!eventIds.has(causeId)) diagnostics.push(createDiagnostic('EXTRACTION_EVENT_CAUSE_UNRESOLVED', 'error', `Event ${event.eventId} references unknown cause ${causeId}.`))
    }
  }
  return diagnostics
}

export const sourceSpecificTerms = ledger => unique([
  ...(ledger.characters ?? []).flatMap(item => [item.displayName, ...(item.aliases ?? [])]),
  ...(ledger.distinctiveExpressions ?? []).map(item => item.text)
].filter(value => typeof value === 'string' && value.trim().length >= 2).map(value => value.trim()))

export const structuralProjectId = title => `rewrite-${slug(title, 'project')}`
