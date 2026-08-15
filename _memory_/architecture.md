# Architecture

_Mis à jour : 2026-08-15_

**Type** : plugin Claude Code `erom-research` (renommé le 2026-07-30, ex-`deep-research`), distribué via `erom-marketplace` (dépôt public `eRom/erom-research` ; dossier local `erom-agence-deep-research`).

**Objectif** : quatre moteurs de deep research complémentaires, un seul flux (question → moteur → Claude traite le rapport).

| Skill | Moteur | Transport | Synchronicité |
|---|---|---|---|
| `agy` | Antigravity CLI (Gemini groundé Google) | Workflow `deep-research.js` + subagents | bloquant, 5-15 min |
| `grok` | Grok CLI, workflow builtin `deep-research` | CLI wrapper `grok-deep` | asynchrone (`run_in_background`) |
| `nlm` | NotebookLM (CLI `nlm`) | subagent `notebook-creator` (`background: true`) | asynchrone, 10-20 min |
| `claude` | Subagents Claude natifs (WebSearch/WebFetch) | Workflow `deep-research.js` + subagents `claude-run` | bloquant, 5-15 min |

**Stack** : markdown (skills, agents), JS/ESM (Workflow + lib de rendu), Python 3 (runners agy), TypeScript sur Bun (CLI grok-deep).

```
.claude-plugin/plugin.json   manifeste
skills/{agy,claude,grok,nlm}/SKILL.md
agents/                      agy-run.md, claude-run.md, notebook-creator.md
scripts/                     deep-research.js, deep-research-lib.mjs, render-report.mjs,
                             agy_scratch.py, recover_transcript.py, grok-deep
scripts/tests/               bun (2 fichiers) + python (1 fichier)
```

**Flux agy** (le seul non trivial) : la skill construit matrice de preuves + angles, gate plan → `Workflow(deep-research.js)` → N angles en parallèle par round via subagents `erom-research:agy-run` → analyse de convergence (Claude) → red-team adversariale → synthèse → `render-report.mjs` produit le markdown.

**Sorties** (0.5.0) : store central `~/.claude/erom-plugins/researchs/` (plat, `<date>-<slug>.md`, frontmatter canonique title/type/engine/project/created ; artefacts sous `.runs/`, gitignorés ; versionnement par le nightly de `~/.claude`, aucune commande git dans les skills). Plus rien dans le projet courant.

**Dépendances externes critiques** : binaires `agy`, `grok` (+ `bun`), `nlm`, `node`. Chaque skill fait son préflight et s'arrête si le binaire manque ou si l'auth est expirée.

**Autonomie** : aucune référence hors racine du plugin. Le forwarder agy embarque ses propres `agy_scratch.py` et `recover_transcript.py` plutôt que de dépendre de l'agent `agy-run` de `~/.claude` (qui sert les 4 skills multimodales et ne porte plus les modes deep).
