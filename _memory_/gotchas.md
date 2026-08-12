# Gotchas

_Mis à jour : 2026-08-12_

## `plugin.json` : `agents` n'accepte pas un répertoire

`"agents": "./agents/"` rend le manifeste **invalide** et le plugin est **entièrement rejeté** : zéro skill, zéro agent, sans message en session. Le schéma impose un chemin de fichier `.md` ou une liste de fichiers. `skills` accepte un répertoire, d'où le piège de la symétrie apparente.

Prouvé en A/B : le dépôt tel quel exposait `{"skills":[],"agents":[]}` ; la même copie sans cette ligne exposait les 5 composants. `claude plugin validate .` rend `❯ agents: Invalid input`.

Forme retenue : `"agents": ["./agents/agy-run.md", "./agents/notebook-creator.md", "./agents/claude-run.md"]`.

**Corollaire, 2e occurrence le 2026-08-12 :** puisque la liste est explicite, **créer un fichier d'agent ne l'enregistre pas**. Un agent absent de cette liste n'existe pas, quel que soit le fichier écrit. Le piège est muet de bout en bout : le workflow peut référencer `agentType: 'erom-research:claude-run'`, le garde-fou de namespace vérifie que la chaîne porte le bon préfixe, pas que l'agent existe, et la suite de tests reste verte. La panne n'apparaît qu'au premier run réel. Tout ajout d'agent touche donc deux fichiers, jamais un.

## `extractFn` du test de synchro est aveugle sur une signature déstructurée

Le garde-fou qui compare la lib et le bloc inliné localise le corps d'une fonction par la **première accolade rencontrée après son nom**. Une fonction déclarée `function f({ a, b } = {})` piège cette mécanique : l'extraction s'arrête sur l'accolade fermante du motif de déstructuration, et le test compare alors deux **signatures identiques** au lieu de deux corps. Le test passe en ne comparant rien.

Corroboré deux fois le 2026-08-12 : `isConverged` était dans ce cas depuis toujours, corps remplacé par `return true` côté workflow sans faire rougir la suite ; et une mutation volontaire de `distinctDomains` vers une signature déstructurée reproduit le défaut à l'identique.

Règle : **jamais de déstructuration dans la liste de paramètres** pour une fonction sous garde-fou. Déstructurer dans le corps (`const { a, b } = opts || {}`). Un méta-test dans `deep-research-sync.test.mjs` vérifie désormais que l'extrait de chaque fonction surveillée contient bien `) {`, ce qui est impossible sur une extraction tronquée.

## Vérifier la syntaxe du script Workflow : deux fausses bonnes commandes

La suite de tests ne parse **jamais** `deep-research.js` : le test de synchro le lit comme du texte et compare des chaînes. La seule barrière syntaxique est explicite, et deux formes intuitives ne marchent pas, mesurées dans les deux sens le 2026-08-12 :

- `bun build scripts/deep-research.js` échoue **toujours**, le script se terminant par un `return` de niveau racine (`Top-level return cannot be used inside an ECMAScript module`).
- `bun -e "new Function(readFileSync(...))"` sort en **code 0 même sur du code invalide** : faux positif systématique.

Forme qui discrimine réellement, `SYNTAXE OK` sur le vrai fichier et `SYNTAXE KO` plus exit 1 sur du code cassé :

```bash
bun -e 'const s=require("fs").readFileSync("scripts/deep-research.js","utf8"); try { new (Object.getPrototypeOf(async function(){}).constructor)(s.replace(/^export /gm,"")); console.log("SYNTAXE OK") } catch(e) { console.error("SYNTAXE KO:", e.message); process.exit(1) }'
```

Le constructeur `AsyncFunction` accepte le `await` et le `return` de niveau racine, et le `replace` neutralise l'unique `export` de la ligne 1.

## Tester le plugin en local avant publication

Le plugin installé est une **copie en cache de la version publiée**, téléchargée depuis GitHub. Le code du repo de dev n'est jamais celui qui tourne en session : les runs de vérification testeraient l'ancienne version sans le dire.

Voie qui marche, après quatre formats essayés le 2026-08-12 : créer un `marketplace.json` **hors du repo** puis `claude plugin marketplace add <dossier>`. Deux pièges de schéma :

- un champ `owner` (objet) est **exigé**, alors qu'il n'apparaît pas dans les extraits du marketplace publié ;
- `source` doit être un objet typé. Les types `local` et `directory` sont rejetés (« source type your Claude Code version does not support »), et `git-subdir` avec un chemin nu rend « Invalid git URL ».

Seule forme acceptée : `{"source":"git-subdir","url":"file:///chemin/absolu/du/repo","path":"plugin","ref":"<branche>"}`. Le plugin est **cloné**, donc toute modification du repo exige un `uninstall` puis `install` pour être visible.

Ensuite, **`claude plugin disable` ne suffit pas** à libérer le namespace quand deux plugins portent le même nom : les skills continuent de résoudre vers la version publiée, y compris désactivée. Il faut `uninstall` la version publiée (en précisant le bon `--scope`, l'erreur le nomme), et nettoyer la référence morte laissée dans `enabledPlugins` du `settings.local.json`, sinon les deux entrées passent en `failed to load`.

## Frontmatter YAML : le ` : ` non quoté

Une valeur non quotée contenant ` : ` (typiquement `Triggers : /ma-skill`) casse le parse. Effet : `YAML frontmatter failed to parse… loads with empty metadata (all frontmatter fields silently dropped)`, donc `name`, `allowed-tools`, `model` évaporés.

Claude Code 2.1.220 a un fallback qui re-quote les valeurs contenant `: ` et sauve la mise ; ce fallback n'existe pas sur les versions antérieures. Toujours quoter. 8 fichiers de `~/.claude` étaient dans ce cas.

**Corollaire de méthode** : vérifier un frontmatter par regex ne prouve rien. Il faut un vrai parseur (`yaml.safe_load`) ou `claude plugin validate`.

## Frontmatter : `---` avec espace traînante

Un délimiteur de fermeture écrit `--- ` (espace en fin de ligne) n'est jamais reconnu, le frontmatter n'est donc pas délimité du tout. Invisible à l'œil et à `git diff`. Vu sur `~/.claude/agents/search-perplexity.md`.

## `claude plugin update` exige le nom qualifié

`claude plugin update erom-research` → `✘ Plugin "erom-research" not found`. Il faut `claude plugin update erom-research@erom-marketplace`. [candidat 1x - session 2026-07-30]

## `agy` valide strictement le libellé du modèle

Un `--model` inconnu fait échouer l'appel avec `model X is not recognized`, **et la liste des libellés valides s'affiche dans l'erreur** — c'est la façon la plus rapide de la consulter. Le format attendu est le libellé (`Gemini 3.6 Flash (High)`), pas le slug rendu par `agy models` (`gemini-3.6-flash-high`).

Conséquence : un défaut de modèle périmé ne casse rien tant que l'ancien modèle existe encore, il dégrade juste silencieusement la qualité. `agy_scratch.py` tournait ainsi sur 3.5 alors que le reste du harnais était en 3.6.

## Les helpers partagés sont dupliqués

`deep-research.js` inline les helpers de `deep-research-lib.mjs` parce qu'un script Workflow ne peut pas importer de fichier local. `deep-research-sync.test.mjs` compare les corps de fonction **octet à octet** : éditer un helper d'un seul côté fait rougir la suite. `renderReportMarkdown` n'est pas inliné et échappe à la contrainte.

## Dépôts et push

- Le dépôt a été créé avec un remote **SSH** alors que `gh` opère en **https** et que l'agent SSH n'a aucune clé chargée : `Permission denied (publickey)`. Remote basculé en https, comme `erom-marketplace`.
- `~/.claude` est un dépôt git **sans remote** : les commits y restent locaux, il n'y a rien à pousser.

## Périmètre de `~/.claude/scripts/agy/`

Ce dossier n'était pas un dossier deep research : `classify_source.py` et `recover_transcript.py` servent aussi `/transcribe`, `/video`, `/media`, `/doc-to-md`, qui restent dans `~/.claude`. Seule la partie deep a migré ; `recover_transcript.py` existe désormais en deux exemplaires assumés (ici et là-bas).
