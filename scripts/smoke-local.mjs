/**
 * End-to-end smoke test against a running LOCAL synthetic scenario.
 * Start the backend with npm run dev:backend, then run npm run test:smoke.
 * Requires a loopback NEXT_PUBLIC_CONVEX_URL and a local CONVEX_DEPLOYMENT.
 * The public client drives the workflow; the local CLI reads exact inventory.
 * Runs two rule-based analyses and leaves the synthetic simulator paused.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const report = {
  startedAt: new Date().toISOString(),
  success: false,
  syntheticDataOnly: true,
  simulatorLeftPaused: false,
  stages: [],
  analyses: [],
  decisions: [],
};
const reportFile = new URL("../.local/smoke-local.json", import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const convexCli = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));
const ref = (name) => makeFunctionReference(name);
const requestFetch = (input, init) => fetch(input, {
  ...init,
  redirect: "error",
  signal: init?.signal ?? AbortSignal.timeout(30_000),
});
const stockSnapshot = (row) => ({ onHand: row.onHand, target: row.target, stockPct: row.stockPct });
const sanitizeError = (error) => {
  let message = String(error?.message ?? error);
  for (const key of ["CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_OVERRIDE_ACCESS_TOKEN"]) {
    if (process.env[key]) message = message.replaceAll(process.env[key], "[REDACTED]");
  }
  return message.slice(0, 1_500);
};
function stage(name, evidence = {}) {
  report.stages.push({ name, at: new Date().toISOString(), ...evidence });
  console.log(JSON.stringify({ stage: name, ...evidence }));
}

try {
  const endpoint = process.env.NEXT_PUBLIC_CONVEX_URL;
  assert.ok(endpoint, "NEXT_PUBLIC_CONVEX_URL is required; this test never creates a deployment.");
  const parsedUrl = new URL(endpoint);
  assert.ok(["http:", "https:"].includes(parsedUrl.protocol), "Backend must use HTTP(S).");
  assert.equal(parsedUrl.username + parsedUrl.password + parsedUrl.search + parsedUrl.hash, "", "Backend URL must not embed credentials or query parameters.");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname), "Smoke tests only run against a loopback backend, never a remote deployment.");
  assert.equal(parsedUrl.pathname, "/", "Backend URL must point to the local server origin.");
  assert.match(process.env.CONVEX_DEPLOYMENT ?? "", /^(anonymous|local):\S+$/, "CONVEX_DEPLOYMENT must select an existing anonymous: or local: deployment.");
  const url = endpoint.replace(/\/$/, "");
  report.backendUrl = url;
  const client = new ConvexHttpClient(url, { logger: false, fetch: requestFetch });

  function readInventory(selection) {
    const result = spawnSync(process.execPath, [convexCli, "run", "agentData:inventoryMetrics", JSON.stringify(selection)], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      // Empty overrides prevent .env fallbacks from selecting a remote target.
      // The CLI obtains its local credentials from its own deployment config.
      env: {
        ...process.env,
        CONVEX_DEPLOY_KEY: "",
        CONVEX_DEPLOYMENT_TOKEN: "",
        CONVEX_SELF_HOSTED_URL: "",
        CONVEX_SELF_HOSTED_ADMIN_KEY: "",
      },
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Local inventory query failed: ${sanitizeError(result.stderr)}`);
    const row = JSON.parse(result.stdout.trim());
    assert.equal(row.city, selection.city);
    assert.equal(row.sku, selection.sku);
    assert.ok([row.onHand, row.target, row.stockPct].every(Number.isFinite), "Inventory evidence must contain finite quantities.");
    return row;
  }

  await client.mutation(ref("comercial:ensureScenario"), {});
  await client.mutation(ref("live:setRunning"), { running: false });
  report.simulatorLeftPaused = true;
  let world = await client.query(ref("live:world"), {});
  assert.equal(world.clock?.running, false, "Simulator must be paused before testing decisions.");
  stage("scenario_ready", { cityCount: world.cities.length, tick: world.clock.tick });

  // Below 25% guarantees the deterministic recommendation predicate. Advance
  // only this synthetic simulation if the freshly initialized stock is healthy.
  let selected;
  for (let advances = 0; advances <= 24; advances++) {
    const shelves = world.cities.flatMap((city) => city.shelves.map((shelf) => ({ city: city.city, ...shelf })));
    selected = shelves.filter((shelf) => shelf.stockPct < 25)
      .sort((a, b) => a.stockPct - b.stockPct || b.waLevel - a.waLevel)[0];
    if (selected) {
      report.syntheticHoursAdvanced = advances;
      break;
    }
    assert.ok(advances < 24, "No low-stock SKU found after 24 bounded synthetic advances.");
    await client.mutation(ref("live:advance"), {});
    world = await client.query(ref("live:world"), {});
    assert.equal(world.clock?.running, false, "Another session resumed the simulator during preparation.");
  }
  assert.ok(selected, "A synthetic SKU must be available.");
  const selection = { city: selected.city, sku: selected.sku };
  report.selection = { ...selection, product: selected.product };
  const inventory = () => readInventory(selection);
  const board = () => client.query(ref("comercial:board"), {});
  const originalStock = stockSnapshot(await inventory());
  assert.ok(originalStock.target > 0 && originalStock.stockPct < 25, "Exact stock must require replenishment.");
  report.stockBefore = originalStock;
  stage("low_stock_selected", { ...report.selection, stock: originalStock, syntheticHoursAdvanced: report.syntheticHoursAdvanced });

  async function analyze(label) {
    const before = await board();
    const existingIds = new Set(before.recommendations.map((item) => item.id));
    const stockBefore = stockSnapshot(await inventory());
    const startedAt = Date.now();
    const result = await client.action(ref("agents/run:analyzeCity"), { ...selection, product: selected.product });
    const entry = { label, startedAt: new Date(startedAt).toISOString(), elapsedMs: Date.now() - startedAt, ...result };
    report.analyses.push(entry);
    assert.equal(result.ok, true, result.error ?? "Rule-based analysis failed.");
    assert.equal(result.mode, "rules", "The smoke test must use the credential-free rules engine.");
    assert.deepEqual(result.agents.map((agent) => agent.role).sort(), ["inventario", "promocion", "whatsapp"]);
    for (const agent of result.agents) {
      assert.ok(Number.isFinite(agent.level) && agent.level >= 0 && agent.level <= 100, "Agent level must be finite and in range.");
      assert.ok(typeof agent.summary === "string" && agent.summary.trim().length > 0 && agent.summary.length <= 300);
      assert.ok(typeof agent.rationale === "string" && agent.rationale.trim().length > 0 && agent.rationale.length <= 1000);
    }
    assert.equal(result.agents.find((agent) => agent.role === "inventario").level, Math.max(0, Math.min(100, stockBefore.stockPct)));
    assert.deepEqual(stockSnapshot(await inventory()), stockBefore, "Analysis itself must never change stock.");
    const after = await board();
    const pending = after.recommendations.filter((item) => item.status === "pending" && item.city === selection.city && item.product === selected.product);
    assert.equal(pending.length, 1, "Exactly one pending recommendation is required for the selection.");
    const recommendation = pending[0];
    assert.ok(!existingIds.has(recommendation.id), "Analysis must create a newly validated recommendation.");
    assert.equal(recommendation.proposedBy, "analistas-reglas");
    assert.equal(recommendation.restockUnits, Math.ceil(stockBefore.target - stockBefore.onHand));
    assert.ok(recommendation.expiresAt > Date.now(), "Recommendation must not already be expired.");
    entry.recommendation = recommendation;
    stage(label, { mode: result.mode, agentCount: result.agents.length, elapsedMs: entry.elapsedMs, recommendationId: recommendation.id, restockUnits: recommendation.restockUnits });
    return recommendation;
  }

  const first = await analyze("first_rules_analysis");
  const rejected = await client.mutation(ref("comercial:decide"), { recommendationId: first.id, decision: "reject" });
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(stockSnapshot(await inventory()), originalStock, "Rejection must not change inventory.");
  const rejectedAgain = await client.mutation(ref("comercial:decide"), { recommendationId: first.id, decision: "reject" });
  assert.deepEqual(rejectedAgain, rejected, "Repeated rejection must return the original decision.");
  assert.deepEqual(stockSnapshot(await inventory()), originalStock, "Repeated rejection must not change inventory.");
  report.decisions.push({ kind: "reject", recommendationId: first.id, repeatedResultIdentical: true, stock: originalStock });
  stage("rejection_idempotent", { recommendationId: first.id, stockUnchanged: true });

  const second = await analyze("second_rules_analysis");
  assert.notEqual(second.id, first.id, "Reanalysis must preserve the rejected decision and create a new proposal.");
  const approved = await client.mutation(ref("comercial:decide"), { recommendationId: second.id, decision: "approve" });
  assert.equal(approved.status, "approved");
  const approvedStock = stockSnapshot(await inventory());
  assert.equal(approvedStock.target, originalStock.target, "Approval cannot change the inventory target.");
  assert.equal(approvedStock.onHand, originalStock.target, "Approval must replenish exactly to the target.");
  const approvedAgain = await client.mutation(ref("comercial:decide"), { recommendationId: second.id, decision: "approve" });
  assert.deepEqual(approvedAgain, approved, "Repeated approval must return the original decision.");
  assert.deepEqual(stockSnapshot(await inventory()), approvedStock, "Repeated approval must not replenish twice.");
  report.stockAfter = approvedStock;
  report.decisions.push({ kind: "approve", recommendationId: second.id, repeatedResultIdentical: true, stock: approvedStock });
  stage("approval_idempotent", { recommendationId: second.id, stock: approvedStock });

  // A fresh public client proves persistence independently of local client state.
  const reloaded = new ConvexHttpClient(url, { logger: false, fetch: requestFetch });
  const finalBoard = await reloaded.query(ref("comercial:board"), {});
  assert.equal(finalBoard.recommendations.find((item) => item.id === first.id)?.status, "rejected");
  assert.equal(finalBoard.recommendations.find((item) => item.id === second.id)?.status, "approved");
  const finalWorld = await reloaded.query(ref("live:world"), {});
  assert.equal(finalWorld.clock?.running, false, "Simulator must remain paused to preserve reviewable evidence.");
  assert.equal(finalWorld.cities.find((city) => city.city === selection.city)?.shelves.find((shelf) => shelf.sku === selection.sku)?.stockPct, 100);
  report.persistenceVerifiedWithFreshClient = true;
  report.success = true;
  stage("persisted_workflow_verified", { success: true, simulatorLeftPaused: true });
} catch (error) {
  report.error = { name: error?.name ?? "Error", message: sanitizeError(error) };
  console.error(JSON.stringify({ success: false, ...report.error }));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(reportFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: ".local/smoke-local.json", success: report.success, analysesCompleted: report.analyses.length, simulatorLeftPaused: report.simulatorLeftPaused }));
}
