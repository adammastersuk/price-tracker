import { PricingStatus, TrackedProductRow } from "@/types/pricing";

export const IN_LINE_TOLERANCE_PERCENT = Number.parseFloat(process.env.DEFAULT_PRICE_TOLERANCE ?? "3") || 3;

export function derivePricingStatus(row: Pick<TrackedProductRow, "competitorCurrentPrice"|"competitorPromoPrice"|"competitorStockStatus"|"priceDifferencePercent">): PricingStatus {
  if (row.competitorStockStatus === "Out of Stock") return "Competitor out of stock";
  if (row.competitorCurrentPrice === null) return "Missing competitor data";
  if (row.competitorPromoPrice !== null && row.competitorPromoPrice < row.competitorCurrentPrice) return "Promo discrepancy";
  if (row.priceDifferencePercent === null || Number.isNaN(row.priceDifferencePercent)) return "Needs review";
  if (Math.abs(row.priceDifferencePercent) <= IN_LINE_TOLERANCE_PERCENT) return "In line with competitor";
  return row.priceDifferencePercent > 0 ? "Higher than competitor" : "Cheaper than competitor";
}

export function materialGap(row: TrackedProductRow): boolean {
  return row.priceDifferencePercent !== null && Math.abs(row.priceDifferencePercent) >= 10;
}
