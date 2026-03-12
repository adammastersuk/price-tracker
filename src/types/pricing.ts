export type CompetitorStockStatus = "In Stock" | "Low Stock" | "Out of Stock" | "Unknown";
export type PricingStatus = "Higher than competitor" | "Cheaper than competitor" | "In line with competitor" | "Promo discrepancy" | "Competitor out of stock" | "Needs review" | "Missing competitor data";
export type MatchConfidence = "High" | "Medium" | "Low" | "Needs review";
export type WorkflowStatus = "Open" | "In Review" | "Awaiting Supplier" | "Resolved";
export type CheckStatus = "success" | "failed" | "suspicious" | "pending";

export interface PriceHistoryPoint { checkedAt: string; bentsPrice: number; competitorPrice: number | null; }
export interface NoteEntry { id: string; author: string; message: string; createdAt: string; }
export interface CompetitorListing {
  id: string;
  competitorName: string;
  competitorProductUrl: string;
  competitorCurrentPrice: number | null;
  competitorPromoPrice: number | null;
  competitorWasPrice: number | null;
  competitorStockStatus: CompetitorStockStatus;
  lastCheckedAt: string;
  lastCheckStatus: CheckStatus;
  checkErrorMessage: string;
  rawPriceText: string;
  extractionSource: string;
  extractionMetadata: Record<string, unknown>;
  suspiciousChangeFlag: boolean;
  priceDifferenceGbp: number | null;
  priceDifferencePercent: number | null;
  pricingStatus: PricingStatus;
}

export interface TrackedProductRow {
  id: string; internalSku: string; productName: string; brand: string; department: string; buyer: string; supplier: string;
  costPrice: number | null; bentsRetailPrice: number; marginPercent: number | null; bentsProductUrl: string;
  competitorName: string; competitorProductUrl: string; competitorCurrentPrice: number | null; competitorPromoPrice: number | null;
  competitorWasPrice: number | null; competitorStockStatus: CompetitorStockStatus; lastCheckedAt: string;
  lastCheckStatus: CheckStatus; checkErrorMessage: string; rawPriceText: string; extractionSource: string; suspiciousChangeFlag: boolean;
  priceDifferenceGbp: number | null; priceDifferencePercent: number | null; pricingStatus: PricingStatus;
  competitorCount: number;
  additionalCompetitorCount: number;
  competitorSummaryLabel: string;
  competitorListings: CompetitorListing[];
  matchConfidence: MatchConfidence; reviewStatus: MatchConfidence; internalNote: string; actionOwner: string; actionWorkflowStatus: WorkflowStatus;
  noteHistory: NoteEntry[]; history: PriceHistoryPoint[];
}

export interface CsvImportRow {
  sku: string; productName: string; bentsPrice: number; bentsUrl: string; competitorName: string; competitorUrl: string;
  buyer?: string; supplier?: string; department?: string; cost?: number;
}
