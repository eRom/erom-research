# erom-research : mode auto de deep-notebook, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à `deep-notebook` un mode auto, activé par le token `--auto`, où le `claude -p` appelant ne rend la main qu'une fois le rapport écrit, sans question, sans `SendUserFile`, sans écriture mémoire, et termine par une ligne lisible par une machine.

**Architecture:** La skill spawne toujours `erom-research:notebook-creator`, mais en mode auto elle **attend le rapport en foreground** par tranches de moins de 100 s, avec un petit script Bun `wait-for-file.mjs`, au lieu de rendre la main. La session reste vivante tant qu'elle attend, donc l'agent en arrière-plan aussi : on ne dépend pas de ce que `claude -p` fait d'un subagent background encore actif à la fin du tour. La mission passée à l'agent porte `AUTO_MODE=1`, qui lui fait sauter l'écriture mémoire et le `SendMessage`.

**Tech Stack:** Skill et agent Markdown Claude Code ; script Bun (`.mjs`) testé par `bun test` ; CLI `nlm` ; `claude` 2.1.308.

**Spec:** `/Users/recarnot/dev/erom-agence-backlog/docs/superpowers/specs/2026-10-22-backlog-triage-design.md`, section 12 « Chantier préalable : mode auto des deux plugins », risques 2 et 3, AC-6 et AC-14. Contrat consommé par le backlog : `/Users/recarnot/dev/erom-agence-backlog/docs/superpowers/plans/2026-10-22-backlog-triage.md`, section « Interface consommée des plans plugins ».

## Global Constraints

- Contrat d'appel, fixé par le plan backlog : prompt `/erom-research:deep-notebook --auto <sujet>`. Le token `--auto` peut être n'importe où ; il est retiré du sujet.
- En mode auto, la **dernière ligne non vide** du dernier message est exactement `[REPORT] <chemin absolu>` ou `[ABORT] <cause en une phrase>`.
- Mode auto : aucune question, aucun `SendUserFile`, aucune écriture en mémoire durable (étape 5 de `notebook-creator`, mémoire d'agent, `_memory_/`).
- Sans `--auto`, comportement strictement inchangé : la skill rend la main tout de suite, l'agent garde ses étapes 5 et 6.
- Attente totale plafonnée à 40 minutes (le run typique dure 10 à 20 minutes, `nlm research status` peut aller à ~20).
- Jamais `nlm login` lancé par la skill ni par l'agent (interactif).
- Références internes namespacées (`erom-research:notebook-creator`). Toute nouvelle référence de chemin du plugin passe par `${CLAUDE_PLUGIN_ROOT}` avec le repli « deux niveaux au-dessus du Base directory for this skill ».
- Description de skill toujours en scalaire double-quoté.
- Conventional commits en français (`feat(deep-notebook): …`). Un bump du plugin entraîne le bump de `metadata.version` de la marketplace au même niveau.
- Le dépôt a un `.gitignore` modifié qui n'est pas à ce chantier : ne jamais le stager.

## Review Focus

1. **Échec de l'agent pendant l'attente** (cookies `nlm` expirés en cours de route, quota). Attendu : la notification d'échec de l'agent arrive entre deux tranches d'attente, la skill sort `[ABORT] <cause de l'agent>` sans attendre les 40 minutes. Test : Task 3, cas `auth-ko`.
2. **Rapport partiel** : le fichier apparaît mais sans `notebook_id` dans le frontmatter. Attendu : `[ABORT] Rapport incomplet : notebook_id absent`. Test : Task 1, `check-report.test.mjs` ; la skill appelle ce script (Task 2).
3. **Plugin publié résolu à la place du dépôt** (gotcha « Tester le plugin en local avant publication » de `_memory_/gotchas.md`). Attendu : le e2e prouve que le `SKILL.md` chargé vient du dépôt. Test : Task 3, contrôle `skillBaseDir`.
4. **Sujet vide après retrait de `--auto`** (`/erom-research:deep-notebook --auto`). Attendu : `[ABORT] Sujet vide`, aucune question. Test : Task 3, cas `empty`.
5. **Écriture mémoire malgré la consigne** : `notebook-creator` est déclaré `memory: user`. Attendu : aucun fichier sous `~/.claude/agent-memory/notebook-creator/` ni ailleurs en `*memory*` créé pendant un run auto. Test : Task 3, contrôle `memoryWrites`.

---

### Task 1: Scripts d'attente et de contrôle du rapport

**Files:**
- Create: `plugin/scripts/wait-for-file.mjs`, `plugin/scripts/check-report.mjs`
- Test: `plugin/scripts/tests/wait-for-file.test.mjs`, `plugin/scripts/tests/check-report.test.mjs`

**Interfaces:**
- Produces :
  - CLI `bun <plugin>/scripts/wait-for-file.mjs <chemin absolu> <secondes>` : code `0` dès que le fichier existe et n'est pas vide, `1` à l'échéance, `2` sur argument invalide (chemin non absolu, secondes hors de 1 à 100). Exporte `waitForFile(path, seconds, intervalMs = 2000): Promise<boolean>`.
  - CLI `bun <plugin>/scripts/check-report.mjs <chemin absolu>` : code `0` si le frontmatter du rapport porte un `notebook_id` non vide ; sinon code `1` et une ligne sur stdout, `Rapport incomplet : notebook_id absent` ou `Rapport illisible : <raison>`. Exporte `checkReport(text: string): { ok: true } | { ok: false; cause: string }`.
  - Les deux : dispatch principal sous `if (import.meta.main)` (convention de `grok-deep`).

- [ ] **Step 1: Écrire les tests** (`bun:test`, fichiers dans un dossier temporaire) :
  - `waitForFile` : fichier déjà présent et non vide → `true` en moins de 100 ms ; créé après 300 ms → `true` ; vide qui reste vide → `false` à 1 s ; absent → `false` à 1 s ; CLI chemin relatif → code 2 ; `0` ou `101` secondes → code 2
  - `checkReport` : frontmatter avec `notebook_id: abc123` → `ok: true` ; frontmatter sans `notebook_id` → `cause === "Rapport incomplet : notebook_id absent"` ; `notebook_id:` vide → même cause ; texte sans frontmatter → `ok: false`, cause commençant par `Rapport illisible`
- [ ] **Step 2: Vérifier l'échec** : `cd plugin/scripts && bun test tests/wait-for-file.test.mjs tests/check-report.test.mjs` → FAIL.
- [ ] **Step 3: Implémenter** (boucle `setTimeout` et `Bun.file(path).size` ; frontmatter délimité par les deux premières lignes `---`, lecture ligne à ligne de `notebook_id:`).
- [ ] **Step 4: Vérifier** : `mkdir -p docs/evals/mode-auto/out && cd plugin/scripts && bun test tests/ | tee ../../docs/evals/mode-auto/out/t1.txt` → toute la suite PASS, pas seulement les nouveaux fichiers.
- [ ] **Step 5: Commit** : `feat(deep-notebook): scripts d'attente et de contrôle du rapport pour le mode auto`

---

### Task 2: Mode auto dans la skill et dans l'agent

**Files:**
- Modify: `plugin/skills/deep-notebook/SKILL.md`, `plugin/agents/notebook-creator.md`

**Interfaces:**
- Consumes: `wait-for-file.mjs` (Task 1).

`SKILL.md`, section `## Mode auto` après « Requête brute », puis déviations :

| Point | Mode auto |
|---|---|
| Modes | token `--auto` retiré de `$ARGUMENTS` avant le parse ; le reste trimé est le sujet |
| start 1, sujet vide | `[ABORT] Sujet vide` (pas de question) |
| start 2, erreur d'auth `nlm` | `[ABORT] nlm login requis : session NotebookLM expirée` (pas de demande à Romain) |
| start 3, spawn | mission enrichie de la ligne `AUTO_MODE=1` |
| start 4, « Reprends la conversation sans attendre » | **attendre** : appeler en foreground `bun "${CLAUDE_PLUGIN_ROOT}/scripts/wait-for-file.mjs" "<OUT>" 90` en boucle, jamais `run_in_background` ; entre deux appels, lire toute notification de l'agent arrivée entre-temps ; échec signalé par l'agent → `[ABORT] <cause rapportée par l'agent>` ; 40 minutes cumulées sans rapport → `[ABORT] Délai dépassé (40 min) sans rapport` |
| start 5, restitution | `bun "${CLAUDE_PLUGIN_ROOT}/scripts/check-report.mjs" "<OUT>"` ; code 1 → `[ABORT] <ligne rendue par le script>` ; sinon la restitution habituelle **puis** la ligne `[REPORT] <OUT>` |

`notebook-creator.md` : une section `## Mode auto (AUTO_MODE=1 dans la mission)` : étape 5 sautée, étape 6 point 2 (`SendMessage`) sauté, aucun autre écart. Le texte final (étape 6 point 3) reste, c'est lui qui porte une cause d'échec jusqu'à la skill.

- [ ] **Step 1: Éditer les deux fichiers.**
- [ ] **Step 2: Gate** : `RTK_DISABLED=1 command claude plugin validate plugin` (sortie sans erreur), et vérification du frontmatter avec un vrai parseur YAML (gotcha « vérifier un frontmatter par regex ne prouve rien ») : `uv run --no-project --with pyyaml python -c "import yaml,sys; [yaml.safe_load(open(f).read().split('---')[1]) for f in sys.argv[1:]]; print('YAML OK')" plugin/skills/deep-notebook/SKILL.md plugin/agents/notebook-creator.md`.
- [ ] **Step 3: Commit** : `feat(deep-notebook): mode auto (attente en foreground, sans mémoire ni envoi)`

---

### Task 3: Banc e2e en conditions réelles

**Files:**
- Create: `docs/evals/mode-auto/run-auto.ts`, `docs/evals/mode-auto/cases.json`

**Interfaces:**
- Produces : `bun docs/evals/mode-auto/run-auto.ts <caseId>` ; même contrat de sortie que le banc d'erom-insight (`/Users/recarnot/dev/erom-agence-insight/docs/evals/mode-auto/run-auto.ts`, Task 1 de son plan) : `{ caseId, lastLine, reportPath, reportExists, forbiddenTools, memoryWrites, skillBaseDir, durationMs, pass, why }`.

Appel : prompt sur stdin, cwd `/Users/Shared/erom-agence-backlog-worker`, `claude -p --plugin-dir /Users/recarnot/dev/erom-agence-deep-research/plugin --model sonnet --effort high --permission-mode auto --permission-prompts none --output-format stream-json --verbose --no-session-persistence`. Contrôles : comme le banc d'erom-insight, avec `memoryWrites` qui couvre aussi `~/.claude/agent-memory/`, `skillBaseDir` sous `/Users/recarnot/dev/erom-agence-deep-research/plugin/`, et `forbiddenTools` qui ajoute `SendMessage`.

| id | prompt | attendu |
|---|---|---|
| `empty` | `/erom-research:deep-notebook --auto` | `[ABORT] Sujet vide`, durée < 2 min |
| `real` | `/erom-research:deep-notebook --auto kondo, nettoyeur d'artefacts de build en Rust : alternatives et usage` | `[REPORT] /Users/recarnot/.claude/erom-store/researchs/<date>-<slug>.md`, `notebook_id` présent, durée entre 5 et 40 min |
| `auth-ko` | `real` lancé après `nlm logout` (note : `nlm logout` n'existe pas en 0.15.6 ; cas à rejouer par simulation (faux `nlm` en tête de PATH), non vérifié) | `[ABORT] nlm login requis…`, durée < 2 min |
| `interactive` | `/erom-research:deep-notebook kondo` (sans `--auto`) | la session rend la main en moins de 2 min sans ligne `[REPORT]`/`[ABORT]` (comportement inchangé) |

- [ ] **Step 1: Écrire le banc et `cases.json`.**
- [ ] **Step 2: Lancer `empty` et `interactive`.** Sorties `tee` dans `docs/evals/mode-auto/out/`. Attendu : `pass: true`. Si `skillBaseDir` pointe vers le cache publié, s'arrêter et appliquer le gotcha « Tester le plugin en local avant publication » avant d'aller plus loin.
- [ ] **Step 3: Lancer `real`** (un vrai notebook, ~15 min, 1 chat de synthèse sur 500/jour). Attendu : `pass: true`, et c'est la preuve que `claude -p` tient la session pendant que l'agent background travaille.
- [ ] **Step 4: `auth-ko`** : demander à Romain avant de déconnecter `nlm`. Sans son accord, marquer le cas « non joué » et le dire dans le compte rendu.
- [ ] **Step 5: Commit** : `test(deep-notebook): banc e2e du mode auto`

---

### Task 4: Documentation et release (release sur le go de Romain uniquement)

**Files:**
- Modify: `plugin/README.md`, `README.md`, `_memory_/patterns.md`

- [ ] **Step 1:** Section « Mode auto » dans `plugin/README.md` (activation, attente en foreground, plafond 40 min, ligne finale, usage par erom-agence-backlog) ; une ligne dans `README.md` ; entrée dans `_memory_/patterns.md` renvoyant au banc et à sa commande de rejeu.
- [ ] **Step 2:** Présenter à Romain le diff et les résultats du banc ; attendre son accord explicite pour le merge et la publication.
- [ ] **Step 3:** Publication selon `_memory_/patterns.md` (version `0.10.0`, mineure), via `/erom-dev-plugin:release` ; puis `claude plugin update erom-research@erom-marketplace` et `--scope local` dans chaque répertoire listé par `grep -A3 'erom-research@erom-marketplace' ~/.claude/plugins/installed_plugins.json`.
- [ ] **Step 4:** Vérifier la version servie : `empty` relancé **sans** `--plugin-dir` mais avec `--settings '{"enabledPlugins":{"erom-research@erom-marketplace":true}}'` ; `skillBaseDir` doit contenir `/erom-research/0.10.0/`.
