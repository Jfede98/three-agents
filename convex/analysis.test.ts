/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-10-08T17:00:00Z");
const selection = { city: "guayaquil", sku: "FE-VC500", product: "Vitamina C" };

function makeTest() {
  return convexTest(schema, modules);
}

async function seedStock(t: ReturnType<typeof makeTest>, onHand = 100, target = 1000) {
  return t.run(async (ctx) => {
    await ctx.db.insert("liveClock", {
      key: "main", running: false, fast: false, tick: 10,
      generation: 1, aliveUntil: NOW + 180_000, scheduled: false,
    });
    return ctx.db.insert("liveStock", {
      ...selection, category: "vitaminas", onHand, target,
      baseRate: 1, waRate: 3, salesRate: 0, heat: 3, heatTarget: 3,
      trend: "Demanda sintética", promoUntil: 0, seasonPromo: false,
      snoozeUntil: 0, lastBand: 3,
    });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("analysis by rules without external services", () => {
  it("analyzes all three roles without network calls and waits for human approval", async () => {
    const t = makeTest();
    const stockId = await seedStock(t);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External services unavailable"));
    const result = await t.action(api.agents.run.analyzeCity, selection);
    expect(network).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, mode: "rules" });
    expect(result.agents.map((agent) => agent.role)).toEqual(["whatsapp", "inventario", "promocion"]);
    expect(result.agents.map((agent) => agent.level)).toEqual([100, 10, 0]);
    expect(result.agents[0].summary).toContain("18 consultas por hora");
    expect(result.agents[0].summary).toContain("base comparable: 6");

    const board = await t.query(api.comercial.board, {});
    expect(board.signals).toHaveLength(3);
    expect(board.recommendations).toHaveLength(1);
    const proposal = board.recommendations[0];
    expect(proposal).toMatchObject({ status: "pending", proposedBy: "analistas-reglas", restockUnits: 900, promoDays: 7 });
    expect((await t.run((ctx) => ctx.db.get(stockId)))?.onHand).toBe(100);

    await t.mutation(api.comercial.decide, { recommendationId: proposal.id, decision: "approve" });
    expect((await t.run((ctx) => ctx.db.get(stockId)))?.onHand).toBe(1000);
  });

  it("does not create a replenishment proposal when inventory is full", async () => {
    const t = makeTest();
    await seedStock(t, 1000);
    const result = await t.action(api.agents.run.analyzeCity, selection);
    expect(result.ok).toBe(true);
    expect(result.agents.find((agent) => agent.role === "inventario")?.level).toBe(100);
    expect((await t.query(api.comercial.board, {})).recommendations).toHaveLength(0);
  });

  it("keeps a current promotion and does not propose a duplicate one", async () => {
    const t = makeTest();
    const stockId = await seedStock(t);
    await t.run((ctx) => ctx.db.patch(stockId, { seasonPromo: true }));
    const result = await t.action(api.agents.run.analyzeCity, selection);
    expect(result.agents.find((agent) => agent.role === "promocion")?.level).toBe(100);
    const proposal = (await t.query(api.comercial.board, {})).recommendations[0];
    expect(proposal.restockUnits).toBe(900);
    expect(proposal.promoDays).toBeNull();
  });

  it("uses historical data when no live simulation is present", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      await ctx.db.insert("catalogItems", { sku: selection.sku, name: selection.product, category: "vitaminas", form: "tabletas" });
      await ctx.db.insert("inventoryPositions", { ...selection, branchCode: "GYE-001", asOf: NOW, onHand: 800, target: 1000, unitCostCents: 100 });
      await ctx.db.insert("waDaily", { ...selection, day: "2026-10-07", inbound: 60 });
      await ctx.db.insert("waDaily", { ...selection, day: "2026-09-20", inbound: 90 });
    });
    const result = await t.action(api.agents.run.analyzeCity, selection);
    expect(result.agents[0].summary).toContain("60 consultas en 7 días");
    expect(result.agents[0].summary).toContain("base comparable: 30");
    expect(result.agents[0].summary).toContain("×2.0");
    expect(result.agents[1].level).toBe(80);
    expect((await t.query(api.comercial.board, {})).recommendations).toHaveLength(0);
  });

  it("rejects an unsupported city without changing the board", async () => {
    const t = makeTest();
    await expect(t.action(api.agents.run.analyzeCity, { ...selection, city: "unknown" })).rejects.toThrow("Ciudad no disponible");
    expect(await t.query(api.comercial.board, {})).toEqual({ signals: [], recommendations: [] });
  });

  it("rejects a product/SKU mismatch without changing the board", async () => {
    const t = makeTest();
    await seedStock(t);
    await expect(t.action(api.agents.run.analyzeCity, { ...selection, product: "Otro producto" })).rejects.toThrow("no coincide");
    expect(await t.query(api.comercial.board, {})).toEqual({ signals: [], recommendations: [] });
  });

  it.each([0, -100])("rejects invalid inventory target %s without changes", async (target) => {
    const t = makeTest();
    await seedStock(t, 100, target);
    await expect(t.action(api.agents.run.analyzeCity, selection)).rejects.toThrow("No hay métricas válidas");
    expect(await t.query(api.comercial.board, {})).toEqual({ signals: [], recommendations: [] });
  });

  it("rejects a catalog item with no inventory data", async () => {
    const t = makeTest();
    await t.run((ctx) => ctx.db.insert("catalogItems", { sku: selection.sku, name: selection.product, category: "vitaminas", form: "tabletas" }));
    await expect(t.action(api.agents.run.analyzeCity, selection)).rejects.toThrow("No hay métricas válidas");
    expect(await t.query(api.comercial.board, {})).toEqual({ signals: [], recommendations: [] });
  });
});
