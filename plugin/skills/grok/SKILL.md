---
name: grok
description: "Deep research asynchrone via le workflow builtin /deep-research de Grok CLI (Grok 4.5) — claims sourcés, vérification adversariale sur shard indépendant, rapport avec coverage explicite sauvé dans docs/research/grok/. Lancé en arrière-plan — Claude continue la conversation et traite le rapport à la notification de fin. 2e moteur deep hors quota Google (consomme le pool hebdo de l'abonnement X), budget d'agents borné par run. Triggers : /erom-research:grok, 'deep Grok', 'lance une deep Grok', 'status deep Grok'. Complémentaire de agy (multi-rounds piloté Claude, gate plan)."
user-invocable: true
allowed-tools: Bash, Read
---

Deep research par le moteur Grok, asynchrone. Contrairement à `agy` (Claude construit matrice + angles et pilote les rounds), ici la méthodologie est interne au workflow builtin de Grok (plan borné → recherche → vérification adversariale → rapport) : on délègue tout, on récupère un rapport cité. La force du duo : `agy` quand tu veux contrôler le plan de recherche, `grok` quand tu veux un second moteur indépendant sans toucher au quota Google.

CLI wrapper : `${CLAUDE_PLUGIN_ROOT}/scripts/grok-deep` (préflight intégré : exit 127 si grok absent ou non authentifié). Ce chemin est déjà absolu dans ce texte, recopie-le littéralement — appelle-le `CLI` ci-dessous. Non expansé → deux niveaux au-dessus du « Base directory for this skill » injecté ci-dessus, plus `/scripts/grok-deep`.

Requête brute :
$ARGUMENTS

## Modes

- Sujet présent → **start** (défaut). `status [--latest|<run_id>]` → **status**. `list` → **list**.

## start

1. Parse les flags de `$ARGUMENTS` : `--budget N` (défaut 24 ; 8-12 pour une passe légère, 32+ pour une deep lourde — c'est l'`agent_budget` du workflow, cap dur de dépense), `--detach`. Le reste trimé = `<sujet>`. Vide → demander « Quoi deep-rechercher ? » et stop.
2. Lance UN Bash **avec `run_in_background: true`** (c'est le mécanisme de reprise : notification automatique à la fin du run, zéro polling) :
   ```bash
   "<CLI>" run "<sujet>" --out-dir "$(pwd)/docs/research/grok" [--budget N]
   ```
   Avec `--detach` : utiliser la sous-commande `start` au lieu de `run`, en Bash normal court (le run survit alors à la fermeture de cette session ; reprise plus tard via status).
3. Relaie tout de suite : run lancé en arrière-plan, durée typique 3-10 min, le rapport arrivera tout seul. **Reprends la conversation sans attendre.**
4. À la notification de fin de tâche : lis `status.json` (tool Read, chemin `docs/research/grok/.runs/<run_id>/status.json` — le run_id est dans l'enveloppe JSON du task output). Puis :
   - `success` | `partial` → Read du rapport `docs/research/grok/<run_id>.md` : restitue le chemin, le statut de vérification Grok (Verified/Partial), et les ~30 premières lignes verbatim (TL;DR + premiers claims). `partial` = couverture incomplète assumée, les limites sont listées en fin de rapport — les mentionner.
   - `error` → cause (`error` du status.json) + queue de `worker.log`. Pas de findings inventés.
5. Ne JAMAIS déclarer un run terminé sans avoir lu un `status.json` à statut terminal.

## status

```bash
"<CLI>" status --latest --out-dir "$(pwd)/docs/research/grok"
```
(ou `<run_id>` à la place de `--latest`). `running` → donner l'âge et rappeler que la notification arrivera si le run est de cette session (sinon repasser plus tard). Un `running` avec pid mort est automatiquement réparé en `error` par le CLI. Statut terminal → même restitution que start étape 4.

## list

```bash
"<CLI>" list --out-dir "$(pwd)/docs/research/grok"
```

## Notes

- Jamais d'auto-fire depuis un brainstorming : proposer `/erom-research:grok`, Romain décide.
- `usage` dans status.json = conso réelle du run (tokens, appels modèle) ; `usage_is_incomplete: true` est fréquent → lire ces tokens comme un plancher (sous-agents sous-comptés). Vue compte : `/usage` dans le TUI Grok.
- La conso tape le pool hebdomadaire partagé de l'abonnement X (mesuré le 2026-07-30) — c'est le but : préserver les quotas agy/Google.
- Multi-runs en parallèle OK (run dirs isolés). Timeout worker 40 min par défaut (`--timeout-sec`).
- Routage des quatre moteurs : `agy` = justesse pilotée (matrice, plan gate, vote 3 voix) ; `claude` = même pipeline sans dépendance externe ni quota tiers ; `grok` = second moteur indépendant hors quota Google ; `nlm` = référentiel persistant à réinterroger dans le temps.
