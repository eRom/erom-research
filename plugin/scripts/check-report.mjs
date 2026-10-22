// Contrôle le frontmatter d'un rapport deep-notebook avant de l'annoncer.
// Usage : bun check-report.mjs <chemin absolu>
// Codes de sortie : 0 rapport valide, 1 rapport invalide (cause sur stdout), 2 argument invalide.
import * as path from "node:path";

// Valeur d'un champ "clé: valeur", sans espaces ni guillemets doubles englobants.
function fieldValue(line, key) {
  if (!line.startsWith(`${key}:`)) return null;
  let value = line.slice(key.length + 1).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Valide le frontmatter (délimité par les deux premières lignes `---`).
 * Les messages de `cause` sont affichés à l'utilisateur : ils restent en français.
 */
export function checkReport(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { ok: false, cause: "Rapport illisible : frontmatter absent" };
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) {
    return { ok: false, cause: "Rapport illisible : frontmatter non refermé" };
  }

  let notebookId = "";
  let abortCause = "";
  for (const line of lines.slice(1, end)) {
    const id = fieldValue(line, "notebook_id");
    if (id !== null) notebookId = id;
    const abort = fieldValue(line, "abort_cause");
    if (abort !== null) abortCause = abort;
  }

  // L'échec déclaré par l'agent prime sur la présence d'un notebook_id.
  if (abortCause) return { ok: false, cause: `Échec de l'agent : ${abortCause}` };
  if (!notebookId) return { ok: false, cause: "Rapport incomplet : notebook_id absent" };
  return { ok: true };
}

if (import.meta.main) {
  const [filePath] = process.argv.slice(2);
  if (!filePath || !path.isAbsolute(filePath)) {
    console.error("Usage: bun check-report.mjs <absolute path>");
    process.exit(2);
  }
  let text;
  try {
    text = await Bun.file(filePath).text();
  } catch (err) {
    console.log(`Rapport illisible : ${err.code ?? "lecture impossible"}`);
    process.exit(1);
  }
  const result = checkReport(text);
  if (result.ok) process.exit(0);
  console.log(result.cause);
  process.exit(1);
}
