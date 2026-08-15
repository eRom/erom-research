// Pure, node-testable helpers for the agy skill (plugin erom-research).
// SINGLE SOURCE OF TRUTH — these functions are inlined verbatim into
// deep-research.js (guarded by deep-research-sync.test.mjs).
// Keep dependency-free and side-effect-free.

export function normURL(u) {
  try {
    const p = new URL(u)
    return (p.hostname.replace(/^www\./, '') + p.pathname.replace(/\/+$/, '')).toLowerCase()
  } catch { return String(u).trim().toLowerCase() }
}

export function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase() }
  catch { return String(u).trim().toLowerCase() }
}

export function distinctDomains(sources) {
  const set = new Set()
  for (const s of sources || []) set.add(domainOf(s))
  return set.size
}

export function corroborationOf(finding) {
  return distinctDomains(finding.sources) >= 2 ? 'independent' : 'single-source'
}

function initialConfidence(sourceQuality) {
  if (sourceQuality === 'primary') return 'high'
  if (sourceQuality === 'secondary') return 'medium'
  return 'low'
}

export function ingestRound(roundResults, state, round) {
  let novel = 0
  for (const res of roundResults || []) {
    if (!res || res.status === 'failed') { if (res && res.angle) state.failedAngles.push(res.angle); continue }
    for (const f of res.findings || []) {
      const primary = (f.sources && f.sources[0]) || ''
      const key = normURL(primary) + '::' + String(f.claim || '').slice(0, 60).toLowerCase()
      if (state.seenKeys.has(key)) continue
      state.seenKeys.add(key)
      const finding = {
        id: 'f' + state.findings.length, claim: f.claim, evidence: f.evidence || '',
        sources: f.sources || [], sourceQuality: f.sourceQuality || 'unreliable',
        importance: f.importance || 'supporting', recency: f.recency || 'unknown',
        angle: res.angle, round, confidence: initialConfidence(f.sourceQuality), corroboration: null, redteam: null,
      }
      finding.corroboration = corroborationOf(finding)
      state.findings.push(finding)
      novel++
    }
  }
  return novel
}

export function isConverged(opts) {
  const { coverage, matrix, lastRoundChangedMaterially, openCriticalThreads } = opts || {}
  const critical = (matrix || []).filter(m => m.recommendationChanging)
  const allAnswered = critical.every(m => {
    const c = (coverage || []).find(x => x.matrixId === m.id)
    return c && c.status === 'answered' && c.corroboration === 'independent'
  })
  return allAnswered && !lastRoundChangedMaterially && (openCriticalThreads || 0) === 0
}

export function computeCoverage(state, angles, verdicts) {
  const allSources = state.findings.flatMap(f => f.sources || [])
  const domains = new Set(allSources.map(domainOf))
  const penalties = []
  for (const f of state.findings) {
    if (f.importance === 'central' && f.corroboration === 'single-source') {
      penalties.push('Central claim from a single source: "' + String(f.claim).slice(0, 60) + '"')
    }
  }
  return {
    anglesCompleted: (angles ? angles.length : 0) - state.failedAngles.length,
    anglesFailed: state.failedAngles.length,
    failedAngleLabels: [...state.failedAngles],
    sourceCount: new Set(allSources.map(normURL)).size,
    distinctDomains: domains.size,
    unverifiedClaims: state.findings.filter(f => f.redteam && f.redteam.verdict === 'unverified').length,
    killedClaims: (verdicts || []).filter(v => v && v.verdict === 'kill').length,
    unresolvedCriticalGaps: [],
    confidencePenalties: penalties,
  }
}

const _impRank = { central: 0, supporting: 1, tangential: 2 }
export function rankClaimsForRedTeam(findings, limit) {
  return [...findings]
    .filter(f => f.importance === 'central' || f.corroboration === 'single-source')
    .sort((a, b) =>
      (_impRank[a.importance] - _impRank[b.importance]) ||
      ((a.corroboration === 'single-source' ? 0 : 1) - (b.corroboration === 'single-source' ? 0 : 1)))
    .slice(0, limit)
}

export function applyRedTeam(findings, verdicts) {
  const byClaim = new Map()
  for (const v of verdicts || []) if (v && v.claim) byClaim.set(v.claim, v)
  const result = []
  for (const f of findings) {
    const v = byClaim.get(f.claim)
    // Skip killed findings (do not add to result)
    if (v && v.verdict === 'kill') continue
    // Create new finding object (shallow copy) — never mutate input
    const newFinding = { ...f }
    // Add redteam field if verdict exists
    if (v) {
      newFinding.redteam = {
        verdict: v.verdict, refutingSource: v.refutingSource || null, evidence: v.refutingEvidence || '',
        ...(v.validVotes !== undefined ? { validVotes: v.validVotes, erroredVotes: v.erroredVotes } : {}),
      }
      if (v.verdict === 'downgrade') {
        newFinding.confidence = v.newConfidence || 'low'
      }
    }
    result.push(newFinding)
  }
  return result
}

export function aggregateVotes(verdicts, opts) {
  const { votesCast = 3, threshold = 2 } = opts || {}
  const valid = (verdicts || []).filter(Boolean)
  const erroredVotes = Math.max(0, votesCast - valid.length)
  const base = { validVotes: valid.length, erroredVotes }
  if (valid.length < threshold) return { ...base, verdict: 'unverified' }
  const kills = valid.filter(v => v.verdict === 'kill')
  const downs = valid.filter(v => v.verdict === 'downgrade')
  const against = [...kills, ...downs]
  if (against.length < threshold) return { ...base, verdict: 'hold' }
  const src = against.find(v => v.refutingSource) || against[0]
  const cited = { refutingSource: src.refutingSource || null, refutingEvidence: src.refutingEvidence || '' }
  if (kills.length >= threshold) return { ...base, ...cited, verdict: 'kill' }
  const RANK = { low: 0, medium: 1, high: 2 }
  const lowest = against
    .map(v => v.newConfidence)
    .filter(c => c && Object.prototype.hasOwnProperty.call(RANK, c))
    .sort((a, b) => RANK[a] - RANK[b])[0] || 'low'
  return { ...base, ...cited, verdict: 'downgrade', newConfidence: lowest }
}

export function renderReportMarkdown(report, meta) {
  const L = []
  L.push([
    '---', `title: "${meta.title}"`, 'type: research',
    `source_tool: ${meta.sourceTool || 'erom-research:agy'}`,
    ...(meta.engine ? [`engine: ${meta.engine}`] : []),
    ...(meta.project ? [`project: ${meta.project}`] : []),
    `depth: ${meta.depth}`, `rounds: ${meta.rounds}`, `converged: ${meta.converged}`,
    `created: ${meta.date}`, 'sensitivity: internal', '---', '',
  ].join('\n'))
  L.push(`# ${meta.title}\n`)
  if (report.tldr && report.tldr.length) { L.push('## TL;DR'); for (const b of report.tldr) L.push(`- ${b}`); L.push('') }
  if (report.context) { L.push('## Contexte'); L.push(report.context + '\n') }
  if (report.findings && report.findings.length) {
    L.push('## Findings')
    const TAG = { evidence:'PREUVE', inference:'INFÉRENCE', assumption:'HYPOTHÈSE' }
    for (const f of report.findings) {
      const refs = (f.sources || []).map(s => `[${s}](${s})`).join(', ')
      L.push(`- **[${TAG[f.type] || f.type} · ${f.confidence}]** ${f.statement}${f.caveats ? ` _(${f.caveats})_` : ''}${refs ? ` — ${refs}` : ''}`)
    }
    L.push('')
  }
  if (report.comparisons) { L.push('## Comparaisons'); L.push(report.comparisons + '\n') }
  if (report.risksCounterarguments && report.risksCounterarguments.length) {
    L.push('## Risques et contre-arguments'); for (const r of report.risksCounterarguments) L.push(`- ${r}`); L.push('')
  }
  const a = report.appliedRecommendation
  if (a && a.applies) {
    L.push('## Recommandation appliquée'); L.push(a.recommendation + '\n')
    if (a.rationale) L.push(`**Pourquoi :** ${a.rationale}\n`)
    if (a.groundedContext) L.push(`**Contexte local :** ${a.groundedContext}\n`)
  }
  if (report.evidenceGaps && report.evidenceGaps.length) {
    L.push('## Lacunes de preuve'); for (const g of report.evidenceGaps) L.push(`- ${g}`); L.push('')
  }
  const c = report.coverage || {}
  L.push('## Couverture et confiance')
  L.push(`- Angles complétés : ${c.anglesCompleted ?? '?'} · échoués : ${c.anglesFailed ?? 0}${(c.failedAngleLabels && c.failedAngleLabels.length) ? ` (${c.failedAngleLabels.join(', ')})` : ''}`)
  L.push(`- Sources : ${c.sourceCount ?? '?'} · domaines distincts : ${c.distinctDomains ?? '?'}`)
  if (c.unverifiedClaims) L.push(`- Claims non vérifiables : ${c.unverifiedClaims} (vérificateurs en échec, ni confirmés ni réfutés)`)
  if (c.killedClaims) L.push(`- Claims écartées par le vote : ${c.killedClaims} (au moins 2 voix sur 3 en kill)`)
  if (c.unresolvedCriticalGaps && c.unresolvedCriticalGaps.length) { L.push('- Lacunes critiques non résolues :'); for (const g of c.unresolvedCriticalGaps) L.push(`  - ${g}`) }
  if (c.confidencePenalties && c.confidencePenalties.length) { L.push('- Pénalités de confiance :'); for (const p of c.confidencePenalties) L.push(`  - ${p}`) }
  L.push('')
  if (report.conclusion) { L.push('## Conclusion'); L.push(`${report.conclusion.recommendation}\n`); L.push(`**Confiance globale :** ${report.conclusion.overallConfidence}\n`) }
  if (report.references && report.references.length) {
    L.push('## Références'); for (const r of report.references) L.push(`${r.n}. [${r.title}](${r.url}) — ${[r.type, r.date].filter(Boolean).join(', ')}`); L.push('')
  }
  return L.join('\n')
}
