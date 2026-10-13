import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = join(ROOT, "data", "mock");
const CLI = join(ROOT, "node_modules", "convex", "bin", "main.js");

for (const name of [".env.local", ".env"]) {
  const path = join(ROOT, name);
  if (existsSync(path)) loadEnvFile(path);
}

const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
const endpoint = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!/^(anonymous|local):\S+$/.test(deployment) || !endpoint) {
  throw new Error("Primero configura un backend Convex local con npm run setup.");
}
const url = new URL(endpoint);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') {
  throw new Error("La importación sólo admite un backend local, nunca un destino remoto.");
}
if (["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"].some((key) => process.env[key])) {
  throw new Error("Retira las variables que sobreescriben el destino local antes de importar.");
}

function runConvex(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT, stdio: "inherit", shell: false, windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const TABLES = [
  "catalogItems",
  "pharmacyBranches",
  "waDaily",
  "inventoryPositions",
  "promoCalendar",
  "newsItems",
  "opsMeta",
  "waMessages",
];

for (const table of TABLES) {
  if (!existsSync(join(MOCK, `${table}.jsonl`))) throw new Error(`Falta el archivo de ${table}.`);
}
console.log(`Destino: ${deployment} (${url.origin}), desarrollo local. Se reemplazan las ocho tablas sintéticas.`);
for (const table of TABLES) {
  const file = join(MOCK, `${table}.jsonl`);
  console.log(`Importing ${table}...`);
  runConvex(["import", "--replace", "--yes", "--table", table, file]);
}

console.log("Rebuilding insights from imported rows...");
runConvex(["run", "insights:runRebuild", JSON.stringify({ replaceRecommendations: true })]);
