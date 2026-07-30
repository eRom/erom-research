# Gotchas

_Mis à jour : 2026-07-30_

## `plugin.json` : `agents` n'accepte pas un répertoire

`"agents": "./agents/"` rend le manifeste **invalide** et le plugin est **entièrement rejeté** : zéro skill, zéro agent, sans message en session. Le schéma impose un chemin de fichier `.md` ou une liste de fichiers. `skills` accepte un répertoire, d'où le piège de la symétrie apparente.

Prouvé en A/B : le dépôt tel quel exposait `{"skills":[],"agents":[]}` ; la même copie sans cette ligne exposait les 5 composants. `claude plugin validate .` rend `❯ agents: Invalid input`.

Forme retenue : `"agents": ["./agents/agy-run.md", "./agents/notebook-creator.md"]`.

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

`deep-agy.js` inline les helpers de `deep-agy-lib.mjs` parce qu'un script Workflow ne peut pas importer de fichier local. `deep-agy-sync.test.mjs` compare les corps de fonction **octet à octet** : éditer un helper d'un seul côté fait rougir la suite. `renderReportMarkdown` n'est pas inliné et échappe à la contrainte.

## Dépôts et push

- Le dépôt a été créé avec un remote **SSH** alors que `gh` opère en **https** et que l'agent SSH n'a aucune clé chargée : `Permission denied (publickey)`. Remote basculé en https, comme `erom-marketplace`.
- `~/.claude` est un dépôt git **sans remote** : les commits y restent locaux, il n'y a rien à pousser.

## Périmètre de `~/.claude/scripts/agy/`

Ce dossier n'était pas un dossier deep research : `classify_source.py` et `recover_transcript.py` servent aussi `/transcribe`, `/video`, `/media`, `/doc-to-md`, qui restent dans `~/.claude`. Seule la partie deep a migré ; `recover_transcript.py` existe désormais en deux exemplaires assumés (ici et là-bas).
