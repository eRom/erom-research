import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkReport } from "../check-report.mjs";

const SCRIPT = path.join(import.meta.dir, "..", "check-report.mjs");

function runCli(...args) {
  return Bun.spawnSync(["bun", SCRIPT, ...args]);
}

test("checkReport: ok when the frontmatter carries a notebook_id", () => {
  const text = "---\ntitle: \"Sujet\"\nnotebook_id: abc123\n---\n\n# Rapport\n";
  expect(checkReport(text)).toEqual({ ok: true });
});

test("checkReport: incomplete when the frontmatter has no notebook_id", () => {
  const text = "---\ntitle: \"Sujet\"\n---\n\n# Rapport\n";
  const result = checkReport(text);
  expect(result.ok).toBe(false);
  expect(result.cause).toBe("Rapport incomplet : notebook_id absent");
});

test("checkReport: incomplete when notebook_id is empty", () => {
  const text = "---\ntitle: \"Sujet\"\nnotebook_id:\n---\n\n# Rapport\n";
  const result = checkReport(text);
  expect(result.ok).toBe(false);
  expect(result.cause).toBe("Rapport incomplet : notebook_id absent");
});

test("checkReport: unreadable when the text has no frontmatter", () => {
  const result = checkReport("# Rapport sans frontmatter\n\nnotebook_id: abc123\n");
  expect(result.ok).toBe(false);
  expect(result.cause.startsWith("Rapport illisible")).toBe(true);
});

test("checkReport: unreadable when the frontmatter is never closed", () => {
  const result = checkReport("---\ntitle: x\nnotebook_id: abc123\n");
  expect(result.ok).toBe(false);
  expect(result.cause.startsWith("Rapport illisible")).toBe(true);
});

test("checkReport: ignores a notebook_id that sits in the body, past the frontmatter", () => {
  const text = "---\ntitle: x\n---\n\nnotebook_id: abc123\n";
  const result = checkReport(text);
  expect(result.ok).toBe(false);
  expect(result.cause).toBe("Rapport incomplet : notebook_id absent");
});

test("checkReport: agent failure with a quoted abort_cause", () => {
  const text = "---\ntitle: x\nabort_cause: \"nlm research start: quota exceeded\"\n---\n";
  expect(checkReport(text)).toEqual({
    ok: false,
    cause: "Échec de l'agent : nlm research start: quota exceeded",
  });
});

test("checkReport: agent failure with an unquoted abort_cause", () => {
  const text = "---\ntitle: x\nabort_cause: login expired\n---\n";
  expect(checkReport(text)).toEqual({
    ok: false,
    cause: "Échec de l'agent : login expired",
  });
});

test("checkReport: abort_cause takes precedence over a present notebook_id", () => {
  const text = "---\nnotebook_id: abc123\nabort_cause: \"sources import failed\"\n---\n";
  const result = checkReport(text);
  expect(result.ok).toBe(false);
  expect(result.cause).toBe("Échec de l'agent : sources import failed");
});

test("checkReport: an empty abort_cause is ignored", () => {
  const text = "---\nnotebook_id: abc123\nabort_cause:\n---\n";
  expect(checkReport(text)).toEqual({ ok: true });
});

test("CLI: exit code 0 and no stdout for a valid report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-report-test-"));
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, "---\nnotebook_id: abc123\n---\n\n# Rapport\n");
  const res = runCli(file);
  expect(res.exitCode).toBe(0);
  expect(res.stdout.toString()).toBe("");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: exit code 1 and the cause on stdout for an incomplete report", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-report-test-"));
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, "---\ntitle: x\n---\n");
  const res = runCli(file);
  expect(res.exitCode).toBe(1);
  expect(res.stdout.toString().trim()).toBe("Rapport incomplet : notebook_id absent");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: exit code 1 and an abort_cause line for a failed agent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-report-test-"));
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, "---\nabort_cause: \"quota exceeded\"\n---\n");
  const res = runCli(file);
  expect(res.exitCode).toBe(1);
  expect(res.stdout.toString().trim()).toBe("Échec de l'agent : quota exceeded");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: exit code 1 and 'Rapport illisible' when the file does not exist", () => {
  const res = runCli("/nonexistent/dir/report.md");
  expect(res.exitCode).toBe(1);
  expect(res.stdout.toString().startsWith("Rapport illisible")).toBe(true);
});

test("CLI: exit code 2 on a relative or missing path argument", () => {
  expect(runCli("relative/report.md").exitCode).toBe(2);
  expect(runCli().exitCode).toBe(2);
});
