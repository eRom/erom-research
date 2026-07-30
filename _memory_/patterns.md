# Patterns et conventions

_Mis à jour : 2026-07-30_

## Nommage

- Convention 2026-07-30 : plugin `erom-research` = nom du dépôt GitHub `eRom/erom-research` (le dossier local reste `erom-agence-deep-research`, choix assumé pour ne pas casser terminaux et scripts).
- Skills : le nom du moteur seul, jamais le domaine — `agy`, `grok`, `nlm`. Invocation : `/erom-research:<moteur>`.
- Toute référence croisée interne est **namespacée** : `agentType: 'erom-research:agy-run'`, `subagent_type: "erom-research:notebook-creator"`. Un nom nu résoudrait vers un agent utilisateur et casserait l'autonomie.

## Chemins du plugin

`${CLAUDE_PLUGIN_ROOT}` est expansé en chemin absolu **dans le corps des SKILL.md et des agents**, à la charge du composant (vérifié en session sur la 0.1.1). Chaque fichier qui l'utilise porte aussi le repli documenté : « deux niveaux au-dessus du *Base directory for this skill* injecté ». Jamais de `~` ni de chemin relatif passé en argument de tool : le Workflow et les subagents tournent dans un autre cwd.

## Frontmatter

`description` **toujours** en scalaire double-quoté, guillemets internes convertis en simples. Un ` : ` non quoté casse le parse YAML (voir gotchas).

## Code

- Les helpers de calcul existent en double : inlinés dans `deep-agy.js` (contrainte des scripts Workflow) et exportés depuis `deep-agy-lib.mjs`. **Toute édition d'un helper partagé se fait à l'identique dans les deux fichiers**, le test de synchro compare octet à octet. `renderReportMarkdown` n'est pas inliné et s'édite seul.
- Langue : code, commentaires et chaînes techniques en anglais ; en-têtes de rapport rendu et prompts des agents en français.
- Fail-open sur panne infra : un angle mort revient `status: failed` et dégrade la couverture (`coverage.failedAngleLabels`) sans crasher le run ; un red-team injoignable rend `verdict: 'hold'` plutôt que de tuer un claim.

## Skills

Chaque skill fait un **préflight** (binaire présent, auth valide, chemins du plugin résolus) et s'arrête net sinon. Aucune ne déclare un run terminé sans avoir lu un statut terminal ou un rapport. Jamais de findings inventés sur un moteur mort, jamais d'auto-fire depuis un brainstorming.

## Git et versionnage

- Conventional commits en français (`feat:`, `fix(scope):`, `chore(marketplace):`).
- Un bump du plugin entraîne un bump de `metadata.version` du marketplace, au même niveau (patch → patch).
- Publication : commit plugin → push plugin → commit marketplace → push marketplace → `claude plugin marketplace update` → `claude plugin update <nom>@<marketplace>`.
