---
name: deep-claude
description: "Deep research multi-rounds via subagents Claude natifs (WebSearch/WebFetch, sans navigateur externe) : matrice de preuves + plan que tu valides, angles browsés en parallèle par des subagents `erom-research:claude-run`, analyse de convergence, vote adversarial à trois voix, rapport cité avec tags preuve/inférence/hypothèse. Quatrième moteur du plugin, sans binaire ni auth externe : consomme uniquement le quota Anthropic de la session. Triggers : /erom-research:deep-claude, 'deep claude', 'deep research native', 'recherche multi-rounds sans agy'. Sauve dans ~/.claude/erom-plugin-artefacts/researchs/."
user-invocable: true
allowed-tools: Bash, Write, Read, Workflow, Agent
---

Deep research multi-rounds. Ne remplace pas une recherche web ordinaire (`search-builtin` pour un fait, `search-perplexity` pour un tour d'horizon) : ici on boucle via le Workflow `erom-deep-research`, avec des subagents Claude natifs (`erom-research:claude-run`, WebSearch/WebFetch) qui browsent plusieurs angles par round. Claude juge couverture et convergence entre rounds, un vote adversarial à trois voix attaque les claims centraux/mono-source, puis synthèse.

> Cette skill AUTORISE explicitement l'appel du tool `Workflow` (opt-in par instruction de skill). Le Workflow spawne un subagent `erom-research:claude-run` par angle ; la vérification des claims est faite par des agents Claude natifs, comme pour les autres moteurs de ce plugin, sans consommer de quota tiers par claim.

Requête brute :
$ARGUMENTS

## Étape 0 - Chemins du plugin

Ces deux chemins sont déjà absolus dans ce texte : recopie-les littéralement, ne les reconstruis pas.

- `SCRIPT` = `${CLAUDE_PLUGIN_ROOT}/scripts/deep-research.js`
- `RENDER` = `${CLAUDE_PLUGIN_ROOT}/scripts/render-report.mjs`

Si `${CLAUDE_PLUGIN_ROOT}` te parvient non expansé, résous-le : deux niveaux au-dessus du « Base directory for this skill » injecté ci-dessus.

## Étape 1 - Parse + préflight (UN appel Bash)

- `--depth L|H` (défaut `L`). `H` = jusqu'à 4 rounds (vs 2), vote à trois voix sur 10 claims (vs 5), timeouts par angle plus longs.
- `--yes` saute le plan gate (Étape 3).
- Retire ces flags de `$ARGUMENTS` ; le reste trimé = `<sujet>`. Vide → demande « Quoi deep-rechercher ? » et stop.
- `SLUG` = sujet lowercased, non-alphanumérique → `-`, répétitions réduites, 60 chars. `DATE` = aujourd'hui ISO.
- Chemins ABSOLUS obligatoires : le Workflow et ses subagents tournent dans un cwd différent, et un `~` ou un chemin relatif passé en argument de tool (`scriptPath`, `deepDir`) n'est PAS expansé. Le préflight imprime `WRITE_FILE`, `DEEP_DIR` et `PROJECT` (chemins absolus, `$HOME` expansé), réutilise ces valeurs littérales telles quelles aux Étapes 4-5, avec les `SCRIPT`/`RENDER` de l'Étape 0.
- `DEEP_DIR` ne recevra que `_render.json` (Étape 5) en mode claude : `claude-run` n'a que `WebSearch` et `WebFetch` comme tools, il ne peut rien écrire sur disque, contrairement à `agy-run` qui y dépose un markdown par angle. Le `mkdir -p` ci-dessous reste nécessaire pour que `_render.json` ait un dossier où atterrir.

```bash
RESEARCH_DIR="$HOME/.claude/erom-plugin-artefacts/researchs"
BASE="<DATE>-<SLUG>"; N=2
while test -e "$RESEARCH_DIR/$BASE.md"; do BASE="<DATE>-<SLUG>-$N"; N=$((N+1)); done
mkdir -p "$RESEARCH_DIR/.runs/$BASE"
echo "WRITE_FILE=$RESEARCH_DIR/$BASE.md"
echo "DEEP_DIR=$RESEARCH_DIR/.runs/$BASE"
echo "PROJECT=$(basename "$(pwd)")"
test -f "<SCRIPT>" && test -f "<RENDER>" && echo "PLUGIN_OK" || echo "PLUGIN_BROKEN"
```
`PLUGIN_BROKEN` → le plugin `erom-research` est mal installé (ou `SCRIPT`/`RENDER` mal résolus) : STOP, ne lance pas le Workflow. Pas de vérification de binaire ni de circuit-breaker quota ici, contrairement à `deep-gemini` : `claude-run` n'a aucune dépendance externe, seul le quota Anthropic de la session s'applique.

## Étape 2 - Matrice de preuves + angles (Claude raisonne, sans tool)

Décompose `<sujet>` en :
1. **Matrice** : lignes `{ id, question, evidenceType, sourceQualityBar, recencyRequirement, contradictionCheck, recommendationChanging }`. `recommendationChanging: true` marque les lignes qui pourraient renverser la conclusion.
2. **Angles** : `{ label, query, rationale, targetsMatrixIds }`. 3-4 angles en `L`, 5-6 en `H`. Chaque angle cible ≥1 ligne ; chaque ligne recommendationChanging est ciblée par ≥1 angle.

## Étape 3 - Plan gate (sauté si `--yes`)

Montre la matrice + les angles (table compacte) et attends un go explicite ou des edits. Applique les edits puis re-montre si non triviaux. Avec `--yes`, saute cette étape. Le gate est actif par défaut, au même titre que sur `deep-gemini`.

## Étape 4 - Lancer le Workflow

```
Workflow({
  scriptPath: "<SCRIPT de l'Étape 0, chemin absolu, jamais ~>",
  args: { question: <sujet>, matrix: <matrice>, angles: <angles>, depth: "L"|"H",
          engines: "claude", deepDir: "<DEEP_DIR de l'Étape 1, chemin absolu>" }
})
```
Attends le résultat `{ report, coverage, rounds, converged }`. `report` est déjà au schéma et `report.coverage` est pré-calculé (déterministe) : ne pas recomputer.

## Étape 5 - Rendu (Claude, après le Workflow)

N'écris pas le markdown à la main. Écris `{ report, meta }` dans `<DEEP_DIR>/_render.json` (Write) puis rends via le CLI (UN Bash) :
```bash
node "<RENDER de l'Étape 0>" "<DEEP_DIR>/_render.json" > "<WRITE_FILE>"
```
où `meta = { title:<sujet>, depth:<L|H>, rounds:<result.rounds>, converged:<result.converged>, date:<DATE>, sourceTool:'erom-research:deep-claude', engine:'claude', project:'<PROJECT>' }`.
(`render-report.mjs` importe la lib en spécifieur relatif : ne jamais inliner le chemin de la lib dans un `node -e`.)

## Étape 6 - Retour

Retourne le chemin `WRITE_FILE` + les ~30 premières lignes du fichier rendu (TL;DR + Couverture). Verbatim, ne paraphrase pas.

### Clôture de run - ordre imposé

La **première phrase** rendue à Romain porte la couverture, pas la complétion technique :

> « <domaine> : X angles aboutis sur Y, convergé / non convergé, N pièces. » puis, ensuite seulement,
> durée, nombre d'agents et volume de tokens.

Interdit : dériver un « 0 erreur » / « aucune erreur » de la complétion du workflow. Le workflow qui se
termine sans crasher n'est pas un run sans échec - le champ `result.coverage` est la seule source sur
la couverture. Si des angles ont échoué, la phrase de clôture le dit, avec la cause dominante réelle
(lue dans les retours des agents, pas supposée).

> Mesure des 29-30/07/2026 : 4 runs sur 4 annoncés « 0 erreur » / « aucun angle en échec » ; couverture
> réelle 17/35, 20/31, 9/27 et 15/29. Sur écologie-énergie, la couverture réelle n'a jamais été dite en
> chat - elle n'existe que dans le rapport et le message de commit.

Même règle pour les claims non tranchés : si `coverage.unverifiedClaims` est non nul, la phrase de
clôture le dit aussi, distinctement des claims coulés par le vote. Ce sont des claims que les trois voix
n'ont ni confirmés ni réfutés (vérificateur en échec), pas des claims rejetés.

## Notes
- Cette skill ne parle jamais aux subagents de recherche directement : chaque appel se fait dans le Workflow, un subagent `erom-research:claude-run` par angle (WebSearch/WebFetch uniquement, aucune écriture disque) ; la vérification des claims est faite par des agents Claude natifs, comme pour les autres moteurs. Un angle qui échoue revient `failed`, la couverture se dégrade (notée dans `coverage.failedAngleLabels`) sans crasher le run.
- Une recherche web ordinaire reste la voie rapide au quotidien ; réserve `/erom-research:deep-claude` aux décisions où la justesse prime et où tu veux éviter toute dépendance externe (pas de binaire, pas d'auth, pas de quota tiers).
- Routage des quatre moteurs : `deep-gemini` = justesse pilotée via Gemini groundé Google (matrice, plan gate, vote 3 voix) ; `deep-claude` = même pipeline sans dépendance externe ni quota tiers ; `deep-grok` = second moteur indépendant hors quota Google ; `deep-notebook` = référentiel persistant à réinterroger dans le temps.
