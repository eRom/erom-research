# Patterns et conventions

_Mis à jour : 2026-08-15_

## Nommage

- Convention 2026-07-30 : plugin `erom-research` = nom du dépôt GitHub `eRom/erom-research` (le dossier local reste `erom-agence-deep-research`, choix assumé pour ne pas casser terminaux et scripts).
- Skills (convention 2026-08-18) : préfixe `deep-` + moteur, jamais le domaine — `deep-gemini`, `deep-claude`, `deep-grok`, `deep-notebook`. Invocation : `/erom-research:deep-<moteur>`. Le préfixe existe parce que le TUI n'affiche que le nom court de la skill une fois sélectionnée : `agy` seul ne disait pas de quoi il s'agissait. Les identifiants internes (`engines: "agy"`, agents `agy-run` / `claude-run`, binaires) ne portent PAS le préfixe : ils nomment le moteur, pas la commande.
- Toute référence croisée interne est **namespacée** : `agentType: 'erom-research:agy-run'`, `subagent_type: "erom-research:notebook-creator"`. Un nom nu résoudrait vers un agent utilisateur et casserait l'autonomie.

## Chemins du plugin

`${CLAUDE_PLUGIN_ROOT}` est expansé en chemin absolu **dans le corps des SKILL.md et des agents**, à la charge du composant (vérifié en session sur la 0.1.1). Chaque fichier qui l'utilise porte aussi le repli documenté : « deux niveaux au-dessus du *Base directory for this skill* injecté ». Jamais de `~` ni de chemin relatif passé en argument de tool : le Workflow et les subagents tournent dans un autre cwd.

## Frontmatter

`description` **toujours** en scalaire double-quoté, guillemets internes convertis en simples. Un ` : ` non quoté casse le parse YAML (voir gotchas).

## Code

- Les helpers de calcul existent en double : inlinés dans `deep-research.js` (contrainte des scripts Workflow) et exportés depuis `deep-research-lib.mjs`. **Toute édition d'un helper partagé se fait à l'identique dans les deux fichiers**, le test de synchro compare octet à octet. `renderReportMarkdown` n'est pas inliné et s'édite seul.
- **Un pipeline, plusieurs moteurs de collecte.** `deep-research.js` porte une table `ENGINES` (`agy`, `claude`) et **seule la phase d'angles** la consulte, via `ENGINE.agentType` et `ENGINE.agentOpts`. Analyse de convergence, vote adversarial et synthèse sont toujours des agents Claude natifs, quel que soit le moteur : router la vérification vers le moteur de collecte coûterait trois appels de quota tiers par claim. Ajouter un moteur = une entrée dans la table, un agent dans `agents/` **et** dans le manifeste, une skill qui passe `engines`. Le défaut retombe sur `agy` si la valeur est absente, et un moteur inconnu logue son repli au lieu de basculer en silence.
- **Épinglage modèle par nature de tâche, pas par moteur.** Les phases mécaniques (angles natifs, votes) sont épinglées `model: 'sonnet'` ; les phases de raisonnement (convergence, synthèse) reçoivent `effort: 'high'` mais **jamais** de `model`, pour hériter de celui de la session. L'engine `agy` ne reçoit aucun épinglage, son forwarder déclarant déjà `model: haiku`.
- Langue : code, commentaires et chaînes techniques en anglais ; en-têtes de rapport rendu et prompts des agents en français.
- CLI testable : `grok-deep` met son dispatch main sous `if (import.meta.main)` et exporte ses helpers (`buildFrontmatter`, `slugify`, `uniqueRunId`), testés par `tests/grok-deep.test.ts`. Un fichier Bun sans extension avec shebang s'importe depuis un test ; vérifié Bun 1.3.5 (et confirmé par le rapport deep du 2026-08-15 : aucun caveat Bun, le fix Node `.ts` ne nous concerne pas).
- Frontmatter canonique des rapports (0.5.0, contrat de la future skill `list`) : `title`, `type: research`, `source_tool`, `engine`, `project`, champs propres au moteur, `created`, `sensitivity: internal`, dans cet ordre. `project` = basename du cwd de lancement.
- Fail-open sur panne infra : un angle mort revient `status: failed` et dégrade la couverture (`coverage.failedAngleLabels`) sans crasher le run ; côté vote adversarial (3 voix), moins de `threshold` voix valides sur 3 rend `verdict: 'unverified'` (compté dans `coverage.unverifiedClaims`) plutôt que de tuer ou de valider silencieusement un claim.

## Skills

Chaque skill fait un **préflight** (binaire présent, auth valide, chemins du plugin résolus) et s'arrête net sinon. Aucune ne déclare un run terminé sans avoir lu un statut terminal ou un rapport. Jamais de findings inventés sur un moteur mort, jamais d'auto-fire depuis un brainstorming.

## Git et versionnage

- Conventional commits en français (`feat:`, `fix(scope):`, `chore(marketplace):`).
- Un bump du plugin entraîne un bump de `metadata.version` du marketplace, au même niveau (patch → patch).
- Publication : commit plugin → push plugin → commit marketplace → push marketplace → `claude plugin marketplace update` → `claude plugin update <nom>@<marketplace>`.
