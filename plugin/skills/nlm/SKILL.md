---
name: nlm
description: "Deep research via NotebookLM (CLI nlm) — crée un notebook dédié, deep search web Google (~40-70 sources importées, auto-label), synthèse et rapport local avec notebook_id. Moteur deep : le livrable est un référentiel PERSISTANT réinterrogeable ensuite, pour les sujets qui vont vivre. Asynchrone — subagent background, la conversation continue, restitution à la notification. Triggers : /erom-research:nlm, 'deep NotebookLM', 'deep nlm', 'crée un référentiel sur', 'notebook deep'. Complémentaire de agy (multi-rounds piloté, justesse) et grok (2e moteur hors quota Google). Sauve dans ~/.claude/erom-plugins/researchs/."
user-invocable: true
allowed-tools: Bash, Read, Agent
---

Deep research par le moteur NotebookLM, asynchrone. Contrairement à `agy` (Claude pilote matrice + rounds) et `grok` (rapport one-shot d'un moteur indépendant), le livrable est double : un rapport local ET un référentiel persistant de ~40-70 sources (le notebook), réinterrogeable ensuite (voir « Suivi » plus bas). À réserver aux sujets qui vont vivre, ceux où on reviendra poser des questions.

Requête brute :
$ARGUMENTS

## Modes

- Sujet présent → **start** (défaut). `list` → **list**.

## start

1. Parse `$ARGUMENTS` : le reste trimé = `<sujet>`. Vide → demander « Quoi deep-rechercher ? » et stop.
2. Préflight + chemins (UN Bash) - l'échec d'auth se constate en session, pas par une notification d'échec 30 s après le spawn :
   ```bash
   nlm notebook list --json 2>&1 | head -3
   RESEARCH_DIR="$HOME/.claude/erom-plugins/researchs"
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
grep -l "engine: notebooklm" "$HOME"/.claude/erom-plugins/researchs/*.md 2>/dev/null
```
Notebooks côté Google + rapports locaux.

## Notes

- Jamais d'auto-fire depuis un brainstorming : proposer `/erom-research:nlm`, Romain décide.
- **Suivi.** Approfondir un référentiel existant se fait sur son notebook_id (frontmatter du rapport), pas par un re-run : `nlm notebook query <notebook_id> "<question>"`. La skill `/notebook-chat` enveloppe cette commande mais n'est PAS fournie par ce plugin (skill personnelle `~/.claude/skills/notebook-chat/`) : sans elle, le CLI `nlm` fait le travail directement.
- Quotas Google Pro : 500 notebooks × 300 sources, 500 chats/jour, 20 audios/jour. Un run = 1 notebook + 1 chat de synthèse : aucune pression.
- Routage des quatre moteurs : `agy` = justesse pilotée (matrice, plan gate, vote 3 voix) ; `claude` = même pipeline sans dépendance externe ni quota tiers ; `grok` = second moteur indépendant hors quota Google ; `nlm` = référentiel persistant à réinterroger dans le temps.
