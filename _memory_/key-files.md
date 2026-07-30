# Fichiers clés

_Mis à jour : 2026-07-30_

## Manifeste

| Fichier | Rôle |
|---|---|
| `.claude-plugin/plugin.json` | Manifeste. `skills` pointe un répertoire, `agents` **une liste de fichiers `.md`** (voir gotchas). |

## Skills

| Fichier | Rôle |
|---|---|
| `skills/deep-research-agy/SKILL.md` | Pilote le Workflow multi-rounds : Étape 0 chemins plugin, préflight, matrice + angles, gate plan, Workflow, rendu. |
| `skills/deep-research-grok/SKILL.md` | Enveloppe le CLI `grok-deep` en 3 modes : start (background), status, list. |
| `skills/deep-research-nlm/SKILL.md` | Préflight auth `nlm`, spawn du subagent `deep-research:notebook-creator`, restitution à la notification. |

## Agents

| Fichier | Rôle |
|---|---|
| `agents/deep-research-agy-run.md` | Forwarder mince vers agy via le scratch runner. Deux modes : `deep-angle`, `redteam`. Haiku. |
| `agents/notebook-creator.md` | Pilote `nlm` de bout en bout : create → research deep → import → auto-label → 1 chat de synthèse → rapport. Sonnet, `background: true`, `memory: user`. |

## Scripts

| Fichier | Rôle |
|---|---|
| `scripts/deep-agy.js` | Script Workflow. Helpers de calcul **inlinés** (un script Workflow ne peut rien importer), boucle de rounds, red-team, synthèse. |
| `scripts/deep-agy-lib.mjs` | Source de vérité des mêmes helpers + `renderReportMarkdown` (en-têtes de rapport en français). |
| `scripts/render-report.mjs` | CLI `node render-report.mjs <json>` → markdown sur stdout. Importe la lib en spécifieur relatif. |
| `scripts/agy_scratch.py` | Lance UN `agy --print` dans un scratch dir puis déplace les sorties. Évite les snapshots de repo et les rejets de sandbox. Défaut `--model "Gemini 3.6 Flash (High)"`. |
| `scripts/recover_transcript.py` | Plan B : récupère la dernière réponse modèle depuis le transcript agy quand le fichier de sortie est vide. |
| `scripts/grok-deep` | CLI Bun autonome. `run` (bloquant), `start` (détaché), `status`, `list`. Défaut out-dir `$PWD/docs/research/grok`. Mode 100755. |

## Tests

| Fichier | Rôle |
|---|---|
| `scripts/tests/deep-agy-lib.test.mjs` | Unitaires de la lib (dédup, corroboration, red-team, rendu). |
| `scripts/tests/deep-agy-sync.test.mjs` | **Garde-fou critique** : helpers inlinés == lib, octet à octet ; et le Workflow ne cible que le namespace `deep-research:`. |
| `scripts/tests/test_recover_transcript.py` | Unitaires du plan B. |

Lancement : `cd scripts && bun test tests/` puis `python3 tests/test_recover_transcript.py`.
