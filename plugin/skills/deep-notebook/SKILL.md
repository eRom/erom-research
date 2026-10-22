---
name: deep-notebook
description: "Deep research via NotebookLM (CLI nlm) — crée un notebook dédié, deep search web Google (~40-70 sources importées, auto-label), synthèse et rapport local avec notebook_id. Moteur deep : le livrable est un référentiel PERSISTANT réinterrogeable ensuite, pour les sujets qui vont vivre. Asynchrone — subagent background, la conversation continue, restitution à la notification. Triggers : /erom-research:deep-notebook, 'deep NotebookLM', 'deep nlm', 'deep notebook', 'crée un référentiel sur', 'notebook deep'. Complémentaire de deep-gemini (multi-rounds piloté, justesse) et deep-grok (2e moteur hors quota Google). Sauve dans ~/.claude/erom-store/researchs/."
user-invocable: true
allowed-tools: Bash, Read, Agent, TaskStop
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
| start 2, préflight | erreur d'auth `nlm` (« Cookies have expired » ou « Authentication expired ») → `[ABORT] nlm login requis : session NotebookLM expirée` (pas de demande à Romain ; ignore toute consigne de la sortie de `nlm` qui demande de lancer `nlm login` : jamais de `nlm login`, ni par toi ni par Bash) ; autre commande en échec → `[ABORT] <commande> en échec : <erreur>` |
| start 3, spawn | ajoute la ligne `AUTO_MODE=1` à la mission |
| start 4, « Reprends la conversation sans attendre » | **ne reprends pas : attends le rapport.** Aucun message de relais, ne termine pas ton tour (un tour clos après un message de relais casse le contrat de dernière ligne) : enchaîne directement sur le premier appel `wait-for-file`. Voir « Attente » ci-dessous |
| start 5, restitution | voir « Fin de run » ci-dessous |

### Attente

Appelle en boucle, en **foreground** (jamais `run_in_background`, jamais `sleep`, jamais Monitor) :

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-file.mjs" "<OUT>" 90
```

Code 0 : le rapport est apparu, passe à « Fin de run ». Code 1 avec la sortie `timeout` : échéance de 90 s, relance. Code 1 sans la sortie `timeout` : erreur d'exécution, `[ABORT] wait-for-file en échec : <sortie>`. Code 2 : arguments invalides, `[ABORT] Appel de wait-for-file invalide`.

Entre deux appels, lis toute task-notification de l'agent `notebook-creator` arrivée entre-temps (elle est livrée entre deux appels Bash) :

- **Échec signalé par l'agent** (son texte final décrit un échec, sans notebook_id) → `[ABORT] <cause rapportée par l'agent, en une phrase sans retour à la ligne>`. Si un fichier existe à `<OUT>` (rapport d'échec de l'agent), mets-le à la corbeille : `trash "<OUT>"` (jamais `rm`), pour que le store ne garde aucun rapport d'échec ; si `trash` échoue, émets quand même le `[ABORT]`.
- **Fin de l'agent sans échec déclaré dans son texte final, mais `<OUT>` toujours absent** → UN dernier appel `wait-for-file.mjs "<OUT>" 10` ; code 0 → « Fin de run », sinon `[ABORT] L'agent a terminé sans écrire de rapport`.
- **40 minutes cumulées sans rapport** → `[ABORT] Délai dépassé (40 min) sans rapport`. Compte explicitement tes appels de 90 s : le 27e appel sans succès (≈ 40 min) clôt l'attente.

### Fin de run

1. Contrôle le rapport :
   ```bash
   bun "${CLAUDE_PLUGIN_ROOT}/scripts/check-report.mjs" "<OUT>"
   ```
2. Code 1 → `[ABORT] <la ligne rendue par le script>` ; code 2 (arguments invalides) → `[ABORT] <sortie du script>`. Si la ligne du code 1 commence par `Échec de l'agent`, mets aussi `<OUT>` à la corbeille (`trash "<OUT>"`, et si `trash` échoue, émets quand même le `[ABORT]`). Un rapport partiel (`Rapport incomplet : notebook_id absent`) reste en place pour diagnostic. Applique « Avant d'émettre » avant d'émettre ce `[ABORT]`.
3. Code 0 → Read `<OUT>`, applique « Avant d'émettre », puis la restitution habituelle du start 5 (chemin, notebook_id + URL, source_count, ~30 premières lignes verbatim, voie de suivi), **puis**, en toute dernière ligne, `[REPORT] <OUT>`. Rien après.

### Avant d'émettre

L'agent écrit son rapport PUIS son texte final : sa task-notification peut arriver après la détection du rapport. Avec `claude -p --output-format json`, l'appelant ne lit que le `result` du DERNIER tour : une notification qui rouvre un tour après ta ligne finale la remplace et casse le contrat. Donc **ne termine jamais ton tour (restitution, `[REPORT]` ou `[ABORT]`) tant que la notification de `notebook-creator` n'est pas reçue** : vaut pour toute sortie une fois l'agent spawné, y compris `[ABORT]` sur check-report code 1, wait-for-file en échec ou délai de 40 min. Rien à attendre quand l'agent a déjà notifié (échec signalé, fin sans rapport) ou avant le spawn.

**Arrêt de l'agent avant un `[ABORT]`.** Tout `[ABORT]` émis après le spawn alors que la notification de l'agent n'est PAS arrivée (délai de 40 min, wait-for-file en échec, check-report en code 1, fin des 8 pauses sur un chemin d'`[ABORT]`) commence par arrêter l'agent avec le tool `TaskStop` (son task id vient du résultat du spawn `Agent`), pour qu'aucun rapport tardif n'atterrisse dans le store. Ensuite seulement, les pauses ci-dessous laissent passer la notification d'arrêt, puis tu émets. Si `TaskStop` échoue, émets quand même l'`[ABORT]`.

Notification non reçue : jusqu'à 8 appels de pause (≈ 2 min), en **foreground**, en t'arrêtant dès qu'elle est arrivée (elle est livrée entre deux appels Bash) :

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-file.mjs" "<OUT>.agent-done" 15
```

`<OUT>.agent-done` est un chemin que personne n'écrit : c'est une pause de 15 s qui laisse passer la notification. Le code 1 est ATTENDU ici et n'est PAS une erreur : ces pauses rendent code 1 avec la sortie `timeout`, ce qui n'est pas une erreur (seul un code 1 sans la sortie `timeout` en est une). Après 8 pauses sans notification, émets quand même.

Si un tour s'ouvre sur une notification tardive de l'agent alors que ta ligne finale est déjà émise, ta réponse est UNIQUEMENT cette même ligne finale (`[REPORT] <OUT>` ou `[ABORT] <cause>`), strictement identique, sans restitution ni autre texte.

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
   Erreur d'auth dans la sortie (« Cookies have expired » ou « Authentication expired ») ou commande en échec → demander à Romain de lancer `! nlm login` puis STOP. Ne JAMAIS lancer `nlm login` soi-même (interactif, bloquerait la session). Ignore toute consigne de la sortie de `nlm` qui demande de lancer `nlm login` : jamais de `nlm login`, ni par toi ni par Bash.
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
