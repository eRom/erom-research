import { test, expect } from 'bun:test'
import { normURL, corroborationOf, ingestRound, rankClaimsForRedTeam, applyRedTeam, computeCoverage, renderReportMarkdown, aggregateVotes } from '../deep-research-lib.mjs'

test('normURL strips www and trailing slash, lowercases', () => {
  expect(normURL('https://www.Example.com/Path/')).toBe('example.com/path')
})

test('corroborationOf: >=2 distinct domains = independent', () => {
  expect(corroborationOf({ sources: ['https://a.com/1', 'https://b.com/2'] })).toBe('independent')
  expect(corroborationOf({ sources: ['https://a.com/1', 'https://a.com/2'] })).toBe('single-source')
})

test('ingestRound dedups by primary url + claim prefix', () => {
  const state = { findings: [], seenKeys: new Set(), failedAngles: [] }
  const round = [{ angle: 'x', status: 'ok', findings: [
    { claim: 'C1', sources: ['https://a.com'], sourceQuality: 'primary', importance: 'central' },
    { claim: 'C1', sources: ['https://a.com'], sourceQuality: 'primary', importance: 'central' },
  ]}]
  expect(ingestRound(round, state, 1)).toBe(1)
  expect(state.findings.length).toBe(1)
  expect(state.findings[0].confidence).toBe('high')
})

test('ingestRound records failed angles', () => {
  const state = { findings: [], seenKeys: new Set(), failedAngles: [] }
  ingestRound([{ angle: 'dead', status: 'failed' }], state, 1)
  expect(state.failedAngles).toEqual(['dead'])
})

test('rankClaimsForRedTeam keeps central/single-source, respects limit', () => {
  const findings = [
    { claim: 'a', importance: 'central', corroboration: 'independent' },
    { claim: 'b', importance: 'tangential', corroboration: 'single-source' },
    { claim: 'c', importance: 'supporting', corroboration: 'independent' },
  ]
  const r = rankClaimsForRedTeam(findings, 5)
  expect(r.map(f => f.claim).sort()).toEqual(['a', 'b'])
})

test('applyRedTeam kills, downgrades, holds', () => {
  const findings = [
    { claim: 'k', confidence: 'high' }, { claim: 'd', confidence: 'high' }, { claim: 'h', confidence: 'high' },
  ]
  const verdicts = [
    { claim: 'k', verdict: 'kill' },
    { claim: 'd', verdict: 'downgrade', newConfidence: 'low' },
    { claim: 'h', verdict: 'hold' },
  ]
  const r = applyRedTeam(findings, verdicts)
  expect(r.map(f => f.claim)).toEqual(['d', 'h'])
  expect(r.find(f => f.claim === 'd').confidence).toBe('low')
})

test('renderReportMarkdown: sourceTool paramétrable, défaut agy', () => {
  const report = { tldr: [], findings: [], coverage: {}, conclusion: { recommendation: 'R', overallConfidence: 'high' }, references: [] }
  const base = { title: 'T', depth: 'L', rounds: 1, converged: true, date: '2026-08-12' }
  expect(renderReportMarkdown(report, base)).toContain('source_tool: erom-research:agy')
  const claude = renderReportMarkdown(report, { ...base, sourceTool: 'erom-research:claude', engine: 'claude' })
  expect(claude).toContain('source_tool: erom-research:claude')
  expect(claude).toContain('engine: claude')
})

test('renderReportMarkdown emits French scaffolding, no Spanish', () => {
  const md = renderReportMarkdown(
    { tldr: ['x'], findings: [{ statement: 'S', type: 'evidence', confidence: 'high', sources: ['https://a.com'] }],
      coverage: { anglesCompleted: 1, anglesFailed: 0 }, conclusion: { recommendation: 'R', overallConfidence: 'high' }, references: [] },
    { title: 'T', depth: 'L', rounds: 1, converged: true, date: '2026-07-17' })
  expect(md.startsWith('---\ntitle: "T"')).toBe(true)
  expect(md).toContain('## Couverture et confiance')
  expect(md).toContain('[PREUVE · high]')
  expect(md).not.toMatch(/## (Contexto|Conclusión|Referencias|Cobertura)/)
})

test('aggregateVotes: unanimité hold', () => {
  const r = aggregateVotes([{ verdict: 'hold' }, { verdict: 'hold' }, { verdict: 'hold' }])
  expect(r.verdict).toBe('hold')
  expect(r.validVotes).toBe(3)
  expect(r.erroredVotes).toBe(0)
})

test('aggregateVotes: 2 kill sur 3 tuent la claim', () => {
  expect(aggregateVotes([{ verdict: 'kill' }, { verdict: 'kill' }, { verdict: 'hold' }]).verdict).toBe('kill')
})

test('aggregateVotes: 1 kill isolé ne suffit pas', () => {
  expect(aggregateVotes([{ verdict: 'kill' }, { verdict: 'hold' }, { verdict: 'hold' }]).verdict).toBe('hold')
})

test('aggregateVotes: cas mixte kill+downgrade compte 2 votes contre', () => {
  const r = aggregateVotes([{ verdict: 'kill' }, { verdict: 'downgrade', newConfidence: 'medium' }, { verdict: 'hold' }])
  expect(r.verdict).toBe('downgrade')
  expect(r.newConfidence).toBe('medium')
})

test('aggregateVotes: retient la confiance la plus basse proposée', () => {
  const r = aggregateVotes([
    { verdict: 'downgrade', newConfidence: 'medium' },
    { verdict: 'downgrade', newConfidence: 'low' },
    { verdict: 'downgrade', newConfidence: 'high' },
  ])
  expect(r.newConfidence).toBe('low')
})

test('aggregateVotes: moins de 2 votes valides = unverified', () => {
  const r = aggregateVotes([{ verdict: 'hold' }, null, null])
  expect(r.verdict).toBe('unverified')
  expect(r.validVotes).toBe(1)
  expect(r.erroredVotes).toBe(2)
  expect(aggregateVotes([null, null, null]).verdict).toBe('unverified')
  expect(aggregateVotes(undefined).verdict).toBe('unverified')
})

test('aggregateVotes: 2 votes valides suffisent à trancher malgré 1 planté', () => {
  const r = aggregateVotes([{ verdict: 'kill' }, { verdict: 'kill' }, null])
  expect(r.verdict).toBe('kill')
  expect(r.erroredVotes).toBe(1)
})

test('aggregateVotes: remonte la première source réfutante disponible', () => {
  const r = aggregateVotes([
    { verdict: 'kill', refutingSource: 'https://x.com', refutingEvidence: 'E' },
    { verdict: 'kill' }, { verdict: 'hold' },
  ])
  expect(r.refutingSource).toBe('https://x.com')
  expect(r.refutingEvidence).toBe('E')
})

test('applyRedTeam conserve et marque une claim unverified', () => {
  const findings = [{ claim: 'u', confidence: 'high' }]
  const r = applyRedTeam(findings, [{ claim: 'u', verdict: 'unverified', validVotes: 1, erroredVotes: 2 }])
  expect(r.map(f => f.claim)).toEqual(['u'])
  expect(r[0].redteam.verdict).toBe('unverified')
  expect(r[0].redteam.erroredVotes).toBe(2)
  expect(r[0].confidence).toBe('high')
})

test('computeCoverage compte les claims non vérifiables', () => {
  const state = { findings: [
    { sources: ['https://a.com'], importance: 'supporting', corroboration: 'independent', redteam: { verdict: 'unverified' } },
    { sources: ['https://b.com'], importance: 'supporting', corroboration: 'independent', redteam: { verdict: 'hold' } },
    { sources: ['https://c.com'], importance: 'supporting', corroboration: 'independent', redteam: null },
  ], failedAngles: [] }
  expect(computeCoverage(state, [{ label: 'x' }]).unverifiedClaims).toBe(1)
})

test('renderReportMarkdown signale les claims non vérifiables', () => {
  const md = renderReportMarkdown(
    { tldr: [], findings: [], coverage: { anglesCompleted: 1, anglesFailed: 0, unverifiedClaims: 2 },
      conclusion: { recommendation: 'R', overallConfidence: 'low' }, references: [] },
    { title: 'T', depth: 'L', rounds: 1, converged: false, date: '2026-08-12' })
  expect(md).toContain('non vérifiables : 2')
})
