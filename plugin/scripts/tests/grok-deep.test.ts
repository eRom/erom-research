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
  expect(fm).toContain("source_tool: erom-research:deep-grok");
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
