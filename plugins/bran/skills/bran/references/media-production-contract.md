# Media-production contract

Use this optional extension when a validated Bran story package continues into storyboard preparation, image or video generation, media selection, timeline assembly, or export.

## Contents

- [Boundary](#boundary)
- [Required files](#required-files)
- [State separation](#state-separation)
- [Generation preparation](#generation-preparation)
- [Continuity and identity](#continuity-and-identity)
- [Task and media lifecycle](#task-and-media-lifecycle)
- [Security and receipts](#security-and-receipts)

## Boundary

Place production artifacts under `production/`. Keep the narrative `package/` authoritative for canon, action availability, world state, settlement, and endings. Production records may reference those truths; they may not mutate them.

Use stable IDs across the chain:

```text
project -> chapter -> narrative scene -> production shot
        -> extraction candidate -> reusable entity asset
        -> generation preparation -> task -> media asset -> export
```

Keep human review explicit. Treat model output as a candidate until a resolution record links, accepts, or ignores it.

## Required files

Once `media-production-manifest.json` exists, require the complete extension.

| File | Responsibility |
| --- | --- |
| `media-production-manifest.json` | Contract version, source package hash, artifact index, defaults, current production hash |
| `entity-assets.jsonl` | Reusable characters, actors, scenes, props, and costumes with identity and style anchors |
| `shot-production.jsonl` | Ordered shot semantics, narrative references, preparation, readiness, generation, and continuity |
| `extraction-candidates.jsonl` | Review state for extracted assets and dialogue |
| `prompt-templates.jsonl` | Versioned prompt templates, variables, categories, and content hashes |
| `model-profiles.jsonl` | Provider-neutral model capabilities and non-secret parameters |
| `generation-tasks.jsonl` | Business task truth, hashes, progress, cancellation, results, and executor provenance |
| `task-events.jsonl` | Ordered task-state transition evidence |
| `media-assets.jsonl` | Generated or uploaded media, hashes, source tasks, business links, and selection state |
| `export-manifest.json` | Shot order, accepted media, timeline clips, delivery format, and integrity hash |

### Manifest

Require these fields:

- `contractVersion`
- `sourcePackageVersion`
- `sourcePackageHash`
- `productionStatus`
- `defaultVideoRatio`
- `artifactIndex[]` with `artifactId` and `path`
- `artifactHashFiles[]`
- `artifactHash`

Exclude `media-production-manifest.json` from `artifactHashFiles` to avoid a circular hash. Compute `artifactHash` as SHA-256 of the sorted `filename + NUL + exact UTF-8 content` entries joined by NUL. Keep every required non-manifest file in `artifactIndex` and `artifactHashFiles`.

### Entity assets

Give every row:

- `entityId`
- `type`: `character / actor / scene / prop / costume`
- `name`
- `styleLock`
- `identityAnchors[]`
- `referenceMediaIds[]`

Require character and actor identity anchors. Preserve exact entity names in prompts and shot records. Record costumes and props as links, allowing the same character identity to carry controlled visual variants.

### Production shots

Give every row:

- `shotId`, `chapterId`, `order`
- `narrativeSceneId`, `actionRefs[]`, `dialogueIds[]`
- `entityRefs[]`
- `camera.shot`, `camera.angle`, `camera.movement`
- `durationSec`
- `actionBeats[]` with `beatId`, `text`, and optional `phase`
- `preparation`
- `videoReadiness`
- `generation`
- `continuity`

Use `trigger / peak / aftermath` as optional action-beat phase hints. Keep beats ordered even when no phase is assigned.

### Candidates

Use one row per extracted item:

- `candidateId`, `shotId`, `kind`, `source`, `evidenceRefs[]`
- `extractorRunId`, `extractorSchemaVersion`, `sourceInputHash`, `extractionResultHash`
- Asset candidate: `assetType`, status `pending / linked / ignored`, optional `linkedEntityId`
- Dialogue candidate: status `pending / accepted / ignored`, optional `linkedDialogueId`
- Resolved candidate: `confirmedAt`

Return a resolved candidate to `pending` when its linked entity or dialogue line is removed or replaced.

Cache structured extraction by source input hash, extractor schema version, and extractor profile hash. Reuse a cached result only while all three inputs match. Normalize field drift, validate the closed schema, and allow at most one correction retry before recording a failure for review.

## State separation

Keep four independent state machines.

### Preparation

```text
pending -> ready
ready -> pending when a linked candidate is reopened
```

Use only `pending` and `ready`. Derive `ready` from candidate closure, required shot fields, camera semantics, duration, and action beats.

### Video readiness

Compute readiness as the conjunction of named checks. At minimum include:

- extraction resolved
- duration present
- prompt derivable
- reference frames match the selected mode
- compatible model profile present
- provider configuration available at runtime
- no active conflicting video task

Store check results for reproducibility. Do not persist provider credentials or copy them into the receipt.

Use this minimum shape for preparation and readiness:

```json
{
  "preparation": {
    "status": "ready",
    "basicInfoReady": true,
    "semanticDefaultsReady": true,
    "actionBeatsReady": true,
    "candidatesResolved": true
  },
  "videoReadiness": {
    "ready": true,
    "checks": {
      "extractionResolved": true,
      "durationPresent": true,
      "promptDerivable": true,
      "referenceFramesReady": true,
      "compatibleModelProfilePresent": true,
      "providerConfigurationAvailable": true,
      "noActiveConflictingVideoTask": true
    }
  }
}
```

### Runtime tasks

```text
pending -> running -> streaming -> succeeded
                    -> failed
                    -> cancelled
pending -> cancelled
```

Allow `running -> succeeded` when no streaming delivery is used. Treat `succeeded`, `failed`, and `cancelled` as terminal.

### Media selection

```text
candidate -> accepted
          -> rejected
```

Export only accepted media. Keep rejected results for provenance unless retention policy requires deletion.

## Generation preparation

Use four layers for each generation kind:

| Layer | Meaning |
| --- | --- |
| `BaseDraft` | Editable business truth such as shot semantics or a base prompt |
| `Context` | Ordered references, adjacent shots, style locks, and current model capability |
| `DerivedPreview` | Rendered prompt, warnings, quality checks, and debug context |
| `SubmissionPayload` | Exact prompt, ordered references, parameters, and metadata sent to the provider |

Record `baseDraftHash`, `contextHash`, `derivedPreviewHash`, and `submissionHash` on every generation task. Re-derive before submission when the base or context changes.

Reference prompt templates by `promptTemplateId`, `promptTemplateVersion`, and `promptTemplateHash`. Reference models by `modelProfileId`; resolve credentials outside the package. Keep provider adapters behind shared image and video contracts.

Give each prompt template `promptTemplateId`, `version`, `category`, `template`, `variables[]`, and `contentHash`. Compute `contentHash` as SHA-256 of the exact template string. Give each model profile `modelProfileId`, `providerKey`, `modelName`, `category`, capability flags, and non-secret defaults. The template and profile category must match the task kind.

Give `shot.generation` a `referenceMode`, ordered `referenceMediaIds[]`, template ID, version and hash, and a video `modelProfileId`.

For reference modes, require exact counts and stable order:

| Mode | Ordered frames |
| --- | --- |
| `text_only` | none |
| `first` | first |
| `last` | last |
| `key` | key |
| `first_last` | first, last |
| `first_last_key` | first, last, key |

## Continuity and identity

Carry these constraints from preparation into both preview and submission:

- project style and visual-style lock
- character identity and actor references
- costume and prop links
- scene anchors
- target ratio and resolution profile
- previous-shot summary and next-shot goal
- composition anchor
- screen-direction and eyeline guidance
- ordered action beats and the current frame responsibility

Use first frames for the earliest visible trigger or incomplete reaction, key frames for the action or emotion peak, and last frames for aftermath and the next-shot handoff. Limit repeated guidance to the few constraints with the highest continuity risk, then record which constraints were kept or dropped and why.

## Task and media lifecycle

Treat the business task record as the truth source. Let external executors perform work, then write status, progress, result, error, cancellation, timestamps, and provider task IDs back into the business record.

Give every task:

- `taskId`, `kind`, `shotId`, `status`
- template ID, version, and content hash
- `modelProfileId`
- `baseDraftHash`, `contextHash`, `derivedPreviewHash`, `submissionHash`
- `resultMediaIds[]` for a succeeded task
- `finishedAt` for every terminal task

Give every task event `eventId`, `taskId`, `from`, `to`, and `at`. Begin with `null -> pending`, preserve a continuous transition chain, and make the last event state equal the task status.

Link each task to its shot and resource kind. Prevent duplicate active video tasks for the same shot. Check cancellation before provider execution, after result generation, and before applying outputs. Separate result generation from application so cached or retried output can be inspected before it mutates production records.

Give every generated media row:

- `mediaId`, `kind`, `status`
- `contentHash`, `storageUri`
- `sourceTaskId`
- `shotId` or `entityId`
- `role`, such as `first_frame / key_frame / last_frame / video / asset_reference`

Require a succeeded task to enumerate its `resultMediaIds`. Require each generated media item to point back to that task.

Give each export clip `clipId`, `shotId`, `mediaId`, and integer `order`. Give `delivery` at least a `format`. Compute `export-manifest.json.integrityHash` as SHA-256 of the compact JSON serialization of `{ clips, delivery }` in that key order.

## Security and receipts

Keep API keys, API secrets, passwords, bearer tokens, cookies, and signed URLs out of the extension. Model profiles may contain provider keys, model names, public base URLs, capability flags, and non-secret generation defaults.

Run:

```bash
node scripts/audit-production-package.mjs /absolute/path/to/handoff
```

Store the auditor output as a release receipt. Recompute it after any artifact change. Pair machine checks with human review of visual identity, action clarity, shot continuity, pacing, and edit quality.
