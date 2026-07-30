import { test, expect } from 'bun:test'
import { normURL, corroborationOf, ingestRound, rankClaimsForRedTeam, applyRedTeam, renderReportMarkdown } from '../deep-agy-lib.mjs'

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
