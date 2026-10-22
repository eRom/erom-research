---
name: deep-notebook
description: "Deep research via NotebookLM (CLI nlm) — crée un notebook dédié, deep search web Google (~40-70 sources importées, auto-label), synthèse et rapport local avec notebook_id. Moteur deep : le livrable est un référentiel PERSISTANT réinterrogeable ensuite, pour les sujets qui vont vivre. Asynchrone — subagent background, la conversation continue, restitution à la notification. Triggers : /erom-research:deep-notebook, 'deep NotebookLM', 'deep nlm', 'deep notebook', 'crée un référentiel sur', 'notebook deep'. Complémentaire de deep-gemini (multi-rounds piloté, justesse) et deep-grok (2e moteur hors quota Google). Sauve dans ~/.claude/erom-store/researchs/."
user-invocable: true
allowed-tools: Bash, Read, Agent
---

Deep research par le moteur NotebookLM, asynchrone. Contrairement à `deep-gemini` (Claude pilote matrice + rounds) et `deep-grok` (rapport one-shot d'un moteur indépendant), le livrable est double : un rapport local ET un référentiel persistant de ~40-70 sources (le notebook), réinterrogeable ensuite (voir « Suivi » plus bas). À réserver aux sujets qui vont vivre, ceux où on reviendra poser des questions.

Requête brute :
$ARGUMENTS

## Mode auto

Actif si `$ARGUMENTS` contient le token `--auto` (appel headless par un autre programme : `claude -p`, stdin `/erom-research:deep-notebook --auto <sujet>`). Sans ce token, ignore toute cette section : le flux interactif ci-dessous reste strictement inchangé.

Contrat de sortie : la **dernière ligne non vide** de ton message final est exactement `[REPORT] <chemin absolu>` ou `[ABORT] <cause en une phrase>`, sur une seule ligne, rien après. En mode auto, tu ne poses JAMAIS de question, tu n'appelles JAMAIS `SendUserFile`, tu n'écris JAMAIS en mémoire durable. Tout blocage imprévu → `[ABORT] <cause>`.

Chemins des scripts : `${CLAUDE_PLUGIN_ROOT}/scripts/...`, déjà absolu dans ce texte, recopie-le littéralement. Non expansé → deux niveaux au-dessus du « Base directory for this skill » injecté ci-dessus, plus `/scripts/...`.

Déviations par rapport au flux `start` :

| Point | Mode auto |
|---|---|
| Modes | retire le token `--auto` de `$ARGUMENTS` avant le parse ; le reste trimé est le sujet |
| start 1, sujet vide | `[ABORT] Sujet vide` (aucune question) |
| start 2, erreur d'auth `nlm` | `[ABORT] nlm login requis : session NotebookLM expirée` (pas de demande à Romain) |
| start 3, spawn | ajoute la ligne `AUTO_MODE=1` à la mission |
| start 4, « Reprends la conversation sans attendre » | **ne reprends pas : attends le rapport.** Voir « Attente » ci-dessous |
| start 5, restitution | voir « Fin de run » ci-dessous |

### Attente

Appelle en boucle, en **foreground** (jamais `run_in_background`, jamais `sleep`, jamais Monitor) :

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-file.mjs" "<OUT>" 90
```

Code 0 : le rapport est apparu, passe à « Fin de run ». Code 1 : timeout de 90 s, relance. Code 2 : arguments invalides, `[ABORT] Appel de wait-for-file invalide`.

Entre deux appels, lis toute task-notification de l'agent `notebook-creator` arrivée entre-temps (elle est livrée entre deux appels Bash) :

- **Échec signalé par l'agent** (son texte final décrit un échec, sans notebook_id) → `[ABORT] <cause rapportée par l'agent, en une phrase sans retour à la ligne>`. Si un fichier existe à `<OUT>` (rapport d'échec de l'agent), mets-le à la corbeille : `trash "<OUT>"` (jamais `rm`), pour que le store ne garde aucun rapport d'échec.
- **Fin de l'agent mais `<OUT>` toujours absent** → UN dernier appel `wait-for-file.mjs "<OUT>" 10` ; code 0 → « Fin de run », sinon `[ABORT] L'agent a terminé sans écrire de rapport`.
- **40 minutes cumulées sans rapport** → `[ABORT] Délai dépassé (40 min) sans rapport`. Compte explicitement tes appels de 90 s : le 27e appel sans succès (≈ 40 min) clôt l'attente.

### Fin de run

1. Contrôle le rapport :
   ```bash
   bun "${CLAUDE_PLUGIN_ROOT}/scripts/check-report.mjs" "<OUT>"
   ```
2. Code 1 → `[ABORT] <la ligne rendue par le script>`. Si cette ligne commence par `Échec de l'agent`, mets aussi `<OUT>` à la corbeille (`trash "<OUT>"`). Un rapport partiel (`Rapport incomplet : notebook_id absent`) reste en place pour diagnostic.
3. Code 0 → Read `<OUT>`, puis la restitution habituelle du start 5 (chemin, notebook_id + URL, source_count, ~30 premières lignes verbatim, voie de suivi), **puis**, en toute dernière ligne, `[REPORT] <OUT>`. Rien après.

## Modes

- Sujet présent → **start** (défaut). `list` → **list**.

## start

1. Parse `$ARGUMENTS` : le reste trimé = `<sujet>`. Vide → demander « Quoi deep-rechercher ? » et stop.
2. Préflight + chemins (UN Bash) - l'échec d'auth se constate en session, pas par une notification d'échec 30 s après le spawn :
   ```bash
   nlm notebook list --json 2>&1 | head -3
   RESEARCH_DIR="$HOME/.claude/erom-store/researchs"
   BASE="<DATE>-<SLUG>"; N=2
   while test -e "$RESEARCH_DIR/$BASE.md"; do BASE="<DATE>-<SLUG>-$N"; N=$((N+1)); done
   mkdir -p "$RESEARCH_DIR"
   echo "OUT=$RESEARCH_DIR/$BASE.md"
   echo "PROJECT=$(basename "$(pwd)")"
   ```
   `DATE` = aujourd'hui ISO. `SLUG` = sujet lowercased, non-alphanumérique → `-`, répétitions réduites, max 60 chars. Chemin ABSOLU obligatoire (le subagent tourne dans un autre cwd, `~` et chemins relatifs non expansés).
   Erreur d'auth dans la sortie (« Cookies have expired ») ou commande en échec → demander à Romain de lancer `! nlm login` puis STOP. Ne JAMAIS lancer `nlm login` soi-même (interactif, bloquerait la session).
3. Spawn le subagent `notebook-creator` (tool Agent, `subagent_type: "erom-research:notebook-creator"` - il est `background: true`, la task-notification arrive toute seule). La mission fournit : `<sujet>`, `REPORT_PATH=<OUT>` (littéral, absolu) et `PROJECT=<PROJECT>`. Le subagent construit lui-même la requête deep search riche et écrit le rapport final à REPORT_PATH.
4. Relaie tout de suite : run lancé en arrière-plan, durée typique 10-20 min, le rapport arrivera tout seul. **Reprends la conversation sans attendre.**
5. À la notification de fin : Read `<OUT>`.
   - Rapport présent → restitue : chemin, notebook_id + URL (frontmatter), source_count, les ~30 premières lignes verbatim (synthèse), et la voie de suivi sur ce notebook_id (voir « Suivi »).
   - Rapport absent → restitue le rapport d'échec du subagent (commande exacte + erreur). Pas de findings inventés.
6. Ne JAMAIS déclarer un run terminé sans avoir lu `<OUT>` ou un rapport d'échec explicite.

## list

```bash
nlm notebook list
grep -l "engine: notebooklm" "$HOME"/.claude/erom-store/researchs/*.md 2>/dev/null
```
Notebooks côté Google + rapports locaux.

## Notes

- Jamais d'auto-fire depuis un brainstorming : proposer `/erom-research:deep-notebook`, Romain décide.
- **Suivi.** Approfondir un référentiel existant se fait sur son notebook_id (frontmatter du rapport), pas par un re-run : `nlm notebook query <notebook_id> "<question>"`. La skill `/notebook-chat` enveloppe cette commande mais n'est PAS fournie par ce plugin (skill personnelle `~/.claude/skills/notebook-chat/`) : sans elle, le CLI `nlm` fait le travail directement.
- Quotas Google Pro : 500 notebooks × 300 sources, 500 chats/jour, 20 audios/jour. Un run = 1 notebook + 1 chat de synthèse : aucune pression.
- Routage des quatre moteurs : `deep-gemini` = justesse pilotée (matrice, plan gate, vote 3 voix) ; `deep-claude` = même pipeline sans dépendance externe ni quota tiers ; `deep-grok` = second moteur indépendant hors quota Google ; `deep-notebook` = référentiel persistant à réinterroger dans le temps.
