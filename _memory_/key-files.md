# Fichiers clés

_Mis à jour : 2026-08-15_

## Manifeste

| Fichier | Rôle |
|---|---|
| `.claude-plugin/plugin.json` | Manifeste. `skills` pointe un répertoire, `agents` **une liste de fichiers `.md`** (voir gotchas). |

## Skills

| Fichier | Rôle |
|---|---|
| `skills/agy/SKILL.md` | Pilote le Workflow multi-rounds : Étape 0 chemins plugin, préflight, matrice + angles, gate plan, Workflow, rendu. |
| `skills/claude/SKILL.md` | Même pipeline que agy, moteur de collecte natif (`claude-run`, WebSearch/WebFetch) : aucun préflight de binaire, aucun circuit-breaker quota. |
| `skills/grok/SKILL.md` | Enveloppe le CLI `grok-deep` en 3 modes : start (background), status, list. |
| `skills/nlm/SKILL.md` | Préflight auth `nlm`, spawn du subagent `erom-research:notebook-creator`, restitution à la notification. |

## Agents

| Fichier | Rôle |
|---|---|
| `agents/agy-run.md` | Forwarder mince vers agy via le scratch runner. Deux modes : `deep-angle`, `redteam` (redteam conservé pour usage manuel, plus appelé par le Workflow). Haiku. |
| `agents/claude-run.md` | Chercheur natif d'un angle d'investigation : WebSearch/WebFetch, claims falsifiables sourcés. Sonnet. |
| `agents/notebook-creator.md` | Pilote `nlm` de bout en bout : create → research deep → import → auto-label → 1 chat de synthèse → rapport. Sonnet, `background: true`, `memory: user`. |

## Scripts

| Fichier | Rôle |
|---|---|
| `scripts/deep-research.js` | Script Workflow. Helpers de calcul **inlinés** (un script Workflow ne peut rien importer), boucle de rounds, red-team, synthèse. |
| `scripts/deep-research-lib.mjs` | Source de vérité des mêmes helpers + `renderReportMarkdown` (en-têtes de rapport en français). |
| `scripts/render-report.mjs` | CLI `node render-report.mjs <json>` → markdown sur stdout. Importe la lib en spécifieur relatif. |
| `scripts/agy_scratch.py` | Lance UN `agy --print` dans un scratch dir puis déplace les sorties. Évite les snapshots de repo et les rejets de sandbox. Défaut `--model "Gemini 3.6 Flash (High)"`. |
| `scripts/recover_transcript.py` | Plan B : récupère la dernière réponse modèle depuis le transcript agy quand le fichier de sortie est vide. |
| `scripts/grok-deep` | CLI Bun autonome. `run` (bloquant), `start` (détaché), `status`, `list`. Défaut out-dir `~/.claude/erom-plugins/researchs`. Mode 100755. |

## Tests

| Fichier | Rôle |
|---|---|
| `scripts/tests/deep-research-lib.test.mjs` | Unitaires de la lib (dédup, corroboration, red-team, rendu). |
| `scripts/tests/deep-research-sync.test.mjs` | **Garde-fou critique** : helpers inlinés == lib, octet à octet ; et le Workflow ne cible que le namespace `erom-research:`. |
| `scripts/tests/test_recover_transcript.py` | Unitaires du plan B. |
| `scripts/tests/grok-deep.test.ts` | Unitaires du CLI grok-deep : frontmatter canonique, slugify, anti-collision `uniqueRunId` (couvre `.runs/` ET les `.md` d'autres moteurs). |

Lancement : `cd scripts && bun test tests/` puis `python3 tests/test_recover_transcript.py`.
