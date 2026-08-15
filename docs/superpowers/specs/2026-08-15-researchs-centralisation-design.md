---
status: proposed
date: 2026-08-15
---

# Centralisation des sorties research dans `~/.claude/erom-plugins/researchs/`

## Contexte et objectif

Les 4 moteurs du plugin `erom-research` (agy, claude, grok, nlm) écrivent aujourd'hui dans `docs/research/<moteur>/` du projet courant. Les recherches sont éparpillées dans chaque projet : impossible de les lister, de les retrouver, de les recouper.

Objectif : un dépôt central unique, versionné, dans lequel les 4 skills écrivent, et sur lequel une future skill `list` pourra s'appuyer sans index à maintenir.

Destination : `$HOME/.claude/erom-plugins/researchs/`. Le toplevel git est `~/.claude` (repo `eRom/claude-code-config`, vérifié **privé** le 2026-08-15), dont le `.gitignore` ré-inclut déjà `!/erom-plugins/`.

## Décisions actées (2026-08-15)

1. **Layout plat daté, frontmatter comme index.** Un fichier `<DATE>-<SLUG>.md` par recherche à la racine de `researchs/`. Tous les axes de requête (moteur, projet d'origine, date, profondeur) vivent dans le frontmatter YAML.
   **Battu :** partition par moteur (le moteur est une provenance, pas un axe de recherche) ; un dossier par recherche (le livrable est toujours un seul markdown, les annexes sont des artefacts de travail) ; partition par année (YAGNI, migration mécanique possible plus tard car le nom porte la date).
2. **Le dossier garde le nom `researchs`** (cohérence de pluriel avec le voisin `insights/`).
   **Battu :** `research` (anglais correct mais rupture avec la convention locale des dossiers d'`erom-plugins/`).
3. **Artefacts de travail centralisés, non versionnés.** Les ex-`.deep/` (transcripts d'angles, `_render.json`) et `.runs/` (status grok) vont dans `researchs/.runs/<nom-du-run>/`, gitignorés. Un seul endroit à connaître pour le recovery d'un run raté, sans pousser des Mo de transcripts purgeables dans le repo.
   **Battu :** artefacts laissés dans le projet de lancement (recovery dépendant du projet) ; artefacts versionnés (volume pour une valeur décroissante).
4. **Pas de migration de l'existant.** Seul le flux futur alimente le central ; les anciens `docs/research/` restent où ils sont.
   **Battu :** script one-shot de rapatriement.

## Layout cible

```
~/.claude/erom-plugins/researchs/
  .gitignore                      # contient : .runs/
  .runs/<DATE>-<SLUG>/            # artefacts agy/claude (ex-.deep), non versionnés
  .runs/<run interne grok>/       # status.json grok (nommage interne libre, hors contrat)
  2026-08-15-<slug>.md
  2026-08-16-<autre-slug>.md
```

- `DATE` = date ISO du lancement. `SLUG` = règle existante inchangée (lowercase, non-alphanumérique → `-`, répétitions réduites, max 60 chars).
- **Anti-collision** : si `<DATE>-<SLUG>.md` existe déjà (même jour, même slug, autre projet), celui qui écrit suffixe `-2`, `-3`… Le préflight des skills gère pour agy/claude/nlm ; `grok-deep` gère pour grok.
- Le tri lexicographique d'un `ls` donne le tri chronologique.

## Frontmatter canonique (contrat de la future skill `list`)

```yaml
---
title: "Sujet de la recherche"
type: research
engine: agy | claude | grok | notebooklm
source_tool: erom-research:<skill>
project: <basename du cwd de lancement>
created: <DATE ISO>
sensitivity: internal
---
```

- **Obligatoires** : `title`, `type`, `engine`, `project`, `created`. C'est le socle que `list` peut supposer présent sur tout rapport postérieur à ce chantier.
- **Optionnels par moteur** : `depth`, `rounds`, `converged` (agy, claude) ; `notebook_id` (nlm) ; champs de vérification grok.
- `project` est le champ nouveau : il rapatrie en métadonnée l'information aujourd'hui portée implicitement par le chemin `<projet>/docs/research/`. Sans lui, la centralisation perd le lien au projet d'origine.

## Changements par moteur

**agy** (`skills/agy/SKILL.md`) et **claude** (`skills/claude/SKILL.md`) - même mécanique Workflow :
- Préflight : `WRITE_FILE=$HOME/.claude/erom-plugins/researchs/<DATE>-<SLUG>.md`, `DEEP_DIR=$HOME/.claude/erom-plugins/researchs/.runs/<DATE>-<SLUG>`, plus capture `PROJECT=$(basename "$(pwd)")` et boucle anti-collision. Le `$HOME` expansé au préflight reste un chemin absolu littéral : le gotcha des chemins cwd-dépendants passés aux Workflows disparaît pour la sortie.
- `meta` passé au render : ajout de `project: <PROJECT>`.
- Descriptions des skills : « Sauve dans docs/research/… » → « Sauve dans ~/.claude/erom-plugins/researchs/ ».

**`scripts/deep-research-lib.mjs`** :
- `renderReportMarkdown()` : émettre `project: ${meta.project}` dans le frontmatter. Étendre les tests bun existants.

**grok** (`skills/grok/SKILL.md` + `scripts/grok-deep`) - le moteur à normaliser :
- La skill passe `--out-dir "$HOME/.claude/erom-plugins/researchs"` (run, status, list) et un nouveau flag `--project <basename>`.
- `grok-deep` : rapport final nommé `<DATE>-<SLUG>.md` (slugification interne du sujet, même règle, anti-collision inclus) au lieu de `<run_id>.md` ; frontmatter canonique en tête du rapport (aujourd'hui absent) ; ses `.runs/<run_id>/` internes s'installent sous `researchs/.runs/` (nommage interne libre, non versionné, hors contrat).
- Effet assumé : `grok-deep list` sur le central liste les runs grok cross-projets.

**nlm** (`skills/nlm/SKILL.md` + `agents/notebook-creator.md`) :
- Préflight : `OUT=$HOME/.claude/erom-plugins/researchs/<DATE>-<SLUG>.md` + capture `PROJECT` + anti-collision.
- La mission du subagent transmet `PROJECT` ; `notebook-creator` complète son frontmatter aux 5 champs obligatoires (il a déjà `engine`, `notebook_id`).

**Nouveau fichier** : `~/.claude/erom-plugins/researchs/.gitignore` contenant `.runs/`.

## Commit du rapport (défaut proposé, à valider)

Sans commit, « sous git » reste une potentialité : les rapports s'accumulent en untracked dans `~/.claude`. Défaut proposé : en fin de run réussi, la skill fait un commit **ciblé** du seul rapport produit (`git -C ~/.claude add <fichier> && git -C ~/.claude commit -m "research(<engine>): <slug>"`). Jamais de push, jamais de `add -A` (le repo `~/.claude` porte souvent d'autres modifs en cours).

## Hors périmètre

- La skill `list` elle-même (chantier suivant ; cette spec fixe son contrat d'entrée).
- Le dossier `insights/` voisin.
- Migration de l'existant (décision 4).
- Toute écriture résiduelle dans `docs/research/` des projets : supprimée, pas de symlink ni de stub de compatibilité.

## Critères de succès

1. Un run de chaque moteur écrit son rapport dans `~/.claude/erom-plugins/researchs/<DATE>-<SLUG>.md` avec les 5 champs obligatoires du frontmatter, dont `project`.
2. Après un run, `git -C ~/.claude status` ne montre aucun artefact de travail (seul le rapport, ou rien si commit auto validé).
3. Le rapport grok est nommé `<DATE>-<SLUG>.md` et porte le frontmatter canonique.
4. Plus aucune écriture dans `docs/research/` du projet courant par les 4 skills.
5. Tests bun de la lib verts, avec le nouveau champ `project` couvert.
