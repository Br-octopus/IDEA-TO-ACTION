import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../../dsh-plugin/forward-step-dsh/core/store.js'
import { applyAcademicAction, buildAcademicPrompt, createAcademicProject, createAcademicReviewProject, importBibliographyEntries, parseBibliographyImport, previewAcademicProject, previewBibliographyImport, saveAcademicProject } from '../../dsh-plugin/forward-step-dsh/core/academic.js'

const tx = (store, eventId) => ({ expectedRevision: store.read().revision, eventId })

test('插件学术核心不再运行时加载旧学术实现', async () => {
  const source = await readFile(new URL('../../dsh-plugin/forward-step-dsh/core/academic.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /createRequire|vendor\/core\/academic-(?:literature|review|publishing)/u)
})

test('RIS 和 BibTeX 预览保留可识别字段与未知字段', () => {
  const ris = 'TY  - JOUR\nTI  - Study title\nAU  - Lee, A\nPY  - 2025\nDO  - 10.1000/EXAMPLE\nAB  - User abstract\nKW  - methods\nN1  - Untrusted note\nER  -'
  const result = previewBibliographyImport(ris, 'ris')
  assert.equal(result.entries[0].literature.doi, '10.1000/example')
  assert.equal(result.entries[0].literature.abstractExcerpt, 'User abstract')
  assert.deepEqual(result.entries[0].keywords, ['methods'])
  assert.deepEqual(result.entries[0].literature.importedFields.N1, ['Untrusted note'])
  assert.equal(result.unknownFields[0].field, 'N1')
  const bib = '@article{one, title={Nested {title}}, author={Lee, A and Kim, B}, year={2024}, journal={Journal X}, doi={10.1000/one}, note={Imported note}}'
  const bibResult = previewBibliographyImport(bib, 'bibtex')
  assert.equal(bibResult.entries[0].title, 'Nested {title}')
  assert.deepEqual(bibResult.entries[0].literature.authors, ['Lee, A', 'Kim, B'])
  assert.deepEqual(bibResult.entries[0].literature.importedFields.note, ['Imported note'])
})

test('题录导入保留未知字段并按规范化 DOI 去重', async () => {
  const store = openStore(':memory:')
  try {
    const firstPreview = previewBibliographyImport('TY  - JOUR\nTI  - Study\nDO  - 10.1000/a\nN1  - Extra\nER  -', 'ris')
    const first = await importBibliographyEntries(store, firstPreview.entries, tx(store, 'lit-one'))
    assert.equal(first.entries[0].type, 'academic-literature')
    assert.deepEqual(first.entries[0].literature.importedFields.N1, ['Extra'])
    const duplicate = previewBibliographyImport('TY  - JOUR\nTI  - Other title\nDO  - https://doi.org/10.1000/A\nER  -', 'ris', store.read().knowledgeEntries)
    assert.equal(duplicate.entries.length, 0)
    assert.equal(duplicate.duplicates[0].duplicateOf, first.entries[0].id)
    const revision = store.read().revision
    await importBibliographyEntries(store, parseBibliographyImport('TY  - JOUR\nTI  - Other title\nDO  - https://doi.org/10.1000/A\nER  -', 'ris').entries, tx(store, 'lit-two'))
    assert.equal(store.read().revision, revision)
    assert.equal(store.read().knowledgeEntries.length, 1)
  } finally { store.close() }
})

test('项目未知字段会进入预览并在保存后保留', async () => {
  const store = openStore(':memory:')
  try {
    const input = { ...createAcademicProject({ id: 'pub-1', title: 'Submission' }), extension: { note: 'preserve' } }
    const preview = previewAcademicProject(input)
    assert.equal(preview.unknownFields[0].path, 'extension')
    const saved = await saveAcademicProject(store, preview.project, tx(store, 'pub-save'))
    assert.deepEqual(saved.extension, { note: 'preserve' })
  } finally { store.close() }
})

test('嵌套未知字段会显示在预览并在保存后保留，悬空引用保存失败', async () => {
  const store = openStore(':memory:')
  try {
    const project = createAcademicReviewProject({ id: 'nested-extra', title: 'Review', question: 'Question', scope: 'Scope' })
    project.extension = { notes: [{ source: 'manual', extra: true }] }
    const preview = previewAcademicProject(project)
    assert.deepEqual(preview.unknownFields.map(item => item.path), ['extension'])
    const saved = await saveAcademicProject(store, preview.project, tx(store, 'nested-extra-save'))
    assert.deepEqual(saved.extension, { notes: [{ source: 'manual', extra: true }] })

    const publishing = createAcademicProject({ id: 'dangling-ref', title: 'Paper' })
    publishing.citationClaims.push({ id: 'claim', statement: 'Claim', manuscriptLocation: 'p. 1', sources: [{ id: 'source', knowledgeEntryId: 'missing-entry' }] })
    await assert.rejects(saveAcademicProject(store, publishing, tx(store, 'dangling-ref-save')), { code: 'missing_dependency' })
  } finally { store.close() }
})

test('综述筛选保留双人意见，裁定后才能进入全文和证据阶段', async () => {
  const store = openStore(':memory:')
  try {
    const project = createAcademicReviewProject({ id: 'rev-1', title: 'Review', question: 'Question?', scope: 'Scope', reviewType: 'systematic-review', screeningModel: 'two-reviewers' })
    await saveAcademicProject(store, project, tx(store, 'rev-create'))
    const entry = previewBibliographyImport('TY  - JOUR\nTI  - Evidence\nAB  - User excerpt\nDO  - 10.1000/evidence\nER  -', 'ris').entries[0]
    const imported = await importBibliographyEntries(store, [entry], tx(store, 'rev-lit'))
    const entryId = imported.entries[0].id
    await applyAcademicAction(store, project.id, 'addLiteratureRecords', [[entryId]], tx(store, 'rev-add'))
    let savedProject = store.read().academicResponseProjects[0]
    const recordId = savedProject.records[0].id
    await assert.rejects(applyAcademicAction(store, project.id, 'setFullTextDecision', [recordId, { decision: 'include', userConfirmedFullText: false }], tx(store, 'rev-early-full')), { code: 'invalid_input' })
    await applyAcademicAction(store, project.id, 'setScreeningDecision', [recordId, 'title-abstract', 'reviewerOne', { decision: 'include', evidence: 'Abstract only' }], tx(store, 'rev-one'))
    await applyAcademicAction(store, project.id, 'setScreeningDecision', [recordId, 'title-abstract', 'reviewerTwo', { decision: 'exclude', reason: 'Scope mismatch' }], tx(store, 'rev-two'))
    savedProject = store.read().academicResponseProjects[0]
    assert.equal(savedProject.records[0].screening.titleAbstract.reviewerOne.decision, 'include')
    assert.equal(savedProject.records[0].screening.titleAbstract.reviewerTwo.decision, 'exclude')
    await applyAcademicAction(store, project.id, 'adjudicateScreeningDecision', [recordId, { decision: 'include', reason: 'Manual decision' }], tx(store, 'rev-adjudicate'))
    await applyAcademicAction(store, project.id, 'setFullTextDecision', [recordId, { decision: 'include', userConfirmedFullText: true, location: 'page 4' }], tx(store, 'rev-full'))
    await applyAcademicAction(store, project.id, 'updateExtractionFields', [[{ id: 'finding', label: 'Finding' }]], tx(store, 'rev-fields'))
    const updated = await applyAcademicAction(store, project.id, 'setExtractionValue', [recordId, 'finding', { value: 'Result', evidence: 'User-selected passage', sourceLocation: 'page 4, table 2', confirmed: true }], tx(store, 'rev-evidence'))
    assert.equal(updated.project.records[0].extraction.finding.sourceLocation, 'page 4, table 2')
    assert.equal(updated.project.records[0].extraction.finding.confirmed, false, '写入提取值不能绕过人工核对')
    await assert.rejects(applyAcademicAction(store, project.id, 'confirmExtractionValue', [recordId, 'missing'], tx(store, 'rev-confirm-missing')), { code: 'not_found' })
    await applyAcademicAction(store, project.id, 'setExtractionValue', [recordId, 'finding', { value: 'Result', evidence: '', sourceLocation: '' }], tx(store, 'rev-evidence-incomplete'))
    await assert.rejects(applyAcademicAction(store, project.id, 'confirmExtractionValue', [recordId, 'finding'], tx(store, 'rev-confirm-incomplete')), { code: 'invalid_input' })
    await applyAcademicAction(store, project.id, 'setExtractionValue', [recordId, 'finding', { value: 'Result', evidence: 'User-selected passage', sourceLocation: 'page 4, table 2' }], tx(store, 'rev-evidence-complete'))
    const confirmed = await applyAcademicAction(store, project.id, 'confirmExtractionValue', [recordId, 'finding'], tx(store, 'rev-confirm'))
    assert.equal(confirmed.project.records[0].extraction.finding.confirmed, true)
    const prompt = buildAcademicPrompt(confirmed.project, 'review-extraction', [recordId])
    assert.match(prompt, /Evidence/u)
    assert.match(prompt, /User excerpt/u)
  } finally { store.close() }
})

test('双人筛选必须意见一致或人工裁定才能进入全文阶段', async () => {
  const store = openStore(':memory:')
  try {
    const project = createAcademicReviewProject({ id: 'consensus', title: 'Review', question: 'Q', scope: 'S', reviewType: 'systematic-review', screeningModel: 'two-reviewers' })
    await saveAcademicProject(store, project, tx(store, 'consensus-create'))
    const entry = previewBibliographyImport('TY  - JOUR\nTI  - Consensus source\nER  -', 'ris').entries[0]
    const imported = await importBibliographyEntries(store, [entry], tx(store, 'consensus-lit'))
    await applyAcademicAction(store, project.id, 'addLiteratureRecords', [[imported.entries[0].id]], tx(store, 'consensus-add'))
    const recordId = store.read().academicResponseProjects[0].records[0].id
    await applyAcademicAction(store, project.id, 'setScreeningDecision', [recordId, 'title-abstract', 'reviewerOne', { decision: 'include' }], tx(store, 'consensus-one'))
    await assert.rejects(applyAcademicAction(store, project.id, 'setFullTextDecision', [recordId, { decision: 'include', userConfirmedFullText: true }], tx(store, 'consensus-premature')), { code: 'invalid_input' })
    await applyAcademicAction(store, project.id, 'setScreeningDecision', [recordId, 'title-abstract', 'reviewerTwo', { decision: 'include' }], tx(store, 'consensus-two'))
    const result = await applyAcademicAction(store, project.id, 'setFullTextDecision', [recordId, { decision: 'include', userConfirmedFullText: true }], tx(store, 'consensus-full'))
    assert.equal(result.project.records[0].screening.fullText.decision, 'include')
  } finally { store.close() }
})

test('投稿引用必须关联插件学术资料，审稿回复按轮次保留实际修改记录', async () => {
  const store = openStore(':memory:')
  try {
    const project = createAcademicProject({ id: 'pub-2', title: 'Submission', target: { venue: 'Journal Z', manuscriptVersion: 'v2' } })
    await saveAcademicProject(store, project, tx(store, 'pub-create'))
    const entry = previewBibliographyImport('TY  - JOUR\nTI  - Local source\nDO  - 10.1000/local\nER  -', 'ris').entries[0]
    const imported = await importBibliographyEntries(store, [entry], tx(store, 'pub-lit'))
    await assert.rejects(applyAcademicAction(store, project.id, 'addCitationClaim', [{ statement: 'Claim', sources: [{ knowledgeEntryId: 'missing' }] }], tx(store, 'pub-bad-claim')), { code: 'missing_dependency' })
    await applyAcademicAction(store, project.id, 'addCitationClaim', [{ id: 'claim-1', statement: 'Supported claim', manuscriptLocation: 'page 2', sources: [{ knowledgeEntryId: imported.entries[0].id, relation: 'supports', evidenceExcerpt: 'Observed evidence', evidenceLocation: 'page 5' }] }], tx(store, 'pub-claim'))
    assert.equal(store.read().academicResponseProjects[0].citationClaims[0].sources[0].snapshot.title, 'Local source')
    await applyAcademicAction(store, project.id, 'addRequirementCard', [{ id: 'req-1', title: 'Ethics statement', body: 'Include approval details' }], tx(store, 'pub-requirement'))
    await applyAcademicAction(store, project.id, 'addChecklistItem', [{ id: 'check-1', title: 'Ethics statement', requirementId: 'req-1' }], tx(store, 'pub-checklist'))
    await applyAcademicAction(store, project.id, 'updateChecklistItem', ['check-1', { evidence: 'Approval recorded' }], tx(store, 'pub-checklist-evidence'))
    const citationPrompt = buildAcademicPrompt(store.read().academicResponseProjects[0], 'citation-check', ['claim-1'])
    assert.match(citationPrompt, /Supported claim/u)
    assert.match(citationPrompt, /Observed evidence/u)
    assert.match(citationPrompt, /仅检查用户选定/u)
    const submissionPrompt = buildAcademicPrompt(store.read().academicResponseProjects[0], 'submission-prep', ['check-1'])
    assert.match(submissionPrompt, /Include approval details/u)
    assert.match(submissionPrompt, /Approval recorded/u)
    assert.doesNotMatch(submissionPrompt, /Supported claim/u)
    await applyAcademicAction(store, project.id, 'addReviewerRound', [{ id: 'round-1', title: 'Round one' }], tx(store, 'pub-round'))
    await applyAcademicAction(store, project.id, 'addReviewerComment', ['round-1', { id: 'comment-1', reviewer: 'Reviewer 1', rawComment: 'Explain the analysis.' }], tx(store, 'pub-comment'))
    const resolved = await applyAcademicAction(store, project.id, 'resolveReviewerComment', ['round-1', 'comment-1', { status: 'revised', responseDraft: 'We clarified it.', changeSummary: 'Added limitations.', changeLocation: 'page 6' }], tx(store, 'pub-resolve'))
    assert.equal(resolved.project.reviewerRounds[0].comments[0].status, 'revised')
    const prompt = buildAcademicPrompt(resolved.project, 'reviewer-response', ['comment-1'])
    assert.match(prompt, /Round one/u)
    assert.match(prompt, /Added limitations/u)
    assert.match(prompt, /不得编造/u)
  } finally { store.close() }
})

test('学术项目和提示词轮次在 SQLite 关闭重开后恢复', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-academic-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = join(directory, 'academic.sqlite')
  let store = openStore(filename)
  try {
    const project = createAcademicReviewProject({ id: 'persisted-review', title: 'Persisted review', question: 'Question', scope: 'Scope' })
    await saveAcademicProject(store, project, tx(store, 'persist-project'))
    await applyAcademicAction(store, project.id, 'addPromptRound', [{ kind: 'review-screening', selectedIds: ['record-1'], prompt: 'User-inspected prompt' }], tx(store, 'persist-prompt'))
  } finally { store.close() }
  store = openStore(filename)
  try {
    const restored = store.read().academicResponseProjects[0]
    assert.equal(restored.id, 'persisted-review')
    assert.equal(restored.promptRounds[0].prompt, 'User-inspected prompt')
    assert.deepEqual(restored.promptRounds[0].selectedIds, ['record-1'])
  } finally { store.close() }
})
