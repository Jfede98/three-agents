export type Analysis = {
  role: "whatsapp" | "inventario" | "promocion";
  summary: string;
  level: number;
  rationale: string;
};

type WhatsappEvidence = {
  product: string;
  metricWindow: "hour" | "7days";
  observedCount: number;
  baselineCount: number;
  lift: number;
  sampleMessages: string[];
  newsTitles: string[];
};

type InventoryEvidence = {
  onHand: number;
  target: number;
  criticalBranches: { branchCode: string; onHand: number; target: number }[];
};

type PromotionEvidence = {
  activePromo: boolean;
  promos: { promoId: string }[];
};

function percent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function analyzeWhatsapp(evidence: WhatsappEvidence): Analysis {
  const window = evidence.metricWindow === "hour" ? "por hora" : "en 7 días";
  const context = evidence.newsTitles.slice(0, 2).map((title) => title.slice(0, 140)).join("; ");
  return {
    role: "whatsapp",
    summary: `${evidence.observedCount} consultas ${window} sobre ${evidence.product}; base comparable: ${evidence.baselineCount} (×${evidence.lift.toFixed(1)}).`,
    level: percent(20 + (evidence.lift - 1) * 58),
    rationale: [
      "Análisis por reglas sobre datos sintéticos.",
      evidence.metricWindow === "hour"
        ? "Se compara la tasa horaria simulada con su base; las proyecciones de 7 y 21 días no se presentan como historial observado."
        : "La referencia de 7 días corresponde a un tercio de las consultas de los 21 días previos.",
      `${evidence.sampleMessages.length} mensajes de muestra disponibles.`,
      context ? `Contexto sintético relacionado: ${context}. No demuestra causalidad.` : "",
    ].filter(Boolean).join(" "),
  };
}

export function analyzeInventory(evidence: InventoryEvidence): Analysis {
  const stockPct = Math.round(100 * evidence.onHand / evidence.target);
  const branches = evidence.criticalBranches.slice(0, 5)
    .map((branch) => `${branch.branchCode}: ${branch.onHand}/${branch.target} u.`).join("; ");
  return {
    role: "inventario",
    summary: `Stock zonal al ${stockPct}% (${evidence.onHand} de ${evidence.target} u.). ${stockPct < 30 ? "Cobertura baja: revisar reposición." : "Cobertura sobre el umbral de alerta del 30%."}`,
    level: percent(stockPct),
    rationale: [
      "El porcentaje se calcula directamente con existencias y objetivo del inventario sintético.",
      branches ? `Sucursales con menos del 25%: ${branches}.` : "No se dispone de un desglose de sucursales críticas en esta selección.",
      "El análisis no modifica existencias; una reposición requiere aprobación humana.",
    ].join(" "),
  };
}

export function analyzePromotions(evidence: PromotionEvidence): Analysis {
  return {
    role: "promocion",
    summary: evidence.activePromo ? "Hay una promoción vigente para este producto y zona." : "No hay una promoción vigente para este producto y zona.",
    level: evidence.activePromo ? 100 : 0,
    rationale: `Estado verificado en el calendario o escenario sintético (${evidence.promos.length} registros consultados). La vigencia contempla las fechas del escenario y las promociones nacionales. Cualquier nueva promoción requiere aprobación humana.`,
  };
}
