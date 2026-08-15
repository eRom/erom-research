# erom-research — quatre moteurs de recherche profonde

Plugin Claude Code. Quatre moteurs indépendants pour les questions où une
recherche web d'un coup ne suffit pas, chacun avec un profil de coût, de
latence et de livrable différent.

| Skill | Moteur | Pilotage | Livrable | Quota consommé |
|---|---|---|---|---|
| `agy` | Antigravity CLI (Gemini groundé Google) | Claude : matrice de preuves, gate plan, rounds adaptatifs, vote 3 voix | rapport cité, tags preuve/inférence/hypothèse | Google |
| `grok` | Grok CLI, workflow builtin `deep-research` | délégué au moteur (plan borné, vérif adversariale sur shard indépendant) | rapport cité + coverage explicite | pool hebdo X |
| `nlm` | NotebookLM (CLI `nlm`) | délégué au moteur (deep search web, import, auto-label) | rapport **+ référentiel persistant** de 40-70 sources | Google (NotebookLM) |
| `claude` | Subagents Claude natifs (WebSearch/WebFetch) | Claude : matrice de preuves, gate plan, rounds adaptatifs, vote 3 voix | rapport cité + couverture | quota Anthropic |

Choisir : **agy** quand la justesse prime et que tu veux contrôler le plan de
recherche ; **grok** quand tu veux un second moteur indépendant sans toucher au
quota Google ; **nlm** quand le sujet va vivre et que tu reviendras poser des
questions au corpus (`nlm notebook query <notebook_id>`, ou la skill personnelle
`/notebook-chat` si tu l'as, elle n'est pas fournie ici) ; **claude** quand tu veux
le pipeline piloté sans dépendance externe ni quota tiers.

## Usage

```
/erom-research:agy  <sujet> [--depth L|H] [--yes]
/erom-research:grok <sujet> [--budget N] [--detach]
/erom-research:grok status --latest
/erom-research:grok list
/erom-research:nlm  <sujet>
/erom-research:nlm  list
/erom-research:claude <sujet> [--depth L|H] [--yes]
```

**agy** — Claude décompose le sujet en matrice de preuves + angles, te montre
le plan (gate, sautable avec `--yes`), puis lance un Workflow : N angles
browsés en parallèle par round, analyse de convergence entre rounds (2 en
`L`, jusqu'à 4 en `H`), vote 3 voix adversarial sur les claims centraux
et mono-source, synthèse. Bloquant, 5-15 min.

**grok** — asynchrone : lancé en arrière-plan, la conversation continue, le
rapport arrive par notification (3-10 min). `--budget` est le cap dur de
dépense en agents (défaut 24). `--detach` fait survivre le run à la fermeture
de la session, à reprendre plus tard via `status`.

**nlm** — asynchrone (10-20 min) : crée un notebook dédié, lance une deep
search Google, importe et labellise les sources, produit une synthèse. Le
notebook reste interrogeable indéfiniment.

## Sorties

Tous les rapports atterrissent dans le store central `~/.claude/erom-plugins/researchs/` (plat, un fichier par recherche, projet d'origine en frontmatter `project:`) :

```
~/.claude/erom-plugins/researchs/<date>-<slug>.md      rapport (frontmatter : title, type, source_tool, engine, project, created, sensitivity + champs moteur)
~/.claude/erom-plugins/researchs/.runs/<date>-<slug>/  artefacts de travail, non versionnés (ex-.deep agy/claude ; status.json, worker.log grok)
```

## Pré-requis

| Moteur | Binaire | Auth |
|---|---|---|
| agy | `agy` ([antigravity.google](https://antigravity.google)) | lancer `agy` une fois en terminal (OAuth) |
| grok | `grok` + `bun` | `grok` authentifié (abonnement X) |
| nlm | `nlm` | `nlm login` (cookies Google, à rafraîchir périodiquement) |
| claude | aucun | aucune, quota Anthropic de la session |

Chaque skill fait son préflight et s'arrête proprement si le binaire manque ou
si l'auth est expirée — jamais de findings inventés sur un moteur mort.

## Composants

```
agents/
  agy-run.md                 forwarder agy : MODE deep-angle (+ MODE redteam, conservé pour usage manuel, plus appelé par le Workflow)
  claude-run.md              chercheur natif claude : WebSearch/WebFetch, claims falsifiables sourcés
  notebook-creator.md        pilote nlm : create → research → import → label → synthèse
scripts/
  deep-research.js           Workflow multi-rounds (helpers inlinés, cf. test de synchro)
  deep-research-lib.mjs      lib partagée : dédup, couverture, convergence, agrégation de votes, rendu
  render-report.mjs          rapport JSON → markdown
  agy_scratch.py             runner agy en scratch dir (0 snapshot, 0 rejet sandbox)
  recover_transcript.py      plan B : récupère la réponse depuis le transcript agy
  grok-deep                  CLI wrapper du workflow builtin de Grok (run/start/status/list)
  tests/                     bun test tests/ + python3 tests/test_recover_transcript.py
```

Le plugin est autonome : aucun script ni agent hors de sa racine. Le test de
synchro `deep-research-sync.test.mjs` verrouille trois invariants : les helpers
inlinés dans le Workflow restent identiques à la lib, le Workflow ne cible
que des agents du namespace `erom-research:`, et aucune fonction surveillée
n'échappe à cette comparaison octet à octet (garde-fou du garde-fou).

## Licence

MIT — Romain Ecarnot.
