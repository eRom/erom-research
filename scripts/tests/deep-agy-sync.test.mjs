// scripts/tests/deep-agy-sync.test.mjs (plugin deep-research)
// Garde-fou : les helpers inlinés dans deep-agy.js doivent rester identiques
// à deep-agy-lib.mjs (les scripts Workflow ne peuvent pas importer de fichier local).
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const wf = readFileSync(join(here, '..', 'deep-agy.js'), 'utf8')
const lib = readFileSync(join(here, '..', 'deep-agy-lib.mjs'), 'utf8')

// Extrait le corps d'une fonction nommée `function NAME(...) { ... }` (accolades équilibrées).
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) return null
  let i = src.indexOf('{', start), depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  return null
}

// Helpers de calcul partagés (renderReportMarkdown n'est PAS inliné dans le workflow).
const SHARED = ['normURL', 'domainOf', 'distinctDomains', 'corroborationOf',
  'initialConfidence', 'ingestRound', 'isConverged', 'computeCoverage',
  'rankClaimsForRedTeam', 'applyRedTeam']

for (const name of SHARED) {
  test(`inline ${name} matches lib`, () => {
    const inWf = extractFn(wf, name)
    const inLib = extractFn(lib.replace(/\bexport function /g, 'function '), name)
    expect(inWf).not.toBeNull()
    expect(inLib).not.toBeNull()
    expect(inWf).toBe(inLib)
  })
}

test('deep-agy.js targets the plugin-namespaced forwarder, not a user-scoped agent', () => {
  expect(wf).not.toContain('antigravity:agy-rescue')
  expect(wf).toMatch(/agentType:\s*'deep-research:deep-research-agy-run'/)
  // le plugin doit être autonome : aucun agent hors namespace deep-research:
  expect(wf).not.toMatch(/agentType:\s*'agy-run'/)
})
