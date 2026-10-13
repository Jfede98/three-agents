import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const name of [".env.local", ".env"]) {
  const path = join(root, name);
  if (existsSync(path)) loadEnvFile(path);
}

const mode = process.argv[2] ?? "dev";
if (!["dev", "setup", "backend"].includes(mode)) throw new Error("Modo local desconocido.");
const deployment = process.env.CONVEX_DEPLOYMENT;
if (deployment && !/^(anonymous|local):\S+$/.test(deployment)) {
  throw new Error("Este comando sólo inicia Convex local. Selecciona un despliegue local antes de continuar.");
}
if (["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"].some((key) => process.env[key])) {
  throw new Error("Hay credenciales que sobreescriben el destino local. Retíralas de este entorno antes de continuar.");
}
const endpoint = process.env.NEXT_PUBLIC_CONVEX_URL;
if (endpoint) {
  const url = new URL(endpoint);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error("La URL del frontend debe corresponder al backend local.");
  }
}

console.log(`Destino: ${deployment ?? "nuevo backend local sin cuenta"}.`);
// Non-interactive Convex creates an anonymous local backend on a fresh checkout.
// An existing remote selector has already been rejected above, before any push.
// Launch Node directly: shell-based subprocesses are unreliable on Windows.
const backend = spawn(process.execPath, [join(root, "node_modules", "convex", "bin", "main.js"), "dev"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
});
let companion;
let ready = false;
let finished = false;
let output = "";

function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // Limit termination to this launcher's own child process and descendants.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(startupTimeout);
  stop(companion);
  stop(backend);
  process.exitCode = code;
}

const startupTimeout = setTimeout(() => {
  console.error("Convex no confirmó el arranque en cinco minutos. Revisa su salida antes de reintentar.");
  finish(1);
}, 300_000);

function onOutput(chunk, stream) {
  stream.write(chunk);
  output = (output + chunk.toString()).slice(-4096);
  if (finished || ready || !output.includes("Convex functions ready!")) return;
  ready = true;
  clearTimeout(startupTimeout);
  if (mode === "backend") return;
  const args = mode === "setup"
    ? [join(root, "scripts", "import-ops-data.mjs")]
    : [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3000"];
  companion = spawn(process.execPath, args, {
    cwd: root, stdio: "inherit", shell: false, windowsHide: true,
  });
  companion.on("error", (error) => { console.error(error.message); finish(1); });
  companion.on("exit", (code) => finish(code ?? 1));
}

backend.stdout.on("data", (chunk) => onOutput(chunk, process.stdout));
backend.stderr.on("data", (chunk) => onOutput(chunk, process.stderr));
backend.on("error", (error) => { console.error(error.message); finish(1); });
backend.on("exit", (code) => finish(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => finish(0));
}
