---
name: agy
description: "Deep research multi-rounds via agy (browsing Gemini groundé Google) — matrice de preuves + plan que tu valides, angles browsés en parallèle, analyse de convergence, passe red-team, rapport cité avec tags preuve/inférence/hypothèse et recommandation appliquée. Pour les décisions lourdes où la justesse prime sur la vitesse. Triggers : /erom-research:agy, 'deep agy', 'deep research approfondie', 'recherche multi-rounds'. Sauve dans docs/research/agy/."
user-invocable: true
allowed-tools: Bash, Write, Read, Workflow, Agent
---

Deep research multi-rounds. Ne remplace pas une recherche web ordinaire (`search-builtin` pour un fait, `search-perplexity` pour un tour d'horizon) : ici on boucle via le Workflow `deep-agy` — agy browse plusieurs angles par round, Claude juge couverture et convergence entre rounds, une passe red-team attaque les claims centraux/mono-source, puis synthèse.

> Cette skill AUTORISE explicitement l'appel du tool `Workflow` (opt-in par instruction de skill). Le Workflow spawne un subagent `erom-research:agy-run` par angle/claim.

Requête brute :
$ARGUMENTS

## Étape 0 — Chemins du plugin

Ces deux chemins sont déjà absolus dans ce texte : recopie-les littéralement, ne les reconstruis pas.

- `SCRIPT` = `${CLAUDE_PLUGIN_ROOT}/scripts/deep-agy.js`
- `RENDER` = `${CLAUDE_PLUGIN_ROOT}/scripts/render-report.mjs`

Si `${CLAUDE_PLUGIN_ROOT}` te parvient non expansé, résous-le : deux niveaux au-dessus du « Base directory for this skill » injecté ci-dessus.

## Étape 1 — Parse + préflight (UN appel Bash)

- `--depth L|H` (défaut `L`). `H` = jusqu'à 4 rounds (vs 2), red-team 10 claims (vs 5), timeouts par angle plus longs.
- `--yes` saute le plan gate (Étape 3).
- Retire ces flags de `$ARGUMENTS` ; le reste trimé = `<sujet>`. Vide → demande « Quoi deep-rechercher ? » et stop.
- `SLUG` = sujet lowercased, non-alphanumérique → `-`, répétitions réduites, 60 chars. `DATE` = aujourd'hui ISO.
- Chemins ABSOLUS obligatoires : le Workflow et ses subagents tournent dans un cwd différent, et un `~` ou un chemin relatif passé en argument de tool (`scriptPath`, `deepDir`) n'est PAS expansé. Le préflight imprime `WRITE_FILE` et `DEEP_DIR` — réutilise ces valeurs littérales telles quelles aux Étapes 4-5, avec les `SCRIPT`/`RENDER` de l'Étape 0.

```bash
mkdir -p "docs/research/agy/.deep/<DATE>-<SLUG>"
echo "WRITE_FILE=$(pwd)/docs/research/agy/<DATE>-<SLUG>.md"
echo "DEEP_DIR=$(pwd)/docs/research/agy/.deep/<DATE>-<SLUG>"
test -f "<SCRIPT>" && test -f "<RENDER>" && echo "PLUGIN_OK" || echo "PLUGIN_BROKEN"
command -v agy >/dev/null 2>&1 && agy --version || echo "AGY_MISSING"
```
`PLUGIN_BROKEN` → le plugin `erom-research` est mal installé (ou `SCRIPT`/`RENDER` mal résolus) : STOP, ne lance pas le Workflow.
`AGY_MISSING` → dire à l'utilisateur d'installer agy (https://antigravity.google) ou de lancer `agy` une fois en terminal pour l'OAuth, puis STOP (ne pas lancer un Workflow multi-rounds contre un agy mort).

## Étape 2 — Matrice de preuves + angles (Claude raisonne, sans tool)

Décompose `<sujet>` en :
1. **Matrice** : lignes `{ id, question, evidenceType, sourceQualityBar, recencyRequirement, contradictionCheck, recommendationChanging }`. `recommendationChanging: true` marque les lignes qui pourraient renverser la conclusion.
2. **Angles** : `{ label, query, rationale, targetsMatrixIds }`. 3-4 angles en `L`, 5-6 en `H`. Chaque angle cible ≥1 ligne ; chaque ligne recommendationChanging est ciblée par ≥1 angle.

## Étape 3 — Plan gate (sauté si `--yes`)

Montre la matrice + les angles (table compacte) et attends un go explicite ou des edits. Applique les edits puis re-montre si non triviaux. Avec `--yes`, saute cette étape.

## Étape 4 — Lancer le Workflow

```
Workflow({
  scriptPath: "<SCRIPT de l'Étape 0 — chemin absolu, jamais ~>",
  args: { question: <sujet>, matrix: <matrice>, angles: <angles>, depth: "L"|"H",
          engines: "agy", deepDir: "<DEEP_DIR de l'Étape 1 — absolu>", date: <DATE>, title: <sujet> }
})
```
Attends le résultat `{ report, coverage, rounds, converged }`. `report` est déjà au schéma et `report.coverage` est pré-calculé (déterministe) — ne pas recomputer.

## Étape 5 — Rendu (Claude, après le Workflow)

N'écris pas le markdown à la main. Écris `{ report, meta }` dans `<DEEP_DIR>/_render.json` (Write) puis rends via le CLI (UN Bash) :
```bash
node "<RENDER de l'Étape 0>" "<DEEP_DIR>/_render.json" > "<WRITE_FILE>"
```
où `meta = { title:<sujet>, depth:<L|H>, rounds:<result.rounds>, converged:<result.converged>, date:<DATE> }`.
(`render-report.mjs` importe la lib en spécifieur relatif — ne jamais inliner le chemin de la lib dans un `node -e`.)

## Étape 6 — Retour

Retourne le chemin `WRITE_FILE` + les ~30 premières lignes du fichier rendu (TL;DR + Couverture). Verbatim, ne paraphrase pas.

## Notes
- Cette skill ne parle jamais à agy directement : chaque appel agy se fait dans le Workflow, un subagent `erom-research:agy-run` par angle/claim. Un agy cassé en cours → l'angle revient `failed`, la couverture se dégrade (notée dans `coverage.failedAngleLabels`) sans crasher le run.
- Une recherche web ordinaire reste la voie rapide au quotidien ; réserve `/erom-research:agy` aux décisions où la justesse prime.
- Routage des trois moteurs : `agy` = justesse pilotée (matrice, plan gate, red-team) ; `grok` = second moteur indépendant hors quota Google ; `nlm` = référentiel persistant à réinterroger dans le temps.
