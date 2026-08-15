# Centralisation des sorties research - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les 4 moteurs du plugin erom-research écrivent leurs rapports dans le store central `~/.claude/erom-plugin-artefacts/researchs/` (plat, daté, frontmatter canonique avec `project:`) au lieu de `docs/research/<moteur>/` du projet courant.

**Architecture:** Le layout physique porte uniquement la date (tri chronologique au `ls`) ; tous les axes de requête (moteur, projet d'origine) vivent dans le frontmatter YAML, contrat de la future skill `list`. Les artefacts de travail vont dans `researchs/.runs/<nom>/`, gitignorés. Aucune commande git dans les skills (le LaunchAgent nightly `com.erom.backup-config` committe `~/.claude`).

**Tech Stack:** Markdown (SKILL.md, agents), JS/ESM + tests `bun:test` (lib de rendu), TypeScript sur Bun (CLI grok-deep).

**Spec:** `docs/superpowers/specs/2026-08-15-researchs-centralisation-design.md`

## Global Constraints

- Chemin central canonique, partout identique : `$HOME/.claude/erom-plugin-artefacts/researchs` (dans les scripts TS : `path.join(os.homedir(), ".claude", "erom-plugin-artefacts", "researchs")`).
- Frontmatter canonique, 5 champs obligatoires : `title`, `type: research`, `engine`, `project`, `created`. Ordre d'émission : `title`, `type`, `source_tool`, `engine`, `project`, puis champs par moteur, puis `created`, `sensitivity: internal`.
- Aucune commande git dans les skills ni dans grok-deep (spec, décision 5).
- Tests via `bun test` uniquement (jamais npm/npx ; un hook PreToolUse les bloque). Exécuter depuis `plugin/scripts/`.
- Jamais `rm` sur des fichiers utilisateur : utiliser `trash`.
- IMPORTANT, hook anti-cadratin : un hook PreToolUse bloque tout Write/Edit dont le texte COMPOSÉ contient un tiret cadratin (U+2014). Les SKILL.md agy et grok en contiennent déjà : ne JAMAIS réécrire ces fichiers en entier. Faire uniquement les Edits chirurgicaux prescrits ci-dessous, dont les old_string et new_string sont garantis sans cadratin. Ne pas « corriger » les cadratins existants hors périmètre.
- Messages de commit : convention du repo, français sans accents, types `feat(research):`, `docs:`, `chore:`.
- Le répertoire de travail du repo est `/Users/recarnot/dev/erom-agence-deep-research` ; le plugin vit sous `plugin/`.
- Ne PAS committer dans `~/.claude` (repo distinct, géré par le nightly). Seul fichier créé hors repo : `~/.claude/erom-plugin-artefacts/researchs/.gitignore` (Task 3), plus des fixtures jetables.

---

### Task 1: Champ `project` dans la lib de rendu

**Files:**
- Modify: `plugin/scripts/deep-research-lib.mjs:145-153` (fonction `renderReportMarkdown`)
- Test: `plugin/scripts/tests/deep-research-lib.test.mjs`

**Interfaces:**
- Consumes: rien (première task).
- Produces: `renderReportMarkdown(report, meta)` émet la ligne `project: <valeur>` dans le frontmatter quand `meta.project` est défini, entre `engine` et `depth` ; aucune ligne sinon. La Task 3 (skills agy/claude) s'appuie sur ce comportement via `meta.project`.

- [x] **Step 1: Write the failing test**

Ajouter à la fin de `plugin/scripts/tests/deep-research-lib.test.mjs` :

```js
test('renderReportMarkdown: project émis si fourni, absent sinon', () => {
  const report = { tldr: [], findings: [], coverage: {}, conclusion: { recommendation: 'R', overallConfidence: 'high' }, references: [] }
  const base = { title: 'T', depth: 'L', rounds: 1, converged: true, date: '2026-08-15' }
  const md = renderReportMarkdown(report, { ...base, project: 'mediacenter' })
  expect(md).toContain('project: mediacenter')
  expect(md.indexOf('project: mediacenter')).toBeLessThan(md.indexOf('depth: L'))
  expect(renderReportMarkdown(report, base)).not.toContain('project:')
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd plugin/scripts && bun test tests/deep-research-lib.test.mjs`
Expected: FAIL, le nouveau test échoue sur `toContain('project: mediacenter')` (les tests existants restent verts).

- [x] **Step 3: Write minimal implementation**

Dans `plugin/scripts/deep-research-lib.mjs`, fonction `renderReportMarkdown`, Edit avec :

old_string :

```js
    ...(meta.engine ? [`engine: ${meta.engine}`] : []),
    `depth: ${meta.depth}`, `rounds: ${meta.rounds}`, `converged: ${meta.converged}`,
```

new_string :

```js
    ...(meta.engine ? [`engine: ${meta.engine}`] : []),
    ...(meta.project ? [`project: ${meta.project}`] : []),
    `depth: ${meta.depth}`, `rounds: ${meta.rounds}`, `converged: ${meta.converged}`,
```

- [x] **Step 4: Run the full suite to verify it passes**

Run: `cd plugin/scripts && bun test`
Expected: PASS, y compris `deep-research-sync.test.mjs` (`renderReportMarkdown` n'est PAS inliné dans `deep-research.js`, le commentaire du sync test le confirme : aucune modification de `deep-research.js` n'est nécessaire).

- [x] **Step 5: Commit**

```bash
git add plugin/scripts/deep-research-lib.mjs plugin/scripts/tests/deep-research-lib.test.mjs
git commit -m "feat(research): champ project dans le frontmatter du rendu"
```

---

### Task 2: Normalisation de grok-deep (frontmatter, out-dir central, --project)

**Files:**
- Modify: `plugin/scripts/grok-deep`
- Create: `plugin/scripts/tests/grok-deep.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `grok-deep` exporte `buildFrontmatter(query: string, project: string, createdIso: string): string`, `slugify(s: string): string` et `uniqueRunId(outDir: string, slug: string): string` ; défaut `--out-dir` = `~/.claude/erom-plugin-artefacts/researchs` ; nouveau flag `--project <nom>` (défaut `path.basename(process.cwd())`) ; le rapport final commence par le frontmatter canonique ; `uniqueRunId` évite aussi les collisions avec un `<id>.md` existant (rapport d'un autre moteur). La Task 4 (SKILL.md grok) s'appuie sur `--out-dir`, `--project` et sur les events JSON existants (`status_path`, `report_path`, chemins absolus), qui ne changent pas.

- [x] **Step 1: Rendre le CLI importable (garde d'exécution)**

Dans `plugin/scripts/grok-deep`, le dispatch main est en bas de fichier (lignes 351-368), au niveau module. L'envelopper dans une garde. Edit avec :

old_string :

```ts
const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "--help" || cmd === "-h") usage(cmd ? 0 : 2);
const { positional, opts } = parseArgs(rest);

if (cmd === "run") {
  if (!positional.length) { console.error("run : sujet manquant"); usage(2); }
  await cmdRun(positional.join(" "), opts);
} else if (cmd === "start") {
  if (!positional.length) { console.error("start : sujet manquant"); usage(2); }
  cmdStart(positional.join(" "), opts, process.argv.slice(2));
} else if (cmd === "status") {
  cmdStatus(positional[0], opts);
} else if (cmd === "list") {
  cmdList(opts);
} else {
  console.error(`Commande inconnue : ${cmd}`);
  usage(2);
}
```

new_string :

```ts
if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "--help" || cmd === "-h") usage(cmd ? 0 : 2);
  const { positional, opts } = parseArgs(rest);

  if (cmd === "run") {
    if (!positional.length) { console.error("run : sujet manquant"); usage(2); }
    await cmdRun(positional.join(" "), opts);
  } else if (cmd === "start") {
    if (!positional.length) { console.error("start : sujet manquant"); usage(2); }
    cmdStart(positional.join(" "), opts, process.argv.slice(2));
  } else if (cmd === "status") {
    cmdStatus(positional[0], opts);
  } else if (cmd === "list") {
    cmdList(opts);
  } else {
    console.error(`Commande inconnue : ${cmd}`);
    usage(2);
  }
}
```

Vérifié le 2026-08-15 en Bun 1.3.5 : un fichier sans extension avec shebang s'importe depuis un test (`import { x } from "../grok-deep"`), `import.meta.main` est `false` à l'import et `true` en exécution directe, et le top-level `await` dans le bloc `if` est valide.

- [x] **Step 2: Write the failing tests**

Créer `plugin/scripts/tests/grok-deep.test.ts` :

```ts
import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildFrontmatter, slugify, uniqueRunId } from "../grok-deep";

test("buildFrontmatter: canonique, title JSON-quoté, se termine par --- et ligne vide", () => {
  const fm = buildFrontmatter('Sujet avec "quotes"', "mediacenter", "2026-08-15");
  const lines = fm.split("\n");
  expect(lines[0]).toBe("---");
  expect(lines[1]).toBe('title: "Sujet avec \\"quotes\\""');
  expect(fm).toContain("type: research");
  expect(fm).toContain("source_tool: erom-research:grok");
  expect(fm).toContain("engine: grok");
  expect(fm).toContain("project: mediacenter");
  expect(fm).toContain("created: 2026-08-15");
  expect(fm).toContain("sensitivity: internal");
  expect(fm.endsWith("---\n")).toBe(true);
});

test("slugify: inchangé (lowercase, accents, tirets)", () => {
  expect(slugify("Été 2026 : Bilan !")).toBe("ete-2026-bilan");
});

test("uniqueRunId: collision sur .runs/ ET sur un .md existant d'un autre moteur", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-deep-test-"));
  const date = new Date().toISOString().slice(0, 10);
  expect(uniqueRunId(dir, "sujet")).toBe(`${date}-sujet`);
  fs.writeFileSync(path.join(dir, `${date}-sujet.md`), "rapport agy");
  expect(uniqueRunId(dir, "sujet")).toBe(`${date}-sujet-2`);
  fs.mkdirSync(path.join(dir, ".runs", `${date}-sujet-2`), { recursive: true });
  expect(uniqueRunId(dir, "sujet")).toBe(`${date}-sujet-3`);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

(Le `fs.rmSync` sur un mkdtemp du tmpdir système est le nettoyage standard d'un test, pas une suppression de fichier utilisateur.)

- [x] **Step 3: Run tests to verify they fail**

Run: `cd plugin/scripts && bun test tests/grok-deep.test.ts`
Expected: FAIL, `buildFrontmatter` n'existe pas ; `slugify`/`uniqueRunId` ne sont pas exportés.

- [x] **Step 4: Implémenter les exports et buildFrontmatter**

Dans `plugin/scripts/grok-deep` :

a) Edit : old_string `function slugify(s: string): string {` , new_string `export function slugify(s: string): string {`.

b) Remplacer `uniqueRunId` en entier. Edit avec :

old_string :

```ts
function uniqueRunId(outDir: string, slug: string): string {
  const date = nowIso().slice(0, 10);
  let id = `${date}-${slug}`;
  let n = 2;
  while (fs.existsSync(path.join(outDir, ".runs", id))) { id = `${date}-${slug}-${n}`; n++; }
  return id;
}
```

new_string :

```ts
export function uniqueRunId(outDir: string, slug: string): string {
  const date = nowIso().slice(0, 10);
  let id = `${date}-${slug}`;
  let n = 2;
  while (fs.existsSync(path.join(outDir, ".runs", id)) || fs.existsSync(path.join(outDir, `${id}.md`))) {
    id = `${date}-${slug}-${n}`; n++;
  }
  return id;
}

export function buildFrontmatter(query: string, project: string, createdIso: string): string {
  return [
    "---",
    `title: ${JSON.stringify(query)}`,
    "type: research",
    "source_tool: erom-research:grok",
    "engine: grok",
    `project: ${project}`,
    `created: ${createdIso}`,
    "sensitivity: internal",
    "---",
    "",
  ].join("\n");
}
```

- [x] **Step 5: Défaut out-dir central, flag --project, usage()**

Toujours dans `plugin/scripts/grok-deep` :

a) Type `Opts`. Edit : old_string `  timeoutSec: number; runId?: string; latest?: boolean;` , new_string `  timeoutSec: number; runId?: string; latest?: boolean; project?: string;`.

b) `parseArgs`. Edit : old_string `    else if (a === "--run-id") opts.runId = next();` , new_string :

```ts
    else if (a === "--run-id") opts.runId = next();
    else if (a === "--project") opts.project = next();
```

c) Défaut out-dir. Edit : old_string `  if (!opts.outDir) opts.outDir = path.join(process.cwd(), "docs", "research", "grok");` , new_string `  if (!opts.outDir) opts.outDir = path.join(os.homedir(), ".claude", "erom-plugin-artefacts", "researchs");`.

d) `usage()`. Edit : old_string :

```ts
  Défauts : out-dir=$PWD/docs/research/grok, budget=${DEFAULT_BUDGET}, timeout=${DEFAULT_TIMEOUT_SEC}s`);
```

new_string :

```ts
  Défauts : out-dir=~/.claude/erom-plugin-artefacts/researchs, budget=${DEFAULT_BUDGET}, timeout=${DEFAULT_TIMEOUT_SEC}s
  --project <nom> : projet d'origine inscrit au frontmatter (défaut : basename du cwd)`);
```

- [x] **Step 6: Frontmatter au rapatriement du rapport**

Dans `cmdRun`, Edit avec :

old_string :

```ts
  const reportSrc = path.join(execDir, "report.md");
  let reportOk = false;
  if (fs.existsSync(reportSrc) && fs.statSync(reportSrc).size > 0) {
    fs.copyFileSync(reportSrc, reportFinal);
    st.report_path = reportFinal;
    reportOk = true;
    const head = fs.readFileSync(reportFinal, "utf8").slice(0, 500);
    const m = head.match(/\*\*Status:\s*(Verified|Partial)\*\*/i);
    if (m) st.grok_status = m[1].toLowerCase() as "verified" | "partial";
  }
```

new_string :

```ts
  const reportSrc = path.join(execDir, "report.md");
  let reportOk = false;
  if (fs.existsSync(reportSrc) && fs.statSync(reportSrc).size > 0) {
    const raw = fs.readFileSync(reportSrc, "utf8");
    const m = raw.slice(0, 500).match(/\*\*Status:\s*(Verified|Partial)\*\*/i);
    if (m) st.grok_status = m[1].toLowerCase() as "verified" | "partial";
    const project = opts.project ?? path.basename(process.cwd());
    fs.writeFileSync(reportFinal, buildFrontmatter(query, project, startedAt.slice(0, 10)) + "\n" + raw);
    st.report_path = reportFinal;
    reportOk = true;
  }
```

(Le match du statut se fait sur `raw` AVANT préfixage : le frontmatter ne doit pas pousser la ligne `**Status:**` hors de la fenêtre des 500 premiers caractères. Note : `cmdStart` re-forwarde tel quel ses arguments vers `run`, donc `--project` suit, et sans flag le run détaché hérite du cwd, donc du même basename.)

- [x] **Step 7: Run tests to verify they pass**

Run: `cd plugin/scripts && bun test`
Expected: PASS (les 3 nouveaux tests + toute la suite existante).

- [x] **Step 8: Vérifier que le CLI reste exécutable**

Run: `plugin/scripts/grok-deep --help; plugin/scripts/grok-deep list --out-dir "/tmp/grok-deep-empty-$$"; echo "exit=$?"`
Expected: l'usage s'affiche avec les nouveaux défauts et le flag `--project`, puis `Aucun run sous /tmp/grok-deep-empty-<pid>/.runs` et `exit=0`.

- [x] **Step 9: Commit**

```bash
git add plugin/scripts/grok-deep plugin/scripts/tests/grok-deep.test.ts
git commit -m "feat(research): grok-deep normalise, frontmatter canonique et out-dir central"
```

---

### Task 3: Socle central + skills agy et claude

**Files:**
- Create: `~/.claude/erom-plugin-artefacts/researchs/.gitignore` (hors repo, non committé ici : le nightly de `~/.claude` s'en charge)
- Modify: `plugin/skills/agy/SKILL.md` (description ligne 3, texte ligne 30, préflight lignes 32-38, meta ligne 90)
- Modify: `plugin/skills/claude/SKILL.md` (description ligne 3, texte ligne 30, préflight lignes 33-38, meta ligne 68)

**Interfaces:**
- Consumes: `renderReportMarkdown` avec `meta.project` (Task 1).
- Produces: les préflights impriment `WRITE_FILE`, `DEEP_DIR`, `PROJECT` (chemins absolus, anti-collision faite) ; les métas passent `project`. Aucune autre task ne consomme ces fichiers.

RAPPEL du Global Constraint anti-cadratin : ces deux SKILL.md contiennent des tirets cadratins ailleurs. Ne faire QUE les Edits ci-dessous (old/new sans cadratin), jamais de réécriture complète du fichier.

- [x] **Step 1: Créer le .gitignore du store central**

Écrire `~/.claude/erom-plugin-artefacts/researchs/.gitignore` avec ce contenu exact :

```
.runs/
```

- [x] **Step 2: Préflight agy**

Dans `plugin/skills/agy/SKILL.md`, Edit avec :

old_string :

```bash
mkdir -p "docs/research/agy/.deep/<DATE>-<SLUG>"
echo "WRITE_FILE=$(pwd)/docs/research/agy/<DATE>-<SLUG>.md"
echo "DEEP_DIR=$(pwd)/docs/research/agy/.deep/<DATE>-<SLUG>"
```

new_string :

```bash
RESEARCH_DIR="$HOME/.claude/erom-plugin-artefacts/researchs"
BASE="<DATE>-<SLUG>"; N=2
while test -e "$RESEARCH_DIR/$BASE.md"; do BASE="<DATE>-<SLUG>-$N"; N=$((N+1)); done
mkdir -p "$RESEARCH_DIR/.runs/$BASE"
echo "WRITE_FILE=$RESEARCH_DIR/$BASE.md"
echo "DEEP_DIR=$RESEARCH_DIR/.runs/$BASE"
echo "PROJECT=$(basename "$(pwd)")"
```

(Les deux lignes suivantes du bloc, `test -f ...` et `command -v agy ...`, restent inchangées. Boucle anti-collision vérifiée le 2026-08-15 : `sujet`, puis `sujet-2`, puis `sujet-3` sur fichiers préexistants.)

- [x] **Step 3: Texte des chemins, meta et description agy**

Trois Edits chirurgicaux dans `plugin/skills/agy/SKILL.md` (chaque old_string apparaît exactement une fois ; les backticks des blocs ci-dessous sont littéraux, à reprendre tels quels) :

a) old_string :

```
Le préflight imprime `WRITE_FILE` et `DEEP_DIR`
```

new_string :

```
Le préflight imprime `WRITE_FILE`, `DEEP_DIR` et `PROJECT` (chemins absolus, `$HOME` expansé)
```

(Le reste de la phrase, qui commence par un tiret cadratin existant, reste en place tel quel.)

b) old_string :

```
sourceTool:'erom-research:agy', engine:'agy' }
```

new_string :

```
sourceTool:'erom-research:agy', engine:'agy', project:'<PROJECT>' }
```

c) old_string :

```
Sauve dans docs/research/agy/."
```

new_string :

```
Sauve dans ~/.claude/erom-plugin-artefacts/researchs/."
```

- [x] **Step 4: Mêmes changements pour claude**

Quatre Edits dans `plugin/skills/claude/SKILL.md` :

a) Préflight. old_string :

```bash
mkdir -p "docs/research/claude/.deep/<DATE>-<SLUG>"
echo "WRITE_FILE=$(pwd)/docs/research/claude/<DATE>-<SLUG>.md"
echo "DEEP_DIR=$(pwd)/docs/research/claude/.deep/<DATE>-<SLUG>"
```

new_string :

```bash
RESEARCH_DIR="$HOME/.claude/erom-plugin-artefacts/researchs"
BASE="<DATE>-<SLUG>"; N=2
while test -e "$RESEARCH_DIR/$BASE.md"; do BASE="<DATE>-<SLUG>-$N"; N=$((N+1)); done
mkdir -p "$RESEARCH_DIR/.runs/$BASE"
echo "WRITE_FILE=$RESEARCH_DIR/$BASE.md"
echo "DEEP_DIR=$RESEARCH_DIR/.runs/$BASE"
echo "PROJECT=$(basename "$(pwd)")"
```

(La ligne `test -f ...` du bloc reste inchangée. La note de la ligne 31 sur `DEEP_DIR` et `_render.json` reste vraie : ne pas y toucher.)

b) old_string :

```
Le préflight imprime `WRITE_FILE` et `DEEP_DIR`, réutilise
```

new_string :

```
Le préflight imprime `WRITE_FILE`, `DEEP_DIR` et `PROJECT` (chemins absolus, `$HOME` expansé), réutilise
```

c) old_string :

```
sourceTool:'erom-research:claude', engine:'claude' }
```

new_string :

```
sourceTool:'erom-research:claude', engine:'claude', project:'<PROJECT>' }
```

d) old_string :

```
Sauve dans docs/research/claude/."
```

new_string :

```
Sauve dans ~/.claude/erom-plugin-artefacts/researchs/."
```

- [x] **Step 5: Vérification bout-en-bout sans réseau ni quota**

Exécuter le préflight réel puis un rendu sur fixture (remplacer 2026-08-15 par la date du jour) :

```bash
RESEARCH_DIR="$HOME/.claude/erom-plugin-artefacts/researchs"
BASE="2026-08-15-fixture-verification"; N=2
while test -e "$RESEARCH_DIR/$BASE.md"; do BASE="2026-08-15-fixture-verification-$N"; N=$((N+1)); done
mkdir -p "$RESEARCH_DIR/.runs/$BASE"
printf '%s\n' '{"report":{"tldr":["ok"],"findings":[],"coverage":{"anglesCompleted":1,"anglesFailed":0},"conclusion":{"recommendation":"R","overallConfidence":"high"},"references":[]},"meta":{"title":"Fixture","depth":"L","rounds":1,"converged":true,"date":"2026-08-15","sourceTool":"erom-research:claude","engine":"claude","project":"erom-agence-deep-research"}}' > "$RESEARCH_DIR/.runs/$BASE/_render.json"
node plugin/scripts/render-report.mjs "$RESEARCH_DIR/.runs/$BASE/_render.json" > "$RESEARCH_DIR/$BASE.md"
head -12 "$RESEARCH_DIR/$BASE.md"
git -C ~/.claude status --porcelain -- erom-plugin-artefacts/researchs/
```

Expected: le head montre le frontmatter avec `title`, `type`, `source_tool`, `engine`, `project: erom-agence-deep-research`, `depth`, `rounds`, `converged`, `created`, `sensitivity` ; le git status montre le `.gitignore` et le `.md` de fixture mais AUCUN chemin sous `.runs/` (gitignore actif). Nettoyage : `trash "$RESEARCH_DIR/$BASE.md" "$RESEARCH_DIR/.runs/$BASE"`.

- [x] **Step 6: Commit**

```bash
git add plugin/skills/agy/SKILL.md plugin/skills/claude/SKILL.md
git commit -m "feat(research): skills agy et claude ecrivent au store central avec project"
```

---

### Task 4: Skill grok

**Files:**
- Modify: `plugin/skills/grok/SKILL.md`

**Interfaces:**
- Consumes: `grok-deep` avec `--out-dir`, `--project` et events JSON `status_path`/`report_path` (Task 2).
- Produces: rien pour les tasks suivantes.

RAPPEL anti-cadratin : ce fichier contient des tirets cadratins. Edits chirurgicaux uniquement, jamais de réécriture complète.

- [x] **Step 1: Commandes vers le store central**

Trois Edits dans `plugin/skills/grok/SKILL.md` :

a) old_string : `"<CLI>" run "<sujet>" --out-dir "$(pwd)/docs/research/grok" [--budget N]`
   new_string : `"<CLI>" run "<sujet>" --out-dir "$HOME/.claude/erom-plugin-artefacts/researchs" --project "$(basename "$(pwd)")" [--budget N]`

b) old_string : `"<CLI>" status --latest --out-dir "$(pwd)/docs/research/grok"`
   new_string : `"<CLI>" status --latest --out-dir "$HOME/.claude/erom-plugin-artefacts/researchs"`

c) old_string : `"<CLI>" list --out-dir "$(pwd)/docs/research/grok"`
   new_string : `"<CLI>" list --out-dir "$HOME/.claude/erom-plugin-artefacts/researchs"`

- [x] **Step 2: Lecture des résultats par les chemins de l'enveloppe JSON**

Deux Edits par fragments (les segments à cadratin de ces lignes restent en place ; backticks littéraux) :

a) old_string :

```
lis `status.json` (tool Read, chemin `docs/research/grok/.runs/<run_id>/status.json`
```

new_string :

```
lis `status.json` (tool Read, au chemin ABSOLU `status_path` imprimé dans l'enveloppe JSON du task output, ne le reconstruis pas
```

b) old_string :

```
Read du rapport `docs/research/grok/<run_id>.md`
```

new_string :

```
Read du rapport au chemin `report_path` du status.json (absolu, sous ~/.claude/erom-plugin-artefacts/researchs/)
```

- [x] **Step 3: Description**

Edit : old_string : `rapport avec coverage explicite sauvé dans docs/research/grok/.`
new_string : `rapport avec coverage explicite sauvé dans ~/.claude/erom-plugin-artefacts/researchs/.`

- [x] **Step 4: Vérification list sur le store réel**

Run: `plugin/scripts/grok-deep list --out-dir "$HOME/.claude/erom-plugin-artefacts/researchs"; echo "exit=$?"`
Expected: `Aucun run sous /Users/recarnot/.claude/erom-plugin-artefacts/researchs/.runs` (ou la liste des runs si des fixtures traînent) et `exit=0` : la commande de la skill est valide contre le store central sans lancer de run (zéro quota).

- [x] **Step 5: Commit**

```bash
git add plugin/skills/grok/SKILL.md
git commit -m "feat(research): skill grok pointe le store central, chemins via enveloppe JSON"
```

---

### Task 5: Skill nlm + agent notebook-creator

**Files:**
- Modify: `plugin/skills/nlm/SKILL.md`
- Modify: `plugin/agents/notebook-creator.md`

**Interfaces:**
- Consumes: rien (le rapport nlm est écrit par l'agent, pas par la lib).
- Produces: la mission du subagent fournit `PROJECT` ; le frontmatter du rapport nlm porte les 5 champs obligatoires.

RAPPEL anti-cadratin : ces fichiers contiennent des tirets cadratins. Edits chirurgicaux uniquement.

- [x] **Step 1: Préflight nlm**

Dans `plugin/skills/nlm/SKILL.md`, Edit avec :

old_string :

```bash
   nlm notebook list --json 2>&1 | head -3
   mkdir -p "docs/research/nlm"
   echo "OUT=$(pwd)/docs/research/nlm/<DATE>-<SLUG>.md"
```

new_string :

```bash
   nlm notebook list --json 2>&1 | head -3
   RESEARCH_DIR="$HOME/.claude/erom-plugin-artefacts/researchs"
   BASE="<DATE>-<SLUG>"; N=2
   while test -e "$RESEARCH_DIR/$BASE.md"; do BASE="<DATE>-<SLUG>-$N"; N=$((N+1)); done
   mkdir -p "$RESEARCH_DIR"
   echo "OUT=$RESEARCH_DIR/$BASE.md"
   echo "PROJECT=$(basename "$(pwd)")"
```

- [x] **Step 2: Mission du subagent**

Edit (backticks littéraux) : old_string :

```
La mission fournit : `<sujet>` et `REPORT_PATH=<OUT>` (littéral, absolu).
```

new_string :

```
La mission fournit : `<sujet>`, `REPORT_PATH=<OUT>` (littéral, absolu) et `PROJECT=<PROJECT>`.
```

- [x] **Step 3: Mode list + description**

a) Edit : old_string : `ls docs/research/nlm/ 2>/dev/null`
   new_string : `grep -l "engine: notebooklm" "$HOME"/.claude/erom-plugin-artefacts/researchs/*.md 2>/dev/null`

b) Edit : old_string : `Sauve dans docs/research/nlm/."`
   new_string : `Sauve dans ~/.claude/erom-plugin-artefacts/researchs/."`

- [x] **Step 4: Frontmatter canonique de notebook-creator**

Dans `plugin/agents/notebook-creator.md`, section « 4. Rapport final », Edit avec :

old_string :

```markdown
---
engine: notebooklm
notebook_id: <notebook_id>
url: <url du JSON notebook get>
query: "<DEEP_SEARCH_QUERY>"
date: <YYYY-MM-DD via date +%F>
source_count: <n>
---
```

new_string :

```markdown
---
title: "{TITLE}"
type: research
source_tool: erom-research:nlm
engine: notebooklm
project: {PROJECT}
notebook_id: <notebook_id>
url: <url du JSON notebook get>
query: "<DEEP_SEARCH_QUERY>"
source_count: <n>
created: <YYYY-MM-DD via date +%F>
sensitivity: internal
---
```

Puis un second Edit pour documenter `{PROJECT}`, juste après le bloc template (backticks littéraux). old_string :

```
Sans REPORT_PATH dans la mission : saute cette étape, le fichier mémoire de l'étape 5 fait foi.
```

new_string :

```
`{PROJECT}` vient de la mission (`PROJECT=...`) ; si la mission ne le fournit pas, écris `project: unknown`. Sans REPORT_PATH dans la mission : saute cette étape, le fichier mémoire de l'étape 5 fait foi.
```

- [x] **Step 5: Balayage de cohérence**

Run: `grep -n "docs/research" plugin/skills/nlm/SKILL.md plugin/agents/notebook-creator.md; echo "exit=$?"`
Expected: aucune occurrence, `exit=1`. La mention « notebook_id + URL (frontmatter) » au point 5 de la skill reste vraie avec le nouveau template : aucune modification.

- [x] **Step 6: Commit**

```bash
git add plugin/skills/nlm/SKILL.md plugin/agents/notebook-creator.md
git commit -m "feat(research): skill nlm au store central, frontmatter canonique notebook-creator"
```

---

### Task 6: Documentation et version

**Files:**
- Modify: `plugin/README.md:50-56`
- Modify: `plugin/.claude-plugin/plugin.json` (version, description)
- Modify: `_memory_/architecture.md:29` et sa date de mise à jour

**Interfaces:**
- Consumes: l'état final des Tasks 1-5.
- Produces: rien (task terminale).

- [x] **Step 1: README, bloc layout**

Lire `plugin/README.md` lignes 45-60 pour voir le bloc exact, puis remplacer la phrase d'intro et les 4 lignes de layout :

old (contenu actuel, lignes 50-56, à ajuster au fence réel constaté) :

```
Tous les rapports atterrissent sous `docs/research/<moteur>/` du projet courant :
```

et les lignes de layout qui suivent, par :

```
Tous les rapports atterrissent dans le store central `~/.claude/erom-plugin-artefacts/researchs/` (plat, un fichier par recherche, projet d'origine en frontmatter `project:`) :
```

avec le nouveau bloc de layout :

```
~/.claude/erom-plugin-artefacts/researchs/<date>-<slug>.md      rapport (frontmatter : title, type, source_tool, engine, project, created, sensitivity + champs moteur)
~/.claude/erom-plugin-artefacts/researchs/.runs/<date>-<slug>/  artefacts de travail, non versionnés (ex-.deep agy/claude ; status.json, worker.log grok)
```

(Conserver le style de fence et l'indentation du bloc existant. Si les lignes actuelles portent des commentaires par moteur, les remplacer par ces deux lignes : le layout n'est plus par moteur.)

- [x] **Step 2: plugin.json**

a) Edit : old_string : `"version": "0.4.0",` , new_string : `"version": "0.5.0",`.
b) Edit : old_string : `Rapports cités sauvés dans docs/research/<moteur>/.` , new_string : `Rapports cités centralisés dans ~/.claude/erom-plugin-artefacts/researchs/ (frontmatter avec projet d'origine).`.

- [x] **Step 3: Mémoire projet**

Dans `_memory_/architecture.md` :

a) Edit : old_string :

```
**Sorties** : `docs/research/{agy,claude,grok,nlm}/` du projet courant, jamais dans le plugin.
```

new_string :

```
**Sorties** (0.5.0) : store central `~/.claude/erom-plugin-artefacts/researchs/` (plat, `<date>-<slug>.md`, frontmatter canonique title/type/engine/project/created ; artefacts sous `.runs/`, gitignorés ; versionnement par le nightly de `~/.claude`, aucune commande git dans les skills). Plus rien dans le projet courant.
```

b) Edit : old_string : `_Mis à jour : 2026-08-12_` , new_string : `_Mis à jour : 2026-08-15_` (adapter à la date du jour d'exécution).

- [x] **Step 4: Balayage final**

Run: `grep -rn "docs/research" plugin/`
Expected: AUCUNE occurrence dans `plugin/` (skills, agents, scripts, README, manifeste). Les occurrences restantes dans `docs/superpowers/` (spec, plans) et `_memory_/gotchas.md` ou `patterns.md` sont historiques et hors périmètre ; si `gotchas.md`/`patterns.md`/`key-files.md` mentionnent un chemin de sortie devenu faux, mettre à jour la ligne concernée dans le même esprit que architecture.md.

Run: `cd plugin/scripts && bun test`
Expected: PASS, suite complète.

- [x] **Step 5: Commit**

```bash
git add plugin/README.md plugin/.claude-plugin/plugin.json _memory_/
git commit -m "docs(research): store central documente, bump 0.5.0"
```

---

## Vérification finale (hors plan, à rappeler à Romain)

Les skills actives sur la machine viennent du cache marketplace : les changements ne prennent effet qu'après le rituel `plugin-release` (bump déjà fait en Task 6). Après release, un premier run réel de chaque moteur validera les critères de succès de la spec sur le terrain ; le premier commit nightly de `~/.claude` confirmera que seuls `.gitignore` et les rapports sont versionnés.
