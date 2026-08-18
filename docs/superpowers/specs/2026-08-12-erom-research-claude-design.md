# erom-research:deep-claude, moteur natif sous le pipeline deep-research

Date : 2026-08-12
Statut : design validé, prêt pour plan d'implémentation
Branche : `feat/engine-claude`

## Problème

Le plugin `erom-research` a trois moteurs (agy, grok, nlm), tous dépendants d'un
binaire externe et d'un quota tiers. Quand le quota Google est épuisé ou que le
CLI agy est cassé, il n'existe aucune voie de repli native.

Claude Code embarque depuis la version 2.1.x un workflow bundled `/deep-research`
(fan-out WebSearch, fetch, vérification adversariale 3 voix, synthèse). Un run
comparatif a été mené le 12/08/2026 sur le sujet du run agy du 08/08 (clonage de
voix française en local) pour évaluer s'il pouvait servir de quatrième moteur.

### Ce que le run comparatif a montré

Le bundled a produit un rapport crédible (23 sources, 102 claims extraites, 25
vérifiées, 18 confirmées, 106 agents, ~15 min, 3,7M tokens sous-agents) mais a
raté les deux meilleurs candidats du run agy : `Thomcles/Chatterbox-TTS-French`
(finetune monolingue français) et `CosyVoice2-0.5B-EU` (Hi! PARIS, EUSIPCO 2026).

Une vérification directe a tranché la cause : ces deux sources sortent en
**position 1** du moteur de recherche natif dès la première requête ciblée. Le
moteur n'est donc pas en cause, c'est le **plan de recherche** du bundled qui
était générique ("best local TTS models 2026" au lieu de "Chatterbox finetune
Emilia French").

Conclusion : le pipeline de `deep-agy` (matrice de preuves, plan gate, rounds
adaptatifs, convergence, couverture) est supérieur au bundled et vaut d'être
conservé. Le bundled n'apporte qu'une chose que le pipeline n'a pas, la
vérification à N voix indépendantes.

## Solution

Câbler un second moteur de collecte sous le pipeline existant, et lui greffer le
vote à 3 voix du bundled.

### Vocabulaire

- **pipeline** : la machinerie partagée (matrice, plan gate, rounds, analyse de
  convergence, vote, couverture, rendu). Une seule implémentation.
- **engine** : le backend de collecte, `'agy'` ou `'claude'`. Il ne pilote **que
  la phase d'angles**.

Analyse de convergence, vote et synthèse sont toujours des agents Claude natifs,
quel que soit l'engine. C'est déjà le cas aujourd'hui pour l'analyse et la
synthèse (elles n'ont pas d'`agentType` dans `deep-agy.js`).

Ce choix est structurant pour le mode agy : router les votes vers agy coûterait
3 appels agy par claim, sur un quota mesuré à 78% de perte les 29-30/07/2026. Les
voteurs n'ont aucun besoin du grounding Google, leur travail est de chercher une
contradiction et de juger l'adéquation entre une claim et sa citation.

## Architecture

```
plugin/
  scripts/
    deep-research.js         renommé de deep-agy.js, porte la table ENGINES
    deep-research-lib.mjs    renommé de deep-agy-lib.mjs, + aggregateVotes
    render-report.mjs        import mis à jour
    tests/
      deep-research-lib.test.mjs   renommé, + cas aggregateVotes
      deep-research-sync.test.mjs  renommé, 11 helpers, namespace des 2 moteurs
  agents/
    agy-run.md               inchangé
    claude-run.md            NOUVEAU
  skills/
    agy/SKILL.md             scriptPath mis à jour + engines:'agy'
    claude/SKILL.md          NOUVEAU
```

### Table ENGINES

En tête de `deep-research.js`, consultée uniquement par la phase d'angles :

```js
const ENGINES = {
  agy: {
    agentType: 'erom-research:agy-run',
    // aucun pin : agy-run.md declare deja model: haiku
    anglePrompt: (f, round, i) => `MODE: deep-angle\nROUND: ${round}\n...`,
  },
  claude: {
    agentType: 'erom-research:claude-run',
    model: 'sonnet', effort: 'medium',
    anglePrompt: (f, round, i) => `## Chercheur: ${f.label}\n...`,
  },
}
const ENGINE = ENGINES[engines] ?? ENGINES.agy
```

Le défaut sur `agy` garantit que la skill agy fonctionne même sans passer
`engines`. Le paramètre est déjà destructuré ligne 161 du fichier actuel et n'est
aujourd'hui jamais utilisé.

La chaîne littérale `agentType: 'erom-research:agy-run'` survit dans la table,
donc l'assertion existante du test de synchro reste verte sans modification.

### Pinning modèle et effort

`opts.model` et `opts.effort` sont acceptés par `agent()` dans un workflow. Le
bundled ne s'en sert nulle part, d'où son coût uniforme de 3,7M tokens.

| Phase | Nature de la tâche | Tier |
|---|---|---|
| Angles, engine `claude` | chercher, lire, extraire dans un schéma fermé | `model: 'sonnet'`, `effort: 'medium'` |
| Angles, engine `agy` | forwarder vers le CLI, le raisonnement est chez Gemini | aucun pin, `agy-run.md` déclare déjà `model: haiku` |
| Analyse de convergence | raisonner sur tout l'état accumulé | `model` omis (hérite de la session), `effort: 'high'` |
| Vote 3 voix | juger une claim isolée | `model: 'sonnet'`, `effort: 'medium'` |
| Synthèse | qualité finale du rapport | `model` omis (hérite de la session), `effort: 'high'` |

Omettre `model` sur les deux phases de raisonnement est délibéré : elles doivent
suivre le modèle que Romain a choisi pour la session, alors que les phases
mécaniques restent épinglées sur un tier bas quelle que soit la session.

Vérifié par probe le 12/08/2026 (workflow `probe-agent-opts`, 3 agents, 2,5 s) :
`model: 'sonnet'` et `model: 'claude-sonnet-5'` produisent tous deux un agent
`claude-sonnet-5`, et l'absence de pin fait hériter du modèle de session
(`claude-opus-5[1m]` au moment du probe). La forme courte `'sonnet'` est retenue.

Ne pas pinner l'engine `agy` est délibéré : `agy-run.md` porte `model: haiku` dans
son frontmatter, le passer à `sonnet` serait une régression de coût sur un
forwarder qui ne raisonne pas.

### Agent claude-run

Subagent exécutant (par opposition au forwarder `agy-run` qui shell-out vers le
binaire). Tools : `WebSearch`, `WebFetch`. C'est le lieu où loger la doctrine de
recherche, qui est ce qui fait la différence de qualité :

- formuler des requêtes spécifiques au sujet plutôt que des requêtes de panorama
- privilégier sources primaires (papiers, model cards, repos officiels, LICENSE)
  sur les agrégateurs de blog
- extraire des claims falsifiables avec citation verbatim
- rendre `status: 'failed'` proprement plutôt que d'inventer si le fetch échoue

Il rend le même `ANGLE_SCHEMA` que `agy-run`, ce qui garantit que `ingestRound`
fonctionne à l'identique pour les deux moteurs.

## Le vote à 3 voix

`rankClaimsForRedTeam` reste le sélecteur, inchangé et déjà testé : il retient les
claims centrales et mono-source. Ce qui change est en aval.

Trois voteurs indépendants par claim, chacun sur le `REDTEAM_SCHEMA` existant (qui
porte déjà `refuted` et `verdict`), avec un index de voteur dans le prompt pour
éviter des sorties identiques. Puis agrégation par une fonction pure nouvelle.

### aggregateVotes

```js
export function aggregateVotes(verdicts, { votesCast = 3, threshold = 2 } = {})
```

Entrée : le tableau de verdicts, dont certains peuvent être `null` (agent planté
ou run interrompu). Sortie : un verdict unique enrichi du décompte.

Un vote est dit **contre** s'il porte `kill` ou `downgrade`, les deux étant des
formes de réfutation d'intensité différente.

| Situation | Verdict rendu |
|---|---|
| moins de `threshold` votes valides | `unverified` |
| au moins `threshold` votes contre, dont au moins `threshold` `kill` | `kill` |
| au moins `threshold` votes contre | `downgrade`, avec la confiance la plus basse proposée |
| sinon | `hold` |

Compter les votes contre plutôt que chaque verdict séparément évite un angle mort :
avec 1 `kill`, 1 `downgrade` et 1 `hold`, aucun verdict n'atteint le seuil pris
isolément, alors que deux voteurs sur trois contestent la claim. La règle ci-dessus
la fait tomber en `downgrade`, pas en `hold`.

Le cas `unverified` est le vrai gain, volé au bundled. Aujourd'hui un red-teamer
qui plante renvoie `null` et la claim passe en silence comme si elle avait été
validée. Demain elle est marquée non vérifiable et la couverture le dit.

### Divergence assumée avec le bundled

Le bundled instruit ses voteurs de défaulter à `refuted=true` en cas d'incertitude.
Nous gardons `downgrade` comme défaut d'incertitude, pas `kill`.

Raison : le bundled n'a qu'une seule passe et aucune mesure de couverture, il doit
donc être agressif. Notre pipeline a des rounds adaptatifs et une matrice qui
signale explicitement les lignes non couvertes, donc tuer une claim vraie sur un
doute coûte plus qu'il ne rapporte.

### Impact sur applyRedTeam

`applyRedTeam` doit gérer le nouveau verdict `unverified` : la claim est conservée
mais marquée `redteam: { verdict: 'unverified', validVotes, erroredVotes }`. Ses
tests existants sont à étendre, pas à réécrire, le comportement `hold`/`downgrade`/
`kill` étant inchangé.

`computeCoverage` gagne un champ `unverifiedClaims` (nombre de claims dont la
vérification n'a pas pu se prononcer), rendu dans la section Couverture.

## Sortie

`renderReportMarkdown` prend `meta.sourceTool` au lieu de la chaîne
`erom-research:deep-gemini` codée en dur ligne 122, et le frontmatter porte l'engine :

```yaml
source_tool: erom-research:deep-claude
engine: claude
depth: H
rounds: 3
converged: true
```

La skill `claude` écrit dans `$(pwd)/docs/research/claude/<DATE>-<SLUG>.md` avec
`.deep/<DATE>-<SLUG>/` pour les artefacts, même convention que les trois moteurs
existants.

## Gestion d'erreur et budget

Le circuit-breaker quota reste **spécifique au mode agy**, il lit l'exit 3 du
forwarder. En mode claude il n'y a pas de mur externe : le budget est plafonné par
`MAX_ROUNDS` (2 en `L`, 4 en `H`) et `RT_TARGETS` (5 ou 10, désormais multiplié
par 3 voteurs).

Volumétrie attendue en mode claude :

| Depth | Angles | Analyses | Votes | Synthèse | Total |
|---|---|---|---|---|---|
| `L` | ~8 | 2 | 15 | 1 | ~26 agents |
| `H` | ~20 | 4 | 30 | 1 | ~55 agents |

À comparer aux 106 agents du bundled pour une seule passe sans matrice.

La clôture menée par la couverture, installée en 0.3.0, s'applique aux deux
moteurs sans modification : elle lit `result.coverage`, qui ne dépend pas de
l'engine.

## Plan gate

Actif par défaut sur `/erom-research:deep-claude` comme sur agy, avec `--yes` pour le
sauter. La cohérence entre les deux moteurs prime sur le fait qu'un run claude
soit moins cher.

## Tests

Baseline avant chantier, prise le 12/08/2026 : 18 tests bun (0 fail, 2 fichiers),
3 tests python, `agy 1.1.12` présent.

Ajouts :

1. `aggregateVotes` : cas nominaux (kill à 2/3, downgrade à 2/3, hold), cas
   dégradés (0, 1 et 2 votes `null`), choix de la confiance la plus basse.
2. `applyRedTeam` : conservation et marquage d'une claim `unverified`.
3. `computeCoverage` : comptage `unverifiedClaims`.
4. Test de synchro : 11 helpers au lieu de 10, et assertion élargie vérifiant que
   **tout** `agentType` du workflow est dans le namespace `erom-research:`, au lieu
   de la seule assertion sur `agy-run`.

## Vérification de non-régression

Ordre imposé, après implémentation :

1. Suite de tests verte (bun + python).
2. Run `/erom-research:deep-gemini` sur un sujet réel, depth `L`, pour vérifier que le
   moteur historique tourne encore de bout en bout et rend un rapport.
3. Run `/erom-research:deep-claude` sur le même sujet, pour comparer les deux moteurs à
   pipeline strictement identique.

Si le run agy échoue, distinguer les causes avant toute conclusion :
`agy_scratch.py` rend **3** avec une ligne `QUOTA <message>` sur épuisement de
quota, ce qui sépare nativement un échec quota d'une régression de code.

## Hors périmètre

Explicitement non retenus pour ce chantier :

- `engines: 'both'` répartissant les angles entre les deux moteurs. Séduisant pour
  la diversité de sources, mais aucun besoin établi.
- Un `--budget N` façon grok en mode claude. `MAX_ROUNDS` et `RT_TARGETS` suffisent.
- Tout autre portage du bundled que la règle de vote.
- La modification des skills `grok` et `nlm`.
