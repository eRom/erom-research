// Banc e2e du mode auto de deep-notebook : lance une vraie session `claude -p`
// et contrôle le contrat de sortie, les outils interdits et les écritures mémoire.
// Usage : bun docs/evals/mode-auto/run-auto.ts <caseId> [--allow-auth-ko]
// Sortie : un objet JSON sur stdout (aussi écrit dans out/<caseId>.json),
// flux brut dans out/<caseId>.stream.jsonl. Code de sortie 0 si pass, 1 sinon.
import { existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { checkReport } from "../../../plugin/scripts/check-report.mjs";

const REPO_ROOT = "/Users/recarnot/dev/erom-agence-deep-research";
const PLUGIN_DIR = `${REPO_ROOT}/plugin`;
const WORKER_CWD = "/Users/Shared/erom-agence-backlog-worker";
const CLAUDE_BIN = "/Users/recarnot/.local/bin/claude";
const OUT_DIR = path.join(REPO_ROOT, "docs/evals/mode-auto/out");
const FORBIDDEN_TOOLS = ["SendUserFile", "AskUserQuestion", "SendMessage"];

interface Expect {
  // Mode "stop-after-relay" : le cas se juge sur le flux, la session est arrêtée au message de relais.
  lastLineEquals?: string;
  lastLineStartsWith?: string;
  lastLineMatches?: string;
  lastLineMatchesNone?: string[];
  reportMustExist?: boolean;
  notebookIdRequired?: boolean;
  minDurationMs?: number;
  maxDurationMs?: number;
}
interface CaseDef {
  mode?: "stop-after-relay";
  prompt: string;
  timeoutMs: number;
  requiresFlag?: string;
  expect: Expect;
}
interface MemoryWrite {
  path: string;
  kind: "new" | "modified";
  attributedTo: "run" | "other-session?";
}
type Snapshot = Map<string, { mtimeMs: number; size: number }>;

const home = homedir();

// Racines dont une écriture est imputée au run (le plugin ne doit rien écrire ici).
const RUN_ROOTS = [
  `${home}/.claude/agent-memory/`,
  `${home}/.claude/projects/-Users-Shared-erom-agence-backlog-worker/memory/`,
  `${REPO_ROOT}/_memory_/`,
  `${home}/.claude/erom-playbook.md`,
];

function listProjectMemoryDirs(): string[] {
  const projects = `${home}/.claude/projects`;
  if (!existsSync(projects)) return [];
  return readdirSync(projects).map((name) => `${projects}/${name}/memory`);
}

function walk(root: string, into: Snapshot): void {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return; // racine absente : ignorée
  }
  if (stat.isFile()) {
    into.set(root, { mtimeMs: stat.mtimeMs, size: stat.size });
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(root)) walk(path.join(root, entry), into);
}

function takeSnapshot(): Snapshot {
  const snapshot: Snapshot = new Map();
  for (const root of [...RUN_ROOTS, ...listProjectMemoryDirs()]) walk(root, snapshot);
  return snapshot;
}

function diffSnapshots(before: Snapshot, after: Snapshot): MemoryWrite[] {
  const writes: MemoryWrite[] = [];
  for (const [file, now] of after) {
    const prev = before.get(file);
    let kind: MemoryWrite["kind"] | null = null;
    if (!prev) kind = "new";
    else if (prev.mtimeMs !== now.mtimeMs || prev.size !== now.size) kind = "modified";
    if (!kind) continue;
    const attributedTo = RUN_ROOTS.some((root) => file === root || file.startsWith(root))
      ? "run"
      : "other-session?";
    writes.push({ path: file, kind, attributedTo });
  }
  return writes;
}

// Parcourt le flux stream-json : outils interdits, dernier `result`, base dir du skill.
function analyzeStream(raw: string) {
  const forbidden: string[] = [];
  let resultText: string | null = null;
  let isError = false;
  let initPluginPath: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    // L'événement init liste les plugins chargés : source de repli pour la base du skill.
    if (event.type === "system" && event.subtype === "init" && Array.isArray(event.plugins)) {
      const plugin = event.plugins.find((p: any) => p?.name === "erom-research");
      if (plugin?.path) initPluginPath = plugin.path;
    }
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type === "tool_use" && FORBIDDEN_TOOLS.includes(block.name)) {
          forbidden.push(block.name);
        }
      }
    }
    if (event.type === "result") {
      resultText = typeof event.result === "string" ? event.result : "";
      isError = Boolean(event.is_error);
    }
  }
  const baseDirMatch = raw.match(/Base directory for this skill: ([^\s"\\]+)/);
  const lastLine =
    (resultText ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .pop() ?? "";
  return {
    forbidden,
    lastLine,
    hasResult: resultText !== null,
    isError,
    // Le texte « Base directory for this skill » n'apparaît que si le skill passe par l'outil Skill ;
    // une commande slash est développée hors flux. Repli : chemin du plugin dans l'événement init.
    skillBaseDir: baseDirMatch
      ? baseDirMatch[1]
      : initPluginPath
        ? `${initPluginPath}/skills/deep-notebook`
        : null,
  };
}

// Cherche dans le flux le spawn de notebook-creator puis le message de relais du fil principal.
function findRelay(raw: string) {
  let spawned = false;
  let autoModeInPrompt = false;
  let relayText: string | null = null;
  const mainThreadTexts: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "assistant" || !Array.isArray(event.message?.content)) continue;
    const isMainThread = !event.parent_tool_use_id;
    for (const block of event.message.content) {
      if (
        isMainThread &&
        block?.type === "tool_use" &&
        block.name === "Agent" &&
        block.input?.subagent_type === "erom-research:notebook-creator"
      ) {
        spawned = true;
        if (String(block.input?.prompt ?? "").includes("AUTO_MODE=1")) autoModeInPrompt = true;
      }
      if (isMainThread && block?.type === "text" && typeof block.text === "string") {
        mainThreadTexts.push(block.text);
        if (spawned && relayText === null && block.text.trim()) relayText = block.text;
      }
    }
  }
  return { spawned, autoModeInPrompt, relayText, mainThreadTexts };
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  sink: { text: string },
  onChunk?: () => void,
) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sink.text += decoder.decode(value, { stream: true });
    onChunk?.();
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const caseId = args.find((a) => !a.startsWith("--"));
  const cases: Record<string, CaseDef> = await Bun.file(
    path.join(import.meta.dir, "cases.json"),
  ).json();
  if (!caseId || !cases[caseId]) {
    console.error(`Usage: bun run-auto.ts <${Object.keys(cases).join("|")}> [--allow-auth-ko]`);
    return 2;
  }
  const def = cases[caseId];
  if (def.requiresFlag && !args.includes(def.requiresFlag)) {
    console.error(
      `Case "${caseId}" refused: needs ${def.requiresFlag} (human action required, e.g. nlm logout).`,
    );
    return 2;
  }
  if (!existsSync(CLAUDE_BIN)) {
    console.error(`claude binary not found at ${CLAUDE_BIN}`);
    return 2;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const before = takeSnapshot();
  const started = Date.now();

  const proc = Bun.spawn(
    [
      CLAUDE_BIN,
      "-p",
      "--plugin-dir", PLUGIN_DIR,
      "--model", "sonnet",
      "--effort", "high",
      "--permission-mode", "auto",
      "--permission-prompts", "none",
      "--output-format", "stream-json",
      "--verbose",
      "--no-session-persistence",
    ],
    { cwd: WORKER_CWD, stdin: new TextEncoder().encode(def.prompt), stdout: "pipe", stderr: "pipe" },
  );

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, def.timeoutMs);

  const stdoutSink = { text: "" };
  const stderrSink = { text: "" };
  // Mode stop-after-relay : dès que le relais suit le spawn, on arrête la session (SIGTERM puis SIGKILL après 5 s).
  let stoppedEarly = false;
  const onStdoutChunk = def.mode === "stop-after-relay"
    ? () => {
        if (stoppedEarly || findRelay(stdoutSink.text).relayText === null) return;
        stoppedEarly = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
      }
    : undefined;
  const reading = Promise.all([
    readAll(proc.stdout, stdoutSink, onStdoutChunk),
    readAll(proc.stderr, stderrSink),
  ]);
  const exited = proc.exited.then(() => "exited");
  await exited;
  // Après la sortie (ou le kill), un petit délai de grâce pour vider les pipes
  // sans rester bloqué par un petit-enfant qui garderait le tube ouvert.
  await Promise.race([reading, Bun.sleep(5000)]);
  clearTimeout(timer);
  const durationMs = Date.now() - started;

  const raw = stdoutSink.text;
  await Bun.write(path.join(OUT_DIR, `${caseId}.stream.jsonl`), raw);

  const analysis = analyzeStream(raw);
  const relay = def.mode === "stop-after-relay" ? findRelay(raw) : null;
  if (relay?.relayText) {
    // Pas d'événement result dans ce mode : le dernier mot est celui du message de relais.
    analysis.lastLine =
      relay.relayText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .pop() ?? "";
  }
  const memoryWrites = diffSnapshots(before, takeSnapshot());

  const reportMatch = analysis.lastLine.match(/^\[REPORT\] (.+)$/);
  const reportPath = reportMatch ? reportMatch[1].trim() : null;
  let reportExists = false;
  if (reportPath) {
    try {
      reportExists = statSync(reportPath).size > 0;
    } catch {
      reportExists = false;
    }
  }

  // Contrôles : chaque échec ajoute une raison, `pass` = aucune raison.
  const failures: string[] = [];
  const exp = def.expect;
  if (timedOut) {
    failures.push(
      caseId === "interactive"
        ? "timeout: claude -p stayed alive (background agent)"
        : `timeout: killed after ${def.timeoutMs} ms`,
    );
  } else if (!analysis.hasResult && !relay) {
    failures.push(`no result event in stream (stderr: ${stderrSink.text.trim().slice(0, 300)})`);
  }
  if (relay) {
    if (!relay.spawned) failures.push("no Agent tool_use with subagent_type erom-research:notebook-creator");
    if (relay.autoModeInPrompt) failures.push("spawn prompt contains AUTO_MODE=1 (interactive flow must not)");
    if (relay.spawned && relay.relayText === null) failures.push("no main-thread relay text after the spawn");
    const markerLine = relay.mainThreadTexts
      .flatMap((t) => t.split("\n"))
      .find((l) => /^\[(REPORT|ABORT)\] /.test(l));
    if (markerLine) failures.push(`main thread printed a contract line: "${markerLine}"`);
  }
  if (exp.lastLineEquals !== undefined && analysis.lastLine !== exp.lastLineEquals) {
    failures.push(`lastLine "${analysis.lastLine}" != "${exp.lastLineEquals}"`);
  }
  if (exp.lastLineStartsWith !== undefined && !analysis.lastLine.startsWith(exp.lastLineStartsWith)) {
    failures.push(`lastLine "${analysis.lastLine}" does not start with "${exp.lastLineStartsWith}"`);
  }
  if (exp.lastLineMatches !== undefined && !new RegExp(exp.lastLineMatches).test(analysis.lastLine)) {
    failures.push(`lastLine "${analysis.lastLine}" does not match /${exp.lastLineMatches}/`);
  }
  for (const pattern of exp.lastLineMatchesNone ?? []) {
    if (new RegExp(pattern).test(analysis.lastLine)) {
      failures.push(`lastLine "${analysis.lastLine}" matches forbidden /${pattern}/`);
    }
  }
  if (exp.reportMustExist && !reportExists) {
    failures.push(`report missing or empty (${reportPath ?? "no [REPORT] path"})`);
  }
  if (exp.notebookIdRequired && reportPath && reportExists) {
    const check = checkReport(await Bun.file(reportPath).text());
    if (!check.ok) failures.push(`report frontmatter invalid: ${check.cause}`);
  }
  if (exp.minDurationMs !== undefined && durationMs < exp.minDurationMs) {
    failures.push(`duration ${durationMs} ms < ${exp.minDurationMs} ms`);
  }
  if (exp.maxDurationMs !== undefined && durationMs > exp.maxDurationMs && !timedOut) {
    failures.push(`duration ${durationMs} ms > ${exp.maxDurationMs} ms`);
  }
  if (analysis.forbidden.length > 0) {
    failures.push(`forbidden tools used: ${analysis.forbidden.join(", ")}`);
  }
  const runWrites = memoryWrites.filter((w) => w.attributedTo === "run");
  if (runWrites.length > 0) {
    failures.push(`memory writes by the run: ${runWrites.map((w) => w.path).join(", ")}`);
  }
  if (analysis.skillBaseDir === null) {
    failures.push("skill base directory not found in stream");
  } else if (!analysis.skillBaseDir.startsWith(`${PLUGIN_DIR}/`)) {
    failures.push(`skill loaded from ${analysis.skillBaseDir} instead of the repo plugin dir`);
  }

  const output = {
    caseId,
    lastLine: analysis.lastLine,
    reportPath,
    reportExists,
    forbiddenTools: analysis.forbidden,
    memoryWrites,
    skillBaseDir: analysis.skillBaseDir,
    durationMs,
    ...(relay ? { stoppedEarly } : {}),
    pass: failures.length === 0,
    why: failures.join(" ; "),
  };
  const json = JSON.stringify(output, null, 2);
  await Bun.write(path.join(OUT_DIR, `${caseId}.json`), `${json}\n`);
  console.log(json);
  return output.pass ? 0 : 1;
}

process.exit(await main());
