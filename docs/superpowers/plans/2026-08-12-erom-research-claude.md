# erom-research:claude Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Câbler un second moteur de collecte (`claude`, natif WebSearch/WebFetch) sous le pipeline deep research existant du plugin erom-research, et remplacer sa red-team à une voix par un vote adversarial à trois voix.

**Architecture:** Un workflow unique porte les deux moteurs via une table `ENGINES` consultée uniquement par la phase d'angles. Analyse de convergence, vote et synthèse restent des agents Claude natifs quel que soit le moteur, ce qui préserve le quota Google en mode agy. Les helpers de calcul vivent dans une lib testée et sont inlinés verbatim dans le workflow, contrainte imposée par le fait qu'un script Workflow ne peut rien importer.

**Tech Stack:** JavaScript (scripts Workflow Claude Code, realm ECMAScript nu), `bun:test` pour les tests, Python 3 pour le runner agy existant.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-08-12-erom-research-claude-design.md`. Branche : `feat/engine-claude`.
- Le test de synchro compare les corps de fonction **octet à octet** entre la lib et le workflow. Toute édition d'un helper partagé se fait à l'identique des deux côtés, sans exception.
- `renderReportMarkdown` n'est **pas** inlinée dans le workflow et s'édite seule.
- Un script Workflow ne peut importer aucun fichier local et tourne dans un realm ECMAScript nu (pas de `require`, pas de filesystem).
- `meta.name` du workflow ne doit **jamais** valoir `deep-research` : ce nom est déjà pris par le workflow bundled de Claude Code dans le même registre. Valeur retenue : `erom-deep-research`.
- Runtime vérifié le 12/08/2026 : `opts.model: 'sonnet'` produit un agent `claude-sonnet-5`, l'absence de pin fait hériter du modèle de session. Les deux formes (`'sonnet'` et `'claude-sonnet-5'`) fonctionnent, la courte est retenue.
- `plugin/agents/agy-run.md` déclare `model: haiku` dans son frontmatter. Ne jamais pinner de modèle sur l'engine `agy`, ce serait une régression de coût.
- Langue des rapports produits et des messages utilisateur : français.
- Aucun tiret cadratin (U+2014) dans les fichiers écrits : un hook `PreToolUse` bloque l'écriture.

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `plugin/scripts/deep-research.js` | Script Workflow : table ENGINES, boucle de rounds, vote, synthèse. Helpers inlinés. | Renommé depuis `deep-agy.js` |
| `plugin/scripts/deep-research-lib.mjs` | Source de vérité des helpers purs + `renderReportMarkdown`. | Renommé depuis `deep-agy-lib.mjs` |
| `plugin/scripts/render-report.mjs` | CLI JSON vers markdown. | Import mis à jour |
| `plugin/scripts/tests/deep-research-lib.test.mjs` | Unitaires de la lib. | Renommé, cas ajoutés |
| `plugin/scripts/tests/deep-research-sync.test.mjs` | Garde-fou inlining et namespace. | Renommé, étendu |
| `plugin/agents/claude-run.md` | Subagent chercheur natif (WebSearch, WebFetch). | Créé |
| `plugin/agents/agy-run.md` | Forwarder agy. Son `MODE: redteam` devient inutilisé. | Note de dépréciation |
| `plugin/skills/claude/SKILL.md` | Skill `/erom-research:claude`. | Créé |
| `plugin/skills/agy/SKILL.md` | Skill `/erom-research:agy`. | `SCRIPT` et `engines` mis à jour |
| `plugin/README.md`, `_memory_/*.md` | Documentation. | Chemins mis à jour |

---

### Task 1: Renommage et paramétrage de source_tool

Le renommage doit être atomique : le moindre chemin oublié casse le workflow agy en service.

**Files:**
- Rename: `plugin/scripts/deep-agy.js` vers `plugin/scripts/deep-research.js`
- Rename: `plugin/scripts/deep-agy-lib.mjs` vers `plugin/scripts/deep-research-lib.mjs`
- Rename: `plugin/scripts/tests/deep-agy-lib.test.mjs` vers `plugin/scripts/tests/deep-research-lib.test.mjs`
- Rename: `plugin/scripts/tests/deep-agy-sync.test.mjs` vers `plugin/scripts/tests/deep-research-sync.test.mjs`
- Modify: `plugin/scripts/render-report.mjs:5`, `plugin/skills/agy/SKILL.md:8,19`, `plugin/README.md:73,74,83`
- Modify: `plugin/agents/agy-run.md:3,70,94` (trois mentions du nom du Workflow dans la description et les modes)
- Modify: `_memory_/architecture.md:11,21,26`, `_memory_/patterns.md:21`, `_memory_/key-files.md:30,31,41,42`, `_memory_/gotchas.md:37`

**Interfaces:**
- Consumes: rien
- Produces: `renderReportMarkdown(report, meta)` accepte `meta.sourceTool` (string, défaut `'erom-research:agy'`) et `meta.engine` (string, optionnel)

- [ ] **Step 1: Écrire le test du sourceTool paramétré**

Dans `plugin/scripts/tests/deep-agy-lib.test.mjs` (avant renommage), ajouter :

```js
test('renderReportMarkdown: sourceTool paramétrable, défaut agy', () => {
  const report = { tldr: [], findings: [], coverage: {}, conclusion: { recommendation: 'R', overallConfidence: 'high' }, references: [] }
  const base = { title: 'T', depth: 'L', rounds: 1, converged: true, date: '2026-08-12' }
  expect(renderReportMarkdown(report, base)).toContain('source_tool: erom-research:agy')
  const claude = renderReportMarkdown(report, { ...base, sourceTool: 'erom-research:claude', engine: 'claude' })
  expect(claude).toContain('source_tool: erom-research:claude')
  expect(claude).toContain('engine: claude')
})
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
cd plugin && bun test scripts/tests/deep-agy-lib.test.mjs
```
Attendu : FAIL sur `source_tool: erom-research:claude` (la chaîne est codée en dur).

- [ ] **Step 3: Rendre le test vert**

Dans `deep-agy-lib.mjs`, remplacer le bloc frontmatter de `renderReportMarkdown` (ligne 121 à 125) par :

```js
  L.push([
    '---', `title: "${meta.title}"`, 'type: research',
    `source_tool: ${meta.sourceTool || 'erom-research:agy'}`,
    ...(meta.engine ? [`engine: ${meta.engine}`] : []),
    `depth: ${meta.depth}`, `rounds: ${meta.rounds}`, `converged: ${meta.converged}`,
    `created: ${meta.date}`, 'sensitivity: internal', '---', '',
  ].join('\n'))
```

- [ ] **Step 4: Vérifier que toute la suite passe**

```bash
cd plugin && bun test scripts/tests/
```
Attendu : 19 pass, 0 fail (18 existants plus le nouveau).

- [ ] **Step 5: Renommer les quatre fichiers**

```bash
cd plugin/scripts
git mv deep-agy.js deep-research.js
git mv deep-agy-lib.mjs deep-research-lib.mjs
git mv tests/deep-agy-lib.test.mjs tests/deep-research-lib.test.mjs
git mv tests/deep-agy-sync.test.mjs tests/deep-research-sync.test.mjs
```

- [ ] **Step 6: Mettre à jour toutes les références**

`render-report.mjs:5` : `from './deep-agy-lib.mjs'` devient `from './deep-research-lib.mjs'`.

`tests/deep-research-lib.test.mjs:2` : même substitution dans l'import.

`tests/deep-research-sync.test.mjs` lignes 1 à 11 : les deux `readFileSync` pointent vers `deep-research.js` et `deep-research-lib.mjs`, et les commentaires suivent.

`deep-research.js:1` : `meta.name` passe de `'deep-agy'` à `'erom-deep-research'`. Ne jamais mettre `'deep-research'`, collision avec le workflow bundled.

`deep-research.js:5` : le commentaire INLINED cite `deep-research-lib.mjs` et `tests/deep-research-sync.test.mjs`.

`deep-research-lib.mjs:3` : même mise à jour du commentaire.

`skills/agy/SKILL.md:19` : `SCRIPT` devient `${CLAUDE_PLUGIN_ROOT}/scripts/deep-research.js`.

`skills/agy/SKILL.md:8` : « via le Workflow `deep-agy` » devient « via le Workflow `erom-deep-research` ».

`tests/deep-research-sync.test.mjs:40` : le **nom** du test cite `deep-agy.js`, le renommer en
`deep-research.js`. Le test lui-même sera remplacé en Task 4, mais son nom doit être juste dès
maintenant pour que la porte du Step 7 puisse passer.

`agents/agy-run.md:3,70,94` : trois mentions de « Workflow deep-agy » dans la description du
frontmatter et dans les deux modes. Remplacer par `erom-deep-research`. Ne rien changer
d'autre dans ce fichier, la Task 5 en est propriétaire pour le reste.

`README.md:73,74,83` et les cinq emplacements `_memory_/` (dont `architecture.md:11`, la ligne
du tableau des moteurs) : substituer les noms de fichiers.

- [ ] **Step 7: Vérifier qu'aucune référence morte ne subsiste**

```bash
cd /Users/recarnot/dev/erom-agence-deep-research
grep -rn "deep-agy" --include="*.md" --include="*.mjs" --include="*.js" . \
  | grep -v -e "^\./docs/superpowers" -e "^\./\.superpowers"
```
Attendu : **aucune sortie**. Toute ligne restante est une référence morte à corriger.

Les deux exclusions sont nécessaires : `docs/superpowers/` porte la spec et le plan, qui citent
légitimement l'ancien nom en racontant le renommage, et `.superpowers/sdd/` porte le ledger et
les rapports de revue, que `grep -r` visite bien qu'ils soient dans un dossier caché.

- [ ] **Step 8: Suite verte après renommage**

```bash
cd plugin && bun test scripts/tests/ && python3 scripts/tests/test_recover_transcript.py
```
Attendu : 19 pass bun, 3 pass python.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(research): renomme deep-agy en deep-research, source_tool parametre

Le pipeline va porter deux moteurs, son nom ne peut plus citer agy.
meta.name vaut erom-deep-research et non deep-research pour eviter la
collision avec le workflow bundle de Claude Code.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: aggregateVotes dans la lib

**Files:**
- Modify: `plugin/scripts/deep-research-lib.mjs` (ajout en fin de fichier, avant `renderReportMarkdown`)
- Test: `plugin/scripts/tests/deep-research-lib.test.mjs`

**Interfaces:**
- Consumes: rien
- Produces: `aggregateVotes(verdicts, opts) -> { verdict, validVotes, erroredVotes, refutingSource?, refutingEvidence?, newConfidence? }` où `verdict` vaut `'kill' | 'downgrade' | 'hold' | 'unverified'`, `verdicts` est un tableau pouvant contenir des `null`, et `opts` vaut `{ votesCast = 3, threshold = 2 }`

- [ ] **Step 1: Écrire les tests**

Ajouter dans `tests/deep-research-lib.test.mjs`, et ajouter `aggregateVotes` à la liste d'imports de la ligne 2 :

```js
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
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
cd plugin && bun test scripts/tests/deep-research-lib.test.mjs
```
Attendu : FAIL, `aggregateVotes` n'est pas exportée.

- [ ] **Step 3: Implémenter**

Ce bloc a été exécuté et validé sur les 8 cas ci-dessus avant rédaction du plan. Le transcrire verbatim dans `deep-research-lib.mjs`, juste avant `renderReportMarkdown` :

> **Ne jamais déstructurer dans la liste de paramètres ici.** `extractFn`, dans le test de
> synchro, localise le corps d'une fonction par la première `{` rencontrée après son nom.
> Avec `function aggregateVotes(verdicts, { votesCast = 3 } = {})`, cette première accolade
> est celle du motif de déstructuration : l'extraction s'arrête sur son accolade fermante et
> le test compare deux fois la même chaîne de signature. Vérifié en exécutant `extractFn` sur
> deux corps volontairement divergents : ils sont vus comme égaux. Le garde-fou serait un
> test vide, et le corps pourrait diverger à 100% entre la lib et le workflow sans rougir.

```js
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
```

- [ ] **Step 4: Vérifier que les tests passent**

```bash
cd plugin && bun test scripts/tests/
```
Attendu : 27 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/deep-research-lib.mjs plugin/scripts/tests/deep-research-lib.test.mjs
git commit -m "feat(research): aggregateVotes, agregation d'un vote adversarial a 3 voix

Compte les votes contre (kill ou downgrade confondus) plutot que chaque
verdict isolement : 1 kill + 1 downgrade + 1 hold fait tomber la claim en
downgrade, la ou un comptage par verdict la laissait passer en hold.

Distingue refute sur le fond de non verifiable : moins de 2 votes valides
rend unverified, une panne d'agent ne vaut plus validation silencieuse.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Traitement des claims non vérifiables de bout en bout

`applyRedTeam` doit conserver et marquer une claim `unverified`, `computeCoverage` doit la compter, et le rendu markdown doit la montrer.

**Files:**
- Modify: `plugin/scripts/deep-research-lib.mjs` (`applyRedTeam`, `computeCoverage`, `renderReportMarkdown`)
- Test: `plugin/scripts/tests/deep-research-lib.test.mjs`

**Interfaces:**
- Consumes: `aggregateVotes` de la Task 2
- Produces: un finding peut porter `redteam.verdict === 'unverified'` avec `redteam.validVotes` et `redteam.erroredVotes` ; `computeCoverage` rend un champ `unverifiedClaims` (number)

- [ ] **Step 1: Écrire les tests**

```js
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
```

Ajouter `computeCoverage` à la ligne d'import si absente.

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
cd plugin && bun test scripts/tests/deep-research-lib.test.mjs
```
Attendu : 3 FAIL.

- [ ] **Step 3: Étendre applyRedTeam**

Dans `applyRedTeam`, remplacer le bloc de traitement du verdict par :

```js
    if (v) {
      newFinding.redteam = {
        verdict: v.verdict, refutingSource: v.refutingSource || null, evidence: v.refutingEvidence || '',
        ...(v.validVotes !== undefined ? { validVotes: v.validVotes, erroredVotes: v.erroredVotes } : {}),
      }
      if (v.verdict === 'downgrade') {
        newFinding.confidence = v.newConfidence || 'low'
      }
    }
```

Le `continue` sur `v.verdict === 'kill'` en amont reste inchangé : `unverified` ne tue pas, il traverse et se fait marquer.

- [ ] **Step 4: Étendre computeCoverage**

Dans l'objet retourné par `computeCoverage`, ajouter après `distinctDomains` :

```js
    unverifiedClaims: state.findings.filter(f => f.redteam && f.redteam.verdict === 'unverified').length,
```

- [ ] **Step 5: Étendre le rendu**

Dans `renderReportMarkdown`, section Couverture, juste après la ligne `Sources : ...` :

```js
  if (c.unverifiedClaims) L.push(`- Claims non vérifiables : ${c.unverifiedClaims} (vérificateurs en échec, ni confirmés ni réfutés)`)
```

- [ ] **Step 6: Inliner immédiatement les deux helpers modifiés**

`applyRedTeam` et `computeCoverage` sont sous garde-fou de synchro octet à octet. Les
modifier dans la lib sans les inliner dans le même commit rend la suite rouge. Copier
verbatim les deux corps modifiés depuis `deep-research-lib.mjs` vers le bloc INLINED de
`deep-research.js`, en retirant le mot-clé `export`. Copier-coller, ne pas retaper.

`renderReportMarkdown` n'est pas inlinée et ne se recopie pas.

- [ ] **Step 7: Vérifier que tout passe, synchro comprise**

```bash
cd plugin && bun test scripts/tests/
```
Attendu : 30 pass, 0 fail. Si un test `inline applyRedTeam matches lib` ou
`inline computeCoverage matches lib` échoue, la copie du Step 6 n'est pas verbatim.

- [ ] **Step 8: Commit**

```bash
git add plugin/scripts/deep-research-lib.mjs plugin/scripts/deep-research.js plugin/scripts/tests/deep-research-lib.test.mjs
git commit -m "feat(research): les claims non verifiables traversent au lieu de disparaitre

Une claim dont les verificateurs ont plante etait jusqu'ici traitee comme
validee en silence. Elle est desormais marquee, comptee dans la couverture
et affichee dans le rapport.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Inlining et extension du garde-fou

**Files:**
- Modify: `plugin/scripts/deep-research.js` (bloc INLINED)
- Modify: `plugin/scripts/tests/deep-research-sync.test.mjs`

**Interfaces:**
- Consumes: les corps de `aggregateVotes`, `applyRedTeam` et `computeCoverage` de la lib après Tasks 2 et 3
- Produces: le workflow dispose de `aggregateVotes` en portée locale

- [ ] **Step 1: Étendre le test de synchro**

Dans `deep-research-sync.test.mjs`, ajouter `'aggregateVotes'` à la fin du tableau `SHARED`, puis remplacer le dernier test par :

```js
test('le workflow ne cible que des agents du namespace erom-research:', () => {
  expect(wf).not.toContain('antigravity:agy-rescue')
  expect(wf).toMatch(/agentType:\s*'erom-research:agy-run'/)
  expect(wf).not.toMatch(/agentType:\s*'agy-run'/)
  // Tout agentType litteral du workflow doit porter le prefixe du plugin.
  const declared = [...wf.matchAll(/agentType:\s*'([^']+)'/g)].map(m => m[1])
  expect(declared.length).toBeGreaterThan(0)
  for (const a of declared) expect(a.startsWith('erom-research:')).toBe(true)
})
```

L'assertion portant sur `claude-run` est délibérément absente ici : cet agent n'est
référencé par le workflow qu'à la Task 6, qui ajoutera son assertion. Une tâche ne
laisse jamais la suite rouge derrière elle.

- [ ] **Step 2: Lancer et vérifier l'échec**

```bash
cd plugin && bun test scripts/tests/deep-research-sync.test.mjs
```
Attendu : FAIL sur `inline aggregateVotes matches lib`, la fonction étant absente du workflow.

- [ ] **Step 3: Inliner aggregateVotes**

Copier verbatim `aggregateVotes` depuis `deep-research-lib.mjs` vers le bloc INLINED de
`deep-research.js`, en retirant le mot-clé `export`. Le test compare octet à octet :
copier-coller, ne pas retaper.

`applyRedTeam` et `computeCoverage` ont déjà été inlinés à la Task 3, dans le même commit
que leur modification. Ne pas y retoucher.

- [ ] **Step 4: Vérifier que toute la suite est verte**

```bash
cd plugin && bun test scripts/tests/
```
Attendu : 31 pass, 0 fail. Les 11 tests d'inlining passent et le test de namespace aussi.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/deep-research.js plugin/scripts/tests/deep-research-sync.test.mjs
git commit -m "chore(research): inline aggregateVotes et etend le garde-fou de namespace

Le test verifie desormais que TOUT agentType litteral du workflow porte le
prefixe erom-research:, au lieu de la seule assertion sur agy-run.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Agent claude-run

Subagent exécutant, par opposition au forwarder `agy-run`. Il doit produire exactement la même matière que `agy-run` en `MODE: deep-angle` pour que `ingestRound` fonctionne à l'identique.

**Files:**
- Create: `plugin/agents/claude-run.md`
- Modify: `plugin/agents/agy-run.md` (note de dépréciation du MODE redteam)

**Interfaces:**
- Consumes: rien
- Produces: un agent `erom-research:claude-run` qui rend des claims au format attendu par `ANGLE_SCHEMA` (`{ angle, status, findings[], threads[] }`)

- [ ] **Step 1: Créer l'agent**

Contenu intégral de `plugin/agents/claude-run.md` :

```markdown
---
name: claude-run
description: "Chercheur natif pour le Workflow erom-deep-research (plugin erom-research) : browse un angle d'investigation avec WebSearch et WebFetch, rend des claims falsifiables sourcées. Réservé à ce Workflow, ne pas utiliser pour déléguer librement."
color: blue
tools: WebSearch, WebFetch
model: sonnet
---

Tu es UN angle d'une investigation de recherche plus large, pas un généraliste.
Va étroit et profond sur ton angle, ignore le reste de la question.

## Ce que tu reçois

Un header avec QUESTION (la question globale), QUERY (ton angle) et ROUND.

## Méthode

1. `WebSearch` sur ton angle. Formule des requêtes **spécifiques au sujet**, pas des
   requêtes de panorama. Une model card, un dépôt, un papier ou un fil d'issues valent
   mieux que dix articles « best X of 2026 » : ces derniers dominent le référencement
   sans jamais porter de détail vérifiable.
2. Si les premiers résultats sont des agrégateurs de blog, reformule avec les termes
   techniques exacts du domaine (noms de projets, d'auteurs, de datasets, de conférences)
   plutôt que d'accepter le panorama.
3. `WebFetch` les pages les plus prometteuses. Privilégie sources primaires : dépôts
   officiels, model cards, fichiers LICENSE, papiers, fils d'issues des mainteneurs.
4. Extrais 4 à 8 claims FALSIFIABLES portant sur la question globale.

## Ce que doit être un claim

- une affirmation concrète et vérifiable, jamais une généralité
- une citation d'appui directe, tirée verbatim de la source
- la ou les URL sources
- la qualité de source : `primary`, `secondary`, `blog`, `forum` ou `unreliable`
- la récence : date `YYYY-MM-DD` si trouvable, sinon `unknown`
- l'importance : `central`, `supporting` ou `tangential` par rapport à la question globale

## Threads

Termine par les pistes riches à creuser, chacune classée en `decision-critical`,
`contradiction-risk`, `recency-risk` ou `nice-to-have`. N'invente pas de threads pour
remplir : si aucune ne mérite un round de plus, dis-le.

## Échec

Si tes recherches ne donnent rien d'exploitable, ou si toutes les pages utiles sont
inaccessibles, rends `status: 'failed'` pour cet angle. N'invente jamais un claim pour
avoir l'air productif : un angle qui échoue dégrade la couverture, ce qui est le
comportement voulu et visible dans le rapport.

Rends `status: 'partial'` si tu as trouvé de la matière mais que la couverture de ton
angle reste incomplète.

## Langue

Celle de la question, français par défaut.
```

- [ ] **Step 2: Marquer le MODE redteam d'agy-run comme inutilisé**

Dans `plugin/agents/agy-run.md`, insérer juste sous le titre `### MODE: redteam` :

```markdown
> Conservé pour usage manuel. Depuis le passage au vote adversarial à trois voix,
> le Workflow n'appelle plus ce mode : la vérification est toujours faite par des
> agents Claude natifs, y compris quand la collecte tourne sur agy, afin de ne pas
> consommer trois appels de quota Google par claim.
```

- [ ] **Step 3: Enregistrer l'agent dans le manifeste du plugin**

**Sans ce step, l'agent n'existe pas.** `plugin/.claude-plugin/plugin.json` déclare
`"skills": "./skills/"` (un dossier, donc auto-découvert) mais `"agents"` est une **liste
explicite**. Créer le fichier ne suffit pas à l'enregistrer.

Remplacer la ligne `agents` par :

```json
  "agents": ["./agents/agy-run.md", "./agents/notebook-creator.md", "./agents/claude-run.md"]
```

Si ce step est omis, `agentType: 'erom-research:claude-run'` posé en Task 6 ne résoudra aucun
agent, tous les angles du moteur claude échoueront au premier run de la Task 9, et rien ne
l'aura signalé avant : le garde-fou de namespace vérifie que la chaîne du workflow porte le
bon préfixe, pas que l'agent existe. La suite de tests reste verte de bout en bout.

- [ ] **Step 4: Vérifier l'enregistrement, pas seulement l'écriture du fichier**

```bash
cd /Users/recarnot/dev/erom-agence-deep-research
grep -n "claude-run" plugin/.claude-plugin/plugin.json && head -8 plugin/agents/claude-run.md
```
Attendu : le manifeste cite `./agents/claude-run.md`, et le frontmatter contient
`name: claude-run`, `tools: WebSearch, WebFetch` et `model: sonnet`. La découverte effective
ne sera constatable qu'après le `/reload-plugins` de la Task 9.

- [ ] **Step 5: Commit**

```bash
git add plugin/agents/claude-run.md plugin/agents/agy-run.md plugin/.claude-plugin/plugin.json
git commit -m "feat(research): agent claude-run, chercheur natif WebSearch/WebFetch

Porte la doctrine de recherche qui fait la difference de qualite : requetes
specifiques plutot que panorama, sources primaires, echec honnete plutot que
claim invente. Le MODE redteam d'agy-run devient inutilise.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Table ENGINES dans le workflow

**Files:**
- Modify: `plugin/scripts/deep-research.js` (après le bloc INLINED, avant la boucle de rounds)

**Interfaces:**
- Consumes: `args.engines` (string, `'agy'` ou `'claude'`), l'agent `erom-research:claude-run` de la Task 5
- Produces: une constante `ENGINE` portant `{ agentType, agentOpts, anglePrompt }`

> **Note de normativité :** les blocs de cette tâche n'ont pas pu être exécutés hors du realm Workflow. La logique de la table est triviale, mais l'implémenteur doit valider le comportement réel au premier run de la Task 9 plutôt que de le supposer.

- [ ] **Step 1: Remplacer les constructeurs de prompt**

Remplacer les **seules** lignes 166 à 168 de `deep-research.js`, qui portent `anglePrompt` et
rien d'autre, par la table ci-dessous.

Ne pas toucher aux lignes 169 et 170 (`redTeamPrompt`) : elles restent appelées par la phase
Red-team jusqu'à leur suppression en Task 7. Les supprimer ici laisserait un `ReferenceError`
garanti au premier run, que ni `bun test` ni le test de synchro ne détectent.

```js
const ENGINES = {
  agy: {
    agentType: 'erom-research:agy-run',
    agentOpts: {},
    anglePrompt: (f, round, i) =>
      `MODE: deep-angle\nROUND: ${round}\nWRITE_FILE: ${deepDir}/r${round}-${i}-${slug(f.label)}.md\n` +
      `QUESTION: ${question}\nQUERY: ${f.query}\nTIMEOUT: ${ANGLE_TIMEOUT}\nUSER_TEXT:\n${f.query}`,
  },
  claude: {
    agentType: 'erom-research:claude-run',
    agentOpts: { model: 'sonnet', effort: 'medium' },
    anglePrompt: (f, round, i) =>
      `ROUND: ${round}\nQUESTION: ${question}\nQUERY: ${f.query}\n` +
      (f.rationale ? `RATIONALE: ${f.rationale}\n` : '') +
      `\nBrowse cet angle et rends tes claims au schéma. Angle: ${f.label}`,
  },
}
const ENGINE = ENGINES[engines] ?? ENGINES.agy
```

`agentOpts` reste vide pour agy : `agy-run.md` déclare déjà `model: haiku`, le surcharger serait une régression de coût.

- [ ] **Step 2: Router la phase d'angles**

Dans la boucle `while`, remplacer l'appel `agent(...)` par :

```js
  const results = (await parallel(focus.map((f, i) => () =>
    agent(ENGINE.anglePrompt(f, round, i), {
      label: `r${round}:${f.label}`, phase: ph, schema: ANGLE_SCHEMA,
      agentType: ENGINE.agentType, ...ENGINE.agentOpts,
    })
  ))).filter(Boolean)
```

- [ ] **Step 3: Épingler l'effort des phases de raisonnement**

Sur l'appel `agent` de l'analyse globale, ajouter `effort: 'high'` aux options, sans toucher au modèle :

```js
    { label: `global:r${round}`, phase: ph, schema: GLOBAL_SCHEMA, effort: 'high' })
```

Même ajout sur l'appel de synthèse (`label: 'synthesize'`). Ne jamais y ajouter `model` : ces deux phases doivent hériter du modèle de session.

- [ ] **Step 4: Vérifier la syntaxe du fichier**

```bash
cd plugin && bun -e 'const s=require("fs").readFileSync("scripts/deep-research.js","utf8"); try { new (Object.getPrototypeOf(async function(){}).constructor)(s.replace(/^export /gm,"")); console.log("SYNTAXE OK") } catch(e) { console.error("SYNTAXE KO:", e.message); process.exit(1) }'
```
Attendu : `SYNTAXE OK`, exit 0. Sur du code cassé : `SYNTAXE KO: <message>`, exit 1.

Ne pas remplacer par `bun build`, qui échoue toujours sur ce fichier (`Top-level return cannot
be used inside an ECMAScript module`, le script se terminant par un `return` racine), ni par
`bun -e "new Function(...)"` seul, qui sort en 0 même sur du code invalide et donne donc un
faux positif systématique. Les deux ont été mesurés. Le constructeur `AsyncFunction` utilisé
ici accepte le `await` et le `return` de niveau racine, et le `replace` neutralise l'unique
`export` de la ligne 1.

C'est la seule barrière syntaxique du chantier : la suite bun ne parse jamais le workflow, le
test de synchro le lit comme du texte.

- [ ] **Step 5: Ajouter l'assertion claude-run au garde-fou**

Maintenant que le workflow référence le second agent, ajouter dans le test de namespace de
`deep-research-sync.test.mjs`, juste après l'assertion sur `agy-run` :

```js
  expect(wf).toMatch(/agentType:\s*'erom-research:claude-run'/)
```

- [ ] **Step 6: Vérifier que la synchro tient toujours**

```bash
cd plugin && bun test scripts/tests/
```
Attendu : 31 pass, 0 fail, le test de namespace trouvant désormais les deux `agentType`.

- [ ] **Step 7: Commit**

```bash
git add plugin/scripts/deep-research.js plugin/scripts/tests/deep-research-sync.test.mjs
git commit -m "feat(research): table ENGINES, le pipeline porte deux moteurs de collecte

Seule la phase d'angles consulte la table. Analyse de convergence et synthese
restent des agents Claude natifs, avec effort high et le modele de session.
Le parametre engines etait deja destructure et jamais utilise.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Vote adversarial à trois voix

**Files:**
- Modify: `plugin/scripts/deep-research.js` (phase Red-team)

**Interfaces:**
- Consumes: `rankClaimsForRedTeam` (inchangée), `aggregateVotes` (Task 4), `applyRedTeam` (Task 3)
- Produces: `survivors`, chaque finding pouvant porter `redteam.verdict === 'unverified'`

> **Note de normativité :** blocs non exécutables hors realm Workflow. Valider au premier run.

- [ ] **Step 1: Remplacer le prompt de red-team**

Supprimer `redTeamPrompt` et le remplacer par un constructeur prenant l'index du voteur :

```js
const VOTES_PER_CLAIM = 3
const votePrompt = (c, v) =>
  `## Vérificateur adversarial (voteur ${v + 1}/${VOTES_PER_CLAIM})\n\n` +
  `Sois SCEPTIQUE. Cherche à RÉFUTER ce claim. Deux voix contre sur trois le font tomber.\n\n` +
  `Question de recherche : ${question}\n\nClaim attaqué : "${c.claim}"\n` +
  `Source : ${(c.sources && c.sources[0]) || 'inconnue'} (${c.sourceQuality})\n` +
  `Preuve avancée : ${c.evidence || '(aucune)'}\n\n` +
  `Checklist :\n` +
  `1. La preuve avancée soutient-elle vraiment le claim, ou est-ce une surinterprétation ?\n` +
  `2. Cherche des preuves contradictoires. Une source crédible le conteste ou le nuance fortement ?\n` +
  `3. La qualité de source suffit-elle à la force du claim ? Un claim extraordinaire exige du primaire.\n` +
  `4. Est-il périmé ? Un vieux claim dans un domaine qui bouge vite est suspect.\n` +
  `5. Est-ce du marketing, un communiqué, un benchmark cherry-pické, de la spéculation de forum ?\n\n` +
  `Verdict : kill (non étayé, contredit ou marketing) | downgrade (partiellement vrai, plus faible qu'énoncé) | hold (bien étayé, actuel, source à la hauteur).\n` +
  `En cas d'incertitude, réponds downgrade, pas kill : la couverture du rapport signalera le doute.\n` +
  `Sortie structurée uniquement. L'évidence doit être spécifique.`
```

- [ ] **Step 2: Remplacer la phase Red-team**

```js
phase('Red-team')
const targets = rankClaimsForRedTeam(state.findings, RT_TARGETS)
const verdicts = (await parallel(targets.map(c => () =>
  parallel(Array.from({ length: VOTES_PER_CLAIM }, (_, v) => () =>
    agent(votePrompt(c, v), {
      label: `vote${v}:${c.id}`, phase: 'Red-team',
      schema: REDTEAM_SCHEMA, model: 'sonnet', effort: 'medium',
    })
  )).then(votes => {
    const agg = aggregateVotes(votes, { votesCast: VOTES_PER_CLAIM })
    log(`"${String(c.claim).slice(0, 50)}": ${agg.verdict} (${agg.validVotes} voix valides, ${agg.erroredVotes} en echec)`)
    return { claim: c.claim, ...agg }
  })
))).filter(Boolean)
const survivors = applyRedTeam(state.findings, verdicts)
```

Noter que `aggregateVotes` rend déjà `newConfidence` quand le verdict est `downgrade`, ce qu'`applyRedTeam` consomme sans modification.

- [ ] **Step 3: Vérifier la syntaxe et la suite**

```bash
cd plugin && bun -e 'const s=require("fs").readFileSync("scripts/deep-research.js","utf8"); try { new (Object.getPrototypeOf(async function(){}).constructor)(s.replace(/^export /gm,"")); console.log("SYNTAXE OK") } catch(e) { console.error("SYNTAXE KO:", e.message); process.exit(1) }' && bun test scripts/tests/
```
Attendu : `SYNTAXE OK` puis 31 pass, 0 fail.

Ne pas remplacer cette commande par `bun build` (échoue toujours, `return` de niveau racine)
ni par `bun -e "new Function(...)"` seul (sort en 0 même sur du code invalide). Les deux
donnent un faux positif, mesuré. C'est la seule barrière syntaxique avant le premier run.

- [ ] **Step 4: Corriger la documentation de la skill agy, devenue fausse**

Deux affirmations de `plugin/skills/agy/SKILL.md` cessent d'être vraies à ce commit, et l'une
d'elles contredit l'argument quota central du chantier :

- ligne 10 : « Le Workflow spawne un subagent `erom-research:agy-run` par angle/claim »
- ligne 114 : « chaque appel agy se fait dans le Workflow, un subagent `erom-research:agy-run`
  par angle/claim »

Remplacer dans les deux cas « par angle/claim » par une formulation exacte : « par angle ; la
vérification des claims est faite par des agents Claude natifs, y compris en mode agy, pour ne
pas consommer trois appels de quota Google par claim ».

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/deep-research.js plugin/skills/agy/SKILL.md
git commit -m "feat(research): vote adversarial a 3 voix en place de la red-team a une voix

Trois verificateurs Claude natifs par claim, seuil de deux voix contre. La
selection des cibles reste rankClaimsForRedTeam, inchangee. Le vote ne passe
jamais par le moteur de collecte, ce qui epargne le quota Google en mode agy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Skill /erom-research:claude

**Files:**
- Create: `plugin/skills/claude/SKILL.md`
- Modify: `plugin/skills/agy/SKILL.md` (passer `engines: 'agy'` explicitement)
- Modify: `plugin/README.md` (tableau des moteurs, section Sorties, section Composants)

**Interfaces:**
- Consumes: le workflow `deep-research.js` avec `args.engines`
- Produces: la commande `/erom-research:claude <sujet> [--depth L|H] [--yes]`

- [ ] **Step 1: Créer la skill**

La skill reprend les six étapes de `skills/agy/SKILL.md`, dans le même ordre. Lire ce
fichier avant d'écrire, il est la référence de structure. Les six étapes attendues :

| Étape | Contenu |
|---|---|
| 0. Chemins du plugin | `SCRIPT` et `RENDER` en absolu via `${CLAUDE_PLUGIN_ROOT}`, à recopier littéralement, jamais reconstruire |
| 1. Parse et préflight | `--depth L\|H` (défaut `L`), `--yes`, calcul de `SLUG` et `DATE`, un seul appel Bash |
| 2. Matrice et angles | Claude raisonne sans tool : lignes `{ id, question, evidenceType, sourceQualityBar, recencyRequirement, contradictionCheck, recommendationChanging }` puis angles `{ label, query, rationale, targetsMatrixIds }`. 3 à 4 angles en `L`, 5 à 6 en `H` |
| 3. Plan gate | Montrer matrice et angles en table compacte, **attendre un go explicite**. Sauté uniquement si `--yes`. Le gate est actif par défaut, au même titre que sur agy |
| 4. Lancer le Workflow | avec `engines: "claude"` |
| 5. Rendu | écrire `_render.json` puis `node <RENDER>` vers `WRITE_FILE` |
| 6. Retour | chemin du fichier et 30 premières lignes verbatim, clôture menée par la couverture |

Différences non négociables avec la skill agy :

- frontmatter : `name: claude`, **`user-invocable: true`**, `allowed-tools: Bash, Write, Read, Workflow, Agent`, description mentionnant les triggers `/erom-research:claude` et la sortie `docs/research/claude/`. Les trois skills existantes portent toutes `user-invocable: true` ; sans ce champ, `/erom-research:claude` n'est pas exposé comme commande et la Task 9 ne peut pas se lancer
- ajouter la phrase d'autorisation explicite du tool `Workflow`, comme la skill agy l'a en tête de fichier : sans elle, l'appel du Workflow est bloqué par la consigne générale
- Étape 1, préflight : **pas** de vérification du binaire agy ni de circuit-breaker quota. Vérifier uniquement que `SCRIPT` et `RENDER` existent. Chemins absolus obligatoires, même contrainte que la skill agy.

```bash
mkdir -p "docs/research/claude/.deep/<DATE>-<SLUG>"
echo "WRITE_FILE=$(pwd)/docs/research/claude/<DATE>-<SLUG>.md"
echo "DEEP_DIR=$(pwd)/docs/research/claude/.deep/<DATE>-<SLUG>"
test -f "<SCRIPT>" && test -f "<RENDER>" && echo "PLUGIN_OK" || echo "PLUGIN_BROKEN"
```

- Étape 4, lancement : `engines: "claude"` dans les args

```
Workflow({
  scriptPath: "<SCRIPT de l'Étape 0, chemin absolu>",
  args: { question: <sujet>, matrix: <matrice>, angles: <angles>, depth: "L"|"H",
          engines: "claude", deepDir: "<DEEP_DIR>", date: <DATE>, title: <sujet> }
})
```

- Étape 5, rendu : `meta = { title, depth, rounds, converged, date, sourceTool: 'erom-research:claude', engine: 'claude' }`
- Étape 6 : reprendre **verbatim** la section « Clôture de run, ordre imposé » de la skill agy. La première phrase rendue porte la couverture, jamais la complétion technique, et il reste interdit de déduire un « 0 erreur » du fait que le workflow s'est terminé.
- Ajouter une ligne sur les claims non vérifiables : si `coverage.unverifiedClaims` est non nul, le dire dans la phrase de clôture.
- Préciser dans l'Étape 1 que `.deep/<DATE>-<SLUG>/` ne portera que `_render.json` en mode claude : `claude-run` n'a que `WebSearch` et `WebFetch`, il ne peut rien écrire sur disque, contrairement à `agy-run` qui y dépose un markdown par angle.

Passages à copier **verbatim** depuis `plugin/skills/agy/SKILL.md`, sans les reformuler (leur
formulation actuelle vient de mesures de terrain, la paraphraser en perd la portée) :

| Ligne source | Ce que c'est |
|---|---|
| 10 | la phrase autorisant explicitement l'appel du tool `Workflow`, sans laquelle l'appel est bloqué |
| 17 et 30 | l'avertissement sur les chemins absolus, et pourquoi un `~` ou un relatif passé en argument de tool n'est pas expansé |
| 97 à 111 | toute la section « Clôture de run, ordre imposé », avec la mesure des 29-30/07/2026 qui la justifie |

- [ ] **Step 2: Rendre explicite le moteur de la skill agy**

Dans `skills/agy/SKILL.md`, Étape 4, l'argument `engines: "agy"` est déjà présent. Vérifier qu'il l'est toujours après la Task 1 et qu'il n'a pas été perdu au renommage.

- [ ] **Step 3: Mettre à jour le README du plugin et le manifeste**

Le README annonce « trois moteurs » à deux endroits et ignore le nouveau dans quatre sections.
Un README auto-contradictoire est un livrable raté : il faut les six points, pas seulement le
tableau.

1. `README.md:1` (titre) et `:3` : « trois moteurs » devient « quatre moteurs ».
2. `README.md:9`, colonne Pilotage de la ligne `agy` : « red-team » devient « vote 3 voix ». Le
   pipeline est commun aux deux moteurs, laisser « red-team » sur agy suggérerait le contraire.
3. Ajouter la ligne du nouveau moteur au tableau :

```
| `claude` | Subagents Claude natifs (WebSearch/WebFetch) | Claude : matrice de preuves, gate plan, rounds adaptatifs, vote 3 voix | rapport cité + couverture | quota Anthropic |
```

4. `README.md:22-28`, bloc Usage : ajouter `/erom-research:claude <sujet> [--depth L|H] [--yes]`.
5. Section Sorties : ajouter `docs/research/claude/<date>-<slug>.md`. Ne **pas** promettre
   « artefacts bruts par angle » pour ce chemin : en mode claude, `claude-run` n'a que
   `WebSearch` et `WebFetch`, donc aucun moyen d'écrire sur disque. Seul `_render.json` y
   atterrit.
6. `README.md:57-61`, tableau Pré-requis : ajouter une ligne claude, « aucun binaire, aucune
   auth ». Et mettre à jour la section Composants avec `claude-run.md` et les fichiers renommés.

Enfin, dans `plugin/.claude-plugin/plugin.json`, la `description` dit encore « Trois moteurs de
deep research complémentaires » et les `keywords` ne portent ni `claude` ni `vote`. Corriger les
deux dans ce commit : la skill `plugin-release` de la Task 9 bumpe la version, le README et la
marketplace, pas la description ni les keywords du manifeste.

- [ ] **Step 4: Vérifier la découverte de la skill**

```bash
cd /Users/recarnot/dev/erom-agence-deep-research
grep -E "^(name|user-invocable|allowed-tools):" plugin/skills/claude/SKILL.md
grep -c "engines" plugin/skills/claude/SKILL.md
```
Attendu : les trois champs présents, `allowed-tools` incluant `Workflow`, et au moins une
occurrence de `engines`. Un `head` ne suffit pas : il prouve que le fichier a été écrit, pas
que les champs qui conditionnent l'invocabilité sont là.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/ plugin/README.md
git commit -m "feat(research): skill /erom-research:claude, sortie docs/research/claude

Quatrieme moteur, sans dependance externe ni quota tiers. Meme pipeline que
agy : matrice, plan gate, rounds adaptatifs, cloture menee par la couverture.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Non-régression et premier run comparatif

**Files:** aucun, sauf correctifs révélés par les runs.

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: la preuve que le moteur historique n'a pas régressé et que le nouveau fonctionne

- [ ] **Step 1: Suite complète verte**

```bash
cd plugin && bun test scripts/tests/ && python3 scripts/tests/test_recover_transcript.py
```
Attendu : **31 pass bun** et 3 pass python. Baseline avant chantier : 18 bun, 3 python.

Décompte attendu : 18 de baseline, plus 1 (sourceTool, T1), plus 8 (aggregateVotes, T2), plus
3 (unverified, T3), plus 1 (aggregateVotes entrant dans SHARED, T4). La T6 n'ajoute pas de
test, elle ajoute une assertion dans un test existant. Un total de 30 signalerait qu'un test a
disparu en route.

- [ ] **Step 2: Recharger le plugin**

Demander à Romain de lancer `/reload-plugins`. Un agent ne peut pas invoquer une commande slash : sans ce geste, la nouvelle skill et le nouvel agent ne sont pas visibles de la session.

- [ ] **Step 3: Run de non-régression agy**

```
/erom-research:agy <sujet court et réel> --depth L
```

Attendu : le workflow va au bout, un rapport atterrit dans `docs/research/agy/`, son frontmatter porte `source_tool: erom-research:agy`.

En cas d'échec, distinguer les causes **avant** toute conclusion : `agy_scratch.py` rend le code **3** avec une ligne `QUOTA <message>` sur épuisement de quota. Un échec quota n'est pas une régression, il faut le dire tel quel et reprendre après reset.

- [ ] **Step 4: Premier run claude**

```
/erom-research:claude <le même sujet> --depth L
```

Attendu : rapport dans `docs/research/claude/`, frontmatter portant `source_tool: erom-research:claude` et `engine: claude`.

Vérifier dans le journal du run que les agents d'angles tournent bien en `claude-sonnet-5` et que ceux de synthèse héritent du modèle de session.

- [ ] **Step 5: Comparer les deux rapports**

Sur le même sujet et le même pipeline, seul le moteur de collecte diffère. Comparer : nombre de sources, domaines distincts, angles aboutis, claims tuées par le vote, claims non vérifiables, et surtout la présence des sources de niche.

- [ ] **Step 6: Commit final et bump**

Si les deux runs sont concluants, invoquer la skill `plugin-release` pour publier la version (bump du manifeste, README, marketplace). Ne pas bumper avant d'avoir les deux runs.

---

## Ce que ce plan ne fait pas

- `engines: 'both'` répartissant les angles entre les deux moteurs
- un `--budget N` façon grok en mode claude
- tout autre portage du workflow bundled que la règle de vote
- la modification des skills `grok` et `nlm`
