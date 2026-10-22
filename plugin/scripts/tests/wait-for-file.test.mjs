import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { waitForFile } from "../wait-for-file.mjs";

const SCRIPT = path.join(import.meta.dir, "..", "wait-for-file.mjs");

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wait-for-file-test-"));
}

function runCli(...args) {
  return Bun.spawnSync(["bun", SCRIPT, ...args]);
}

test("waitForFile: returns true in under 100 ms when the file already exists and is not empty", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, "content");
  const start = Date.now();
  expect(await waitForFile(file, 5, 50)).toBe(true);
  expect(Date.now() - start).toBeLessThan(100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("waitForFile: returns true when the file is created after 300 ms", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "report.md");
  setTimeout(() => fs.writeFileSync(file, "late content"), 300);
  expect(await waitForFile(file, 5, 50)).toBe(true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("waitForFile: returns false at the deadline when the file stays empty", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, "");
  const start = Date.now();
  expect(await waitForFile(file, 1, 50)).toBe(false);
  expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("waitForFile: returns false at the deadline when the file is absent", async () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "missing.md");
  expect(await waitForFile(file, 1, 50)).toBe(false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: exit code 0 when the file already exists and is not empty", () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "report.md");
  fs.writeFileSync(file, "content");
  expect(runCli(file, "5").exitCode).toBe(0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: exit code 1 at the deadline when the file is absent", () => {
  const dir = makeTmpDir();
  const file = path.join(dir, "missing.md");
  expect(runCli(file, "1").exitCode).toBe(1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: exit code 2 on a relative path", () => {
  expect(runCli("relative/report.md", "5").exitCode).toBe(2);
});

test("CLI: exit code 2 when seconds is 0 or 101", () => {
  expect(runCli("/tmp/report.md", "0").exitCode).toBe(2);
  expect(runCli("/tmp/report.md", "101").exitCode).toBe(2);
});

test("CLI: exit code 2 when seconds is missing or not an integer", () => {
  expect(runCli("/tmp/report.md").exitCode).toBe(2);
  expect(runCli("/tmp/report.md", "abc").exitCode).toBe(2);
});
