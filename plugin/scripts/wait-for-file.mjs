// Attend au premier plan qu'un fichier existe et ne soit pas vide.
// Usage : bun wait-for-file.mjs <chemin absolu> <secondes>
// Codes de sortie : 0 fichier prêt (rien sur stdout), 1 échéance atteinte (stdout : `timeout`), 2 argument invalide.
import * as path from "node:path";

const MIN_SECONDS = 1;
const MAX_SECONDS = 100;

// Un fichier "prêt" existe et contient au moins un octet.
async function isReady(filePath) {
  const file = Bun.file(filePath);
  return (await file.exists()) && file.size > 0;
}

/**
 * Sonde `filePath` toutes les `intervalMs` ms jusqu'à `seconds` secondes.
 * Retourne true dès que le fichier existe et n'est pas vide, false à l'échéance.
 */
export async function waitForFile(filePath, seconds, intervalMs = 2000) {
  const deadline = Date.now() + seconds * 1000;
  while (true) {
    if (await isReady(filePath)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}

function usage() {
  console.error("Usage: bun wait-for-file.mjs <absolute path> <seconds 1-100>");
  process.exit(2);
}

if (import.meta.main) {
  const [filePath, rawSeconds] = process.argv.slice(2);
  if (!filePath || !path.isAbsolute(filePath)) usage();
  if (!/^\d+$/.test(rawSeconds ?? "")) usage();
  const seconds = Number(rawSeconds);
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) usage();
  if (await waitForFile(filePath, seconds)) process.exit(0);
  console.log("timeout");
  process.exit(1);
}
