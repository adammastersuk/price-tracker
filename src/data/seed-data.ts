import { derivePricingStatus } from "@/lib/pricing-logic";
import { TrackedProductRow } from "@/types/pricing";

const base = [
  ["GF-1001", "Kensington 4 Seat Rattan Lounge Set", "Hartman", "Garden Furniture", "Olivia Clarke", "Hartman UK", 499, 899, "https://bents.co.uk/kensington-lounge"],
  ["BBQ-2011", "Genesis E-325 Gas BBQ", "Weber", "BBQ", "James Patel", "Weber UK", 620, 999, "https://bents.co.uk/genesis-e325"],
  ["GFT-3032", "Luxury Botanist Gift Hamper", "Bents Signature", "Gifting", "Emma Reed", "Bents Food Co", 22, 49.99, "https://bents.co.uk/botanist-hamper"],
  ["HW-4104", "Stoneware Reactive Glaze Dinner Set", "Denby", "Homewares", "Rachel Moss", "Denby Retail", 38, 79, "https://bents.co.uk/stoneware-set"],
  ["XMAS-5022", "Pre-Lit Imperial Spruce 7ft", "Everlands", "Christmas", "Tom Dwyer", "Festive Imports", 140, 299, "https://bents.co.uk/imperial-spruce"],
  ["FH-6019", "Artisan Panettone 1kg", "Loison", "Foodhall", "Emma Reed", "Mediterranean Fine Foods", 11.5, 24.5, "https://bents.co.uk/artisan-panettone"]
] as const;

const competitors = ["Dobbies", "Notcutts", "BBQ World", "B&Q"] as const;
const stock = ["In Stock", "Low Stock", "Out of Stock", "Unknown"] as const;

export const seededRows: TrackedProductRow[] = Array.from({ length: 30 }).map((_, index) => {
  const b = base[index % base.length];
  const cp = competitors[index % competitors.length];
  const bentsPrice = Number((b[7] + (index % 3 === 0 ? 0 : (index % 2 === 0 ? 20 : -15))).toFixed(2));
  const competitorCurrent = index % 7 === 0 ? null : Number((bentsPrice + ((index % 5) - 2) * 18).toFixed(2));
const promo =
  competitorCurrent && index % 6 === 0
    ? Number((competitorCurrent * 0.9).toFixed(2))
    : null;

let diffGbp: number | null = null;
let diffPct: number | null = null;

if (competitorCurrent !== null) {
  diffGbp = Number((bentsPrice - competitorCurrent).toFixed(2));
  diffPct = Number((((bentsPrice - competitorCurrent) / competitorCurrent) * 100).toFixed(2));
}
  const competitorStockStatus = stock[index % stock.length];
  const pricingStatus = derivePricingStatus({ competitorCurrentPrice: competitorCurrent, competitorPromoPrice: promo, competitorStockStatus, priceDifferencePercent: diffPct });
  const marginPercent = Number((((bentsPrice - b[6]) / bentsPrice) * 100).toFixed(1));

  return {
    id: `row-${index + 1}`,
    internalSku: `${b[0]}-${index + 1}`,
    productName: b[1],
    brand: b[2],
    department: b[3],
    buyer: b[4],
    supplier: b[5],
    costPrice: b[6],
    bentsRetailPrice: bentsPrice,
    marginPercent,
    bentsProductUrl: b[8],
    competitorName: cp,
    competitorProductUrl: `https://${cp.toLowerCase().replace("&","").replace(" ","")}.co.uk/product/${index + 1000}`,
    competitorCurrentPrice: competitorCurrent,
    competitorPromoPrice: promo,
    competitorWasPrice: promo ? competitorCurrent : null,
    competitorStockStatus,
    lastCheckedAt: new Date(Date.now() - index * 3600_000 * 4).toISOString(),
    lastCheckStatus: "success",
    checkErrorMessage: "",
    rawPriceText: competitorCurrent ? `£${competitorCurrent}` : "",
    extractionSource: "seed",
    suspiciousChangeFlag: false,
    priceDifferenceGbp: diffGbp,
    priceDifferencePercent: diffPct,
    pricingStatus,
    competitorCount: 1,
    additionalCompetitorCount: 0,
    competitorSummaryLabel: cp,
    competitorListings: [{
      id: `comp-${index + 1}`,
      competitorName: cp,
      competitorProductUrl: `https://${cp.toLowerCase().replace("&","").replace(" ","")}.co.uk/product/${index + 1000}`,
      competitorCurrentPrice: competitorCurrent,
      competitorPromoPrice: promo,
      competitorWasPrice: promo ? competitorCurrent : null,
      competitorStockStatus,
      lastCheckedAt: new Date(Date.now() - index * 3600_000 * 4).toISOString(),
      lastCheckStatus: "success",
      checkErrorMessage: "",
      rawPriceText: competitorCurrent ? `£${competitorCurrent}` : "",
      extractionSource: "seed",
      extractionMetadata: {},
      suspiciousChangeFlag: false,
      priceDifferenceGbp: diffGbp,
      priceDifferencePercent: diffPct,
      pricingStatus
    }],
    matchConfidence: index % 9 === 0 ? "Low" : index % 4 === 0 ? "Medium" : "High",
    reviewStatus: index % 9 === 0 ? "Needs review" : index % 4 === 0 ? "Medium" : "High",
    internalNote: index % 4 === 0 ? "Check supplier rebate before any price decision." : "",
    actionOwner: ["Olivia Clarke", "James Patel", "Emma Reed", "Rachel Moss"][index % 4],
    actionWorkflowStatus: index % 8 === 0 ? "Open" : index % 5 === 0 ? "Awaiting Supplier" : index % 3 === 0 ? "Resolved" : "In Review",
    noteHistory: [{ id: `n${index}-1`, author: "Pricing Analyst", message: "Reviewed against latest promo windows.", createdAt: new Date(Date.now() - 86400000).toISOString() }],
    history: Array.from({ length: 8 }).map((__, h) => ({ checkedAt: new Date(Date.now() - h * 86400000).toISOString(), bentsPrice, competitorPrice: competitorCurrent ? Number((competitorCurrent + h).toFixed(2)) : null })),
    sourceHealth: {
      bents: { success: true, checkedAt: new Date(Date.now() - index * 3600_000 * 4).toISOString(), status: "success", stale: false },
      competitors: { total: 1, success: 1, failed: 0, suspicious: 0, pending: 0, stale: false, lastCheckedAt: new Date(Date.now() - index * 3600_000 * 4).toISOString() }
    },
    cycleHealth: {
      lastCycleCheckedAt: new Date(Date.now() - index * 3600_000 * 4).toISOString(),
      lastFullCheckAt: new Date(Date.now() - index * 3600_000 * 4).toISOString(),
      successfulSources: 2,
      failedSources: 0,
      totalSources: 2,
      partialFailure: false,
      stale: false
    },
    monitorability: { category: "fully_monitorable", label: "Fully monitorable", reasons: [], isMonitorable: true }

  };
});
