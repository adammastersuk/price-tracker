import { CompetitorListing, TrackedProductRow, WorkflowStatus } from "@/types/pricing";

export interface ProductFilters {
  search: string;
  buyer: string;
  department: string;
  supplier: string;
  brand: string;
  competitor: string;
  status: string;
}

export const defaultFilters: ProductFilters = {
  search: "",
  buyer: "all",
  department: "all",
  supplier: "all",
  brand: "all",
  competitor: "all",
  status: "all"
};

const STALE_HOURS = Number.parseFloat(process.env.NEXT_PUBLIC_STALE_CHECK_HOURS ?? "24") || 24;
const STALE_MS = STALE_HOURS * 3600_000;

export interface TrustedCompetitor {
  competitorName: string;
  price: number;
  listingId: string;
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

export function queryProducts(rows: TrackedProductRow[], filters: ProductFilters): TrackedProductRow[] {
  return rows.filter((r) => {
    const search = filters.search.toLowerCase();
    const matchSearch = !search
      || r.internalSku.toLowerCase().includes(search)
      || r.productName.toLowerCase().includes(search);
    return matchSearch
      && (filters.buyer === "all" || r.buyer === filters.buyer)
      && (filters.department === "all" || r.department === filters.department)
      && (filters.supplier === "all" || r.supplier === filters.supplier)
      && (filters.brand === "all" || r.brand === filters.brand)
      && (filters.competitor === "all" || r.competitorListings.some((c) => c.competitorName === filters.competitor))
      && (filters.status === "all" || r.pricingStatus === filters.status || r.actionWorkflowStatus === filters.status);
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
    listingId: lowest.id
  };
}

export function rowCommercialSignals(row: TrackedProductRow): CommercialSignals {
  const now = Date.now();
  const checkedTs = new Date(row.lastCheckedAt).getTime();
  const stale = Number.isFinite(checkedTs) ? now - checkedTs > STALE_MS : true;
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

export function exceptionReason(row: TrackedProductRow): string {
  const s = rowCommercialSignals(row);
  if (s.missingMapping) return "Missing competitor mapping";
  if (s.failedCheck) return "Failed check";
  if (s.stale) return `Stale check (${STALE_HOURS}h+)`;
  if (s.suspicious) return "Suspicious extraction";
  if (s.promoDiscrepancy) return "Promo discrepancy";
  if (s.missingValidCompetitorPrice) return "Missing valid competitor price";
  if (s.bentsNotCheapest) return "Bents not cheapest";
  return "Review required";
}

const workflowWeight: Record<WorkflowStatus, number> = {
  Open: 20,
  "In Review": 10,
  "Awaiting Supplier": 5,
  Resolved: -30
};

export function priorityScore(row: TrackedProductRow): number {
  const s = rowCommercialSignals(row);
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

function topReason(row: TrackedProductRow): string {
  const s = rowCommercialSignals(row);
  if (s.missingMapping) return "Missing competitor mapping";
  if (s.failedCheck) return "Failed check";
  if (s.suspicious) return "Suspicious extraction";
  if (s.promoDiscrepancy) return "Promo discrepancy";
  if (s.bentsNotCheapest && s.lowestTrusted) {
    return `Bents +£${s.gapGbp.toFixed(2)} (${s.gapPercent.toFixed(1)}%) vs ${s.lowestTrusted.competitorName}`;
  }
  if (s.missingValidCompetitorPrice) return "Missing valid competitor price";
  if (s.stale) return `Stale check (${STALE_HOURS}h+)`;
  return "Needs commercial review";
}

export function prioritisedReviewQueue(rows: TrackedProductRow[]): QueueItem[] {
  return rows
    .map((row) => {
      const signals = rowCommercialSignals(row);
      return {
        row,
        reason: topReason(row),
        score: priorityScore(row),
        gapGbp: signals.gapGbp,
        gapPercent: signals.gapPercent,
        lowestTrusted: signals.lowestTrusted
      };
    })
    .filter((entry) => entry.reason !== "Needs commercial review")
    .sort((a, b) => b.score - a.score || b.gapGbp - a.gapGbp || b.gapPercent - a.gapPercent);
}

export function exceptionQueue(rows: TrackedProductRow[]) {
  return rows.filter((r) => exceptionReason(r) !== "Review required");
}

export function dashboardStats(rows: TrackedProductRow[]) {
  const signals = rows.map((row) => rowCommercialSignals(row));
  return {
    total: rows.length,
    checkedToday: signals.filter((s) => s.checkedToday).length,
    bentsNotCheapest: signals.filter((s) => s.bentsNotCheapest).length,
    promoDiscrepancy: signals.filter((s) => s.promoDiscrepancy).length,
    suspicious: signals.filter((s) => s.suspicious).length,
    stale: signals.filter((s) => s.stale).length,
    missingMapping: signals.filter((s) => s.missingMapping).length,
    missingValidCompetitorPrice: signals.filter((s) => s.missingValidCompetitorPrice).length,
    failedChecks: signals.filter((s) => s.failedCheck).length
  };
}

export function exceptionBreakdown(rows: TrackedProductRow[]) {
  const init = {
    bentsHigher: 0,
    promoDiscrepancy: 0,
    suspicious: 0,
    failed: 0,
    missingMapping: 0,
    missingValidCompetitorPrice: 0,
    stale: 0
  };

  return rows.reduce((acc, row) => {
    const s = rowCommercialSignals(row);
    if (s.bentsNotCheapest) acc.bentsHigher += 1;
    if (s.promoDiscrepancy) acc.promoDiscrepancy += 1;
    if (s.suspicious) acc.suspicious += 1;
    if (s.failedCheck) acc.failed += 1;
    if (s.missingMapping) acc.missingMapping += 1;
    if (s.missingValidCompetitorPrice) acc.missingValidCompetitorPrice += 1;
    if (s.stale) acc.stale += 1;
    return acc;
  }, init);
}

export function largestPriceGaps(rows: TrackedProductRow[], sortBy: "gbp" | "percent" = "gbp"): QueueItem[] {
  return prioritisedReviewQueue(rows)
    .filter((entry) => entry.lowestTrusted && entry.gapGbp > 0)
    .sort((a, b) => sortBy === "gbp"
      ? b.gapGbp - a.gapGbp || b.gapPercent - a.gapPercent
      : b.gapPercent - a.gapPercent || b.gapGbp - a.gapGbp);
}

export function staleThresholdHours() {
  return STALE_HOURS;
}
