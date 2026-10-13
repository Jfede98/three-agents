import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { analyzeInventory, analyzePromotions, analyzeWhatsapp, type Analysis } from "./rules";

type AnalysisResult = { ok: boolean; mode: "rules"; agents: Analysis[]; error?: string };

const agentOut = v.object({
  role: v.union(v.literal("whatsapp"), v.literal("inventario"), v.literal("promocion")),
  summary: v.string(), level: v.number(), rationale: v.string(),
});

/** Three evidence-based rule analyses; no external model or credentials required. */
export const analyzeCity = action({
  args: { city: v.string(), product: v.optional(v.string()), sku: v.optional(v.string()) },
  returns: v.object({ ok: v.boolean(), mode: v.literal("rules"), agents: v.array(agentOut), error: v.optional(v.string()) }),
  handler: async (ctx, args): Promise<AnalysisResult> => {
    const analysisStartedAt = Date.now();
    const city = args.city.trim().toLowerCase();
    if (!["guayaquil", "quito", "cuenca"].includes(city)) throw new ConvexError("Ciudad no disponible en este escenario.");

    const resolved = await ctx.runQuery(internal.agentData.resolveSku, { city, product: args.product, sku: args.sku });
    const [wa, inv, pro] = await Promise.all([
      ctx.runQuery(internal.agentData.whatsappMetrics, { city, sku: resolved.sku }),
      ctx.runQuery(internal.agentData.inventoryMetrics, { city, sku: resolved.sku }),
      ctx.runQuery(internal.agentData.promoMetrics, { city, sku: resolved.sku }),
    ]);
    const metrics = [inv.onHand, inv.target, inv.stockPct, wa.lift, wa.waRecent7, wa.waPrior21, wa.observedCount, wa.baselineCount];
    if (!metrics.every((metric) => Number.isFinite(metric) && metric >= 0) || inv.target <= 0) {
      throw new ConvexError("No hay métricas válidas para analizar este producto. Carga o reinicia los datos sintéticos.");
    }

    const agents = [analyzeWhatsapp(wa), analyzeInventory(inv), analyzePromotions(pro)];
    const applied = await ctx.runMutation(internal.agentApply.applyAgentRun, {
      city, product: resolved.product, sku: resolved.sku, agents,
      inventoryOnHand: inv.onHand, inventoryTarget: inv.target,
      waRecent7: wa.waRecent7, lift: wa.lift, activePromo: pro.activePromo,
      baselineLiveStockId: inv.liveStockId, baselineDecisionRevision: inv.decisionRevision,
      analysisStartedAt,
    });
    if (applied.stale) return { ok: false, mode: "rules" as const, agents: [], error: "El escenario cambió durante el análisis; vuelve a analizar." };
    return { ok: true, mode: "rules" as const, agents };
  },
});
