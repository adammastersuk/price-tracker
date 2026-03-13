import { CompetitorListing, TrackedProductRow, WorkflowStatus } from "@/types/pricing";

export interface ProductFilters {
  search: string;
  buyers: string[];
  departments: string[];
  suppliers: string[];
  brands: string[];
  competitors: string[];
  statuses: string[];
}

export const defaultFilters: ProductFilters = {
  search: "",
  buyers: [],
  departments: [],
  suppliers: [],
  brands: [],
  competitors: [],
  statuses: []
};

const DEFAULT_STALE_HOURS = Number.parseFloat(process.env.NEXT_PUBLIC_STALE_CHECK_HOURS ?? "24") || 24;

export interface RuntimeSettingsInput {
  scrapeDefaults?: { staleCheckHours?: number };
}

function staleHours(runtime?: RuntimeSettingsInput) {
  return Number(runtime?.scrapeDefaults?.staleCheckHours ?? DEFAULT_STALE_HOURS) || DEFAULT_STALE_HOURS;
}


export interface TrustedCompetitor {
  competitorName: string;
  price: number;
  listingId: string;
  stockStatus: CompetitorListing["competitorStockStatus"];
  productUrl: string;
}

export interface CommercialSignals {
  stale: boolean;
  missingMapping: boolean;
  failedCheck: boolean;
  suspicious: boolean;
  promoDiscrepancy: boolean;
  missingValidCompetitorPrice: boolean;
  checkedToday: boolean;
  bentsNotCheapest: boolean;
  lowestTrusted: TrustedCompetitor | null;
  gapGbp: number;
  gapPercent: number;
}

export interface QueueItem {
  row: TrackedProductRow;
  reason: string;
  score: number;
  gapGbp: number;
  gapPercent: number;
  lowestTrusted: TrustedCompetitor | null;
}

function matchMulti(selected: string[], value: string) {
  return selected.length === 0 || selected.includes(value);
}

export function queryProducts(rows: TrackedProductRow[], filters: ProductFilters): TrackedProductRow[] {
  return rows.filter((r) => {
    const search = filters.search.toLowerCase();
    const matchSearch = !search
      || r.internalSku.toLowerCase().includes(search)
      || r.productName.toLowerCase().includes(search);
    return matchSearch
      && matchMulti(filters.buyers, r.buyer)
      && matchMulti(filters.departments, r.department)
      && matchMulti(filters.suppliers, r.supplier)
      && matchMulti(filters.brands, r.brand)
      && (filters.competitors.length === 0 || r.competitorListings.some((c) => filters.competitors.includes(c.competitorName)))
      && (filters.statuses.length === 0 || filters.statuses.includes(r.pricingStatus) || filters.statuses.includes(r.actionWorkflowStatus));
  });
}

export function uniqueValues(rows: TrackedProductRow[]) {
  return {
    buyers: [...new Set(rows.map((r) => r.buyer).filter(Boolean))],
    departments: [...new Set(rows.map((r) => r.department).filter(Boolean))],
    suppliers: [...new Set(rows.map((r) => r.supplier).filter(Boolean))],
    brands: [...new Set(rows.map((r) => r.brand).filter(Boolean))],
    competitors: [...new Set(rows.flatMap((r) => r.competitorListings.map((c) => c.competitorName)).filter(Boolean))],
    statuses: [...new Set(rows.map((r) => r.pricingStatus))],
    workflows: [...new Set(rows.map((r) => r.actionWorkflowStatus))]
  };
}

function isTrustworthyListing(listing: CompetitorListing): boolean {
  return listing.lastCheckStatus === "success"
    && listing.suspiciousChangeFlag !== true
    && listing.extractionMetadata?.trust_rejected !== true
    && listing.competitorCurrentPrice !== null
    && listing.competitorCurrentPrice > 0;
}

function lowestTrustedCompetitor(row: TrackedProductRow): TrustedCompetitor | null {
  const valid = row.competitorListings.filter(isTrustworthyListing);
  const lowest = valid.sort((a, b) => (a.competitorCurrentPrice ?? Number.MAX_SAFE_INTEGER) - (b.competitorCurrentPrice ?? Number.MAX_SAFE_INTEGER))[0];
  if (!lowest || lowest.competitorCurrentPrice === null) return null;
  return {
    competitorName: lowest.competitorName,
    price: lowest.competitorCurrentPrice,
    listingId: lowest.id,
    stockStatus: lowest.competitorStockStatus,
    productUrl: lowest.competitorProductUrl
  };
}

export function rowCommercialSignals(row: TrackedProductRow, runtime?: RuntimeSettingsInput): CommercialSignals {
  const now = Date.now();
  const checkedTs = new Date(row.lastCheckedAt).getTime();
  const staleMs = staleHours(runtime) * 3600_000;
  const stale = Number.isFinite(checkedTs) ? now - checkedTs > staleMs : true;
  const missingMapping = row.competitorListings.length === 0
    || row.competitorListings.every((listing) => !listing.competitorProductUrl);
  const failedCheck = row.lastCheckStatus === "failed" || row.competitorListings.some((listing) => listing.lastCheckStatus === "failed");
  const suspicious = row.suspiciousChangeFlag || row.competitorListings.some((listing) => listing.lastCheckStatus === "suspicious" || listing.suspiciousChangeFlag);
  const promoDiscrepancy = row.pricingStatus === "Promo discrepancy"
    || row.competitorListings.some((listing) => listing.pricingStatus === "Promo discrepancy");
  const lowestTrusted = lowestTrustedCompetitor(row);
  const missingValidCompetitorPrice = !lowestTrusted;
  const checkedToday = Number.isFinite(checkedTs)
    ? new Date(checkedTs).toDateString() === new Date().toDateString()
    : false;
  const gapGbp = lowestTrusted ? Number((row.bentsRetailPrice - lowestTrusted.price).toFixed(2)) : 0;
  const gapPercent = lowestTrusted && lowestTrusted.price > 0
    ? Number((((row.bentsRetailPrice - lowestTrusted.price) / lowestTrusted.price) * 100).toFixed(2))
    : 0;
  const bentsNotCheapest = !!lowestTrusted && row.bentsRetailPrice > lowestTrusted.price;

  return {
    stale,
    missingMapping,
    failedCheck,
    suspicious,
    promoDiscrepancy,
    missingValidCompetitorPrice,
    checkedToday,
    bentsNotCheapest,
    lowestTrusted,
    gapGbp,
    gapPercent
  };
}

export function exceptionReason(row: TrackedProductRow, runtime?: RuntimeSettingsInput): string {
  const s = rowCommercialSignals(row, runtime);
  if (s.missingMapping) return "Missing competitor mapping";
  if (s.failedCheck) return "Failed check";
  if (s.stale) return `Stale check (${staleHours(runtime)}h+)`;
  if (s.suspicious) return "Suspicious extraction";
  if (s.promoDiscrepancy) return "Promo discrepancy";
  if (s.missingValidCompetitorPrice) return "Missing valid competitor price";
  if (s.bentsNotCheapest) return "Bents not cheapest";
  return "Review required";
}

const workflowWeight: Record<WorkflowStatus, number> = {
  Open: 20,
  Monitoring: 8,
  Reviewed: -5,
  "No Action": -10,
  Closed: -30,
  "In Review": 10,
  "Awaiting Supplier": 5,
  Resolved: -30
};

export function priorityScore(row: TrackedProductRow, runtime?: RuntimeSettingsInput): number {
  const s = rowCommercialSignals(row, runtime);
  let score = 0;
  if (s.missingMapping) score += 90;
  if (s.failedCheck) score += 80;
  if (s.suspicious) score += 70;
  if (s.promoDiscrepancy) score += 60;
  if (s.stale) score += 50;
  if (s.missingValidCompetitorPrice) score += 45;
  if (s.bentsNotCheapest) score += Math.min(40, Math.max(0, s.gapGbp * 2 + s.gapPercent / 3));
  score += workflowWeight[row.actionWorkflowStatus] ?? 0;
  return Number(score.toFixed(2));
}

function topReason(row: TrackedProductRow, runtime?: RuntimeSettingsInput): string {
  const s = rowCommercialSignals(row, runtime);
  if (s.missingMapping) return "Missing competitor mapping";
  if (s.failedCheck) return "Failed check";
  if (s.suspicious) return "Suspicious extraction";
  if (s.promoDiscrepancy) return "Promo discrepancy";
  if (s.bentsNotCheapest && s.lowestTrusted) {
    return `Bents +£${s.gapGbp.toFixed(2)} (${s.gapPercent.toFixed(1)}%) vs ${s.lowestTrusted.competitorName}`;
  }
  if (s.missingValidCompetitorPrice) return "Missing valid competitor price";
  if (s.stale) return `Stale check (${staleHours(runtime)}h+)`;
  return "Needs commercial review";
}

export function prioritisedReviewQueue(rows: TrackedProductRow[], runtime?: RuntimeSettingsInput): QueueItem[] {
  return rows
    .map((row) => {
      const signals = rowCommercialSignals(row, runtime);
      return {
        row,
        reason: topReason(row, runtime),
        score: priorityScore(row, runtime),
        gapGbp: signals.gapGbp,
        gapPercent: signals.gapPercent,
        lowestTrusted: signals.lowestTrusted
      };
    })
    .filter((entry) => entry.reason !== "Needs commercial review")
    .sort((a, b) => b.score - a.score || b.gapGbp - a.gapGbp || b.gapPercent - a.gapPercent);
}

export function exceptionQueue(rows: TrackedProductRow[], runtime?: RuntimeSettingsInput) {
  return rows.filter((r) => exceptionReason(r, runtime) !== "Review required");
}

export function dashboardStats(rows: TrackedProductRow[], runtime?: RuntimeSettingsInput) {
  const signals = rows.map((row) => rowCommercialSignals(row, runtime));
  return {
    total: rows.length,
    checkedToday: signals.filter((s) => s.checkedToday).length,
    bentsNotCheapest: signals.filter((s) => s.bentsNotCheapest).length,
    promoDiscrepancy: signals.filter((s) => s.promoDiscrepancy).length,
    suspicious: signals.filter((s) => s.suspicious).length,
    stale: signals.filter((s) => s.stale).length,
    missingMapping: signals.filter((s) => s.missingMapping).length,
    missingValidCompetitorPrice: signals.filter((s) => s.missingValidCompetitorPrice).length
  };
}

export function largestPriceGaps(rows: TrackedProductRow[], sortBy: "gbp" | "percent" = "gbp", runtime?: RuntimeSettingsInput): QueueItem[] {
  const enriched = rows
    .map((row) => {
      const signals = rowCommercialSignals(row, runtime);
      return {
        row,
        reason: topReason(row, runtime),
        score: priorityScore(row, runtime),
        gapGbp: signals.gapGbp,
        gapPercent: signals.gapPercent,
        lowestTrusted: signals.lowestTrusted
      };
    })
    .filter((entry) => entry.lowestTrusted && entry.gapGbp > 0);

  return enriched.sort((a, b) => {
    if (sortBy === "percent") {
      return b.gapPercent - a.gapPercent || b.gapGbp - a.gapGbp;
    }
    return b.gapGbp - a.gapGbp || b.gapPercent - a.gapPercent;
  });
}

export function exceptionBreakdown(rows: TrackedProductRow[], runtime?: RuntimeSettingsInput) {
  const signals = rows.map((row) => rowCommercialSignals(row, runtime));
  return {
    bentsHigher: signals.filter((s) => s.bentsNotCheapest).length,
    promoDiscrepancy: signals.filter((s) => s.promoDiscrepancy).length,
    suspicious: signals.filter((s) => s.suspicious).length,
    failed: rows.filter((row) => row.lastCheckStatus === "failed" || row.competitorListings.some((c) => c.lastCheckStatus === "failed")).length,
    missingMapping: signals.filter((s) => s.missingMapping).length,
    missingValidCompetitorPrice: signals.filter((s) => s.missingValidCompetitorPrice).length,
    stale: signals.filter((s) => s.stale).length
  };
}

export function staleThresholdHours(runtime?: RuntimeSettingsInput) {
  return staleHours(runtime);
}
