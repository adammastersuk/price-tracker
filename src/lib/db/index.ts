import { CheckStatus, CompetitorListing, PricingStatus, TrackedProductRow, WorkflowStatus } from "@/types/pricing";
import { supabaseRequest } from "@/lib/db/client";

interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  department: string | null;
  buyer: string | null;
  supplier: string | null;
  cost_price: number | null;
  bents_price: number;
  margin_percent: number | null;
  product_url: string | null;
  created_at: string;
  updated_at: string;
  competitor_prices?: CompetitorPriceRecord[];
  product_notes?: ProductNoteRecord[];
  price_history?: PriceHistoryRecord[];
}

interface CompetitorPriceRecord {
  id: string;
  product_id: string;
  competitor_name: string;
  competitor_url: string | null;
  competitor_current_price: number | null;
  competitor_promo_price: number | null;
  competitor_was_price: number | null;
  competitor_stock_status: string | null;
  last_checked_at: string;
  price_difference_gbp: number | null;
  price_difference_percent: number | null;
  pricing_status: string | null;
  last_check_status: string | null;
  check_error_message: string | null;
  raw_price_text: string | null;
  extraction_source: string | null;
  suspicious_change_flag: boolean | null;
}

interface ProductNoteRecord { id: string; note: string; owner: string | null; workflow_status: string | null; created_at: string; }
interface PriceHistoryRecord { id: string; competitor_name: string; price: number | null; checked_at: string; }

export interface ProductInput {
  sku: string;
  name: string;
  brand?: string;
  department?: string;
  buyer?: string;
  supplier?: string;
  cost_price?: number;
  bents_price: number;
  margin_percent?: number;
  product_url?: string;
}

export interface CompetitorPriceInput {
  product_id: string;
  competitor_name: string;
  competitor_url?: string;
  competitor_current_price?: number | null;
  competitor_promo_price?: number | null;
  competitor_was_price?: number | null;
  competitor_stock_status?: string;
  last_checked_at?: string;
  price_difference_gbp?: number | null;
  price_difference_percent?: number | null;
  pricing_status?: string;
  last_check_status?: CheckStatus;
  check_error_message?: string;
  raw_price_text?: string;
  extraction_source?: string;
  suspicious_change_flag?: boolean;
}

const productSelect = "*,competitor_prices(*),product_notes(*),price_history(*)";

function mapToTrackedProductRow(product: ProductRecord): TrackedProductRow {
  const sortedComps = [...(product.competitor_prices ?? [])].sort((a, b) =>
    new Date(b.last_checked_at).getTime() - new Date(a.last_checked_at).getTime()
  );
  const latestComp = sortedComps[0];
  const latestNote = [...(product.product_notes ?? [])].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0];

  const competitorListings: CompetitorListing[] = sortedComps.map((comp) => ({
    id: comp.id,
    competitorName: comp.competitor_name,
    competitorProductUrl: comp.competitor_url ?? "",
    competitorCurrentPrice: comp.competitor_current_price ?? null,
    competitorPromoPrice: comp.competitor_promo_price ?? null,
    competitorWasPrice: comp.competitor_was_price ?? null,
    competitorStockStatus: (comp.competitor_stock_status as CompetitorListing["competitorStockStatus"]) ?? "Unknown",
    lastCheckedAt: comp.last_checked_at,
    lastCheckStatus: (comp.last_check_status as CheckStatus) ?? "pending",
    checkErrorMessage: comp.check_error_message ?? "",
    rawPriceText: comp.raw_price_text ?? "",
    extractionSource: comp.extraction_source ?? "",
    suspiciousChangeFlag: comp.suspicious_change_flag ?? false,
    priceDifferenceGbp: comp.price_difference_gbp ?? null,
    priceDifferencePercent: comp.price_difference_percent ?? null,
    pricingStatus: (comp.pricing_status as PricingStatus) ?? "Needs review"
  }));

  const competitorCount = competitorListings.length;
  const additionalCompetitorCount = Math.max(competitorCount - 1, 0);
  const competitorSummaryLabel = latestComp
    ? additionalCompetitorCount > 0
      ? `${latestComp.competitor_name} +${additionalCompetitorCount} more`
      : latestComp.competitor_name
    : "No competitor mapping";

  const computedMargin = product.cost_price === null || product.bents_price <= 0
    ? null
    : Number((((product.bents_price - product.cost_price) / product.bents_price) * 100).toFixed(2));

  return {
    id: product.id,
    internalSku: product.sku,
    productName: product.name,
    brand: product.brand ?? "Unknown",
    department: product.department ?? "Unassigned",
    buyer: product.buyer ?? "Unassigned",
    supplier: product.supplier ?? "Unknown",
    costPrice: product.cost_price === null ? null : Number(product.cost_price),
    bentsRetailPrice: Number(product.bents_price ?? 0),
    marginPercent: product.margin_percent === null ? computedMargin : Number(product.margin_percent),
    bentsProductUrl: product.product_url ?? "",
    competitorName: latestComp?.competitor_name ?? "No competitor",
    competitorProductUrl: latestComp?.competitor_url ?? "",
    competitorCurrentPrice: latestComp?.competitor_current_price ?? null,
    competitorPromoPrice: latestComp?.competitor_promo_price ?? null,
    competitorWasPrice: latestComp?.competitor_was_price ?? null,
    competitorStockStatus: (latestComp?.competitor_stock_status as TrackedProductRow["competitorStockStatus"]) ?? "Unknown",
    lastCheckedAt: latestComp?.last_checked_at ?? product.updated_at,
    lastCheckStatus: (latestComp?.last_check_status as CheckStatus) ?? "pending",
    checkErrorMessage: latestComp?.check_error_message ?? "",
    rawPriceText: latestComp?.raw_price_text ?? "",
    extractionSource: latestComp?.extraction_source ?? "",
    suspiciousChangeFlag: latestComp?.suspicious_change_flag ?? false,
    priceDifferenceGbp: latestComp?.price_difference_gbp ?? null,
    priceDifferencePercent: latestComp?.price_difference_percent ?? null,
    pricingStatus: (latestComp?.pricing_status as PricingStatus) ?? "Needs review",
    competitorCount,
    additionalCompetitorCount,
    competitorSummaryLabel,
    competitorListings,
    matchConfidence: "Needs review",
    reviewStatus: "Needs review",
    internalNote: latestNote?.note ?? "",
    actionOwner: latestNote?.owner ?? "Unassigned",
    actionWorkflowStatus: (latestNote?.workflow_status as WorkflowStatus) ?? "Open",
    noteHistory: (product.product_notes ?? []).map((n) => ({
      id: n.id,
      author: n.owner ?? "Unknown",
      message: n.note,
      createdAt: n.created_at
    })),
    history: (product.price_history ?? []).map((h) => ({
      checkedAt: h.checked_at,
      bentsPrice: Number(product.bents_price ?? 0),
      competitorPrice: h.price
    }))
  };
}

export async function getProducts(): Promise<TrackedProductRow[]> {
  const query = new URLSearchParams({ select: productSelect, order: "updated_at.desc" });
  const rows = await supabaseRequest<ProductRecord[]>({ table: "products", query });
  return rows.map(mapToTrackedProductRow);
}

export async function getProductById(productId: string): Promise<TrackedProductRow | null> {
  const query = new URLSearchParams({ select: productSelect, id: `eq.${productId}`, limit: "1" });
  const rows = await supabaseRequest<ProductRecord[]>({ table: "products", query });
  return rows[0] ? mapToTrackedProductRow(rows[0]) : null;
}

export async function createProduct(input: ProductInput): Promise<ProductRecord[]> {
  return supabaseRequest<ProductRecord[]>({
    table: "products",
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: input
  });
}

export async function upsertProductBySku(input: ProductInput): Promise<ProductRecord[]> {
  return supabaseRequest<ProductRecord[]>({
    table: "products",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "sku" }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: input
  });
}

export async function updateProduct(id: string, updates: Partial<ProductInput>): Promise<ProductRecord[]> {
  const query = new URLSearchParams({ id: `eq.${id}` });
  return supabaseRequest<ProductRecord[]>({
    table: "products",
    method: "PATCH",
    query,
    headers: { Prefer: "return=representation" },
    body: updates
  });
}

export async function getCompetitorPrices(productId: string): Promise<CompetitorPriceRecord[]> {
  const query = new URLSearchParams({ select: "*", product_id: `eq.${productId}`, order: "last_checked_at.desc" });
  return supabaseRequest<CompetitorPriceRecord[]>({ table: "competitor_prices", query });
}

export async function insertCompetitorPrice(input: CompetitorPriceInput): Promise<CompetitorPriceRecord[]> {
  return supabaseRequest<CompetitorPriceRecord[]>({
    table: "competitor_prices",
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: input
  });
}

export async function upsertCompetitorPrice(input: CompetitorPriceInput): Promise<CompetitorPriceRecord[]> {
  return supabaseRequest<CompetitorPriceRecord[]>({
    table: "competitor_prices",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "product_id,competitor_name,competitor_url" }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: input
  });
}


export async function updateCompetitorPrice(id: string, updates: Partial<CompetitorPriceInput>): Promise<CompetitorPriceRecord[]> {
  const query = new URLSearchParams({ id: `eq.${id}` });
  return supabaseRequest<CompetitorPriceRecord[]>({
    table: "competitor_prices",
    method: "PATCH",
    query,
    headers: { Prefer: "return=representation" },
    body: updates
  });
}

export async function addProductNote(input: { product_id: string; note: string; owner?: string; workflow_status?: string; }): Promise<ProductNoteRecord[]> {
  return supabaseRequest<ProductNoteRecord[]>({
    table: "product_notes",
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: input
  });
}

export async function insertPriceHistory(input: { product_id: string; competitor_name: string; price?: number | null; checked_at?: string; }): Promise<PriceHistoryRecord[]> {
  return supabaseRequest<PriceHistoryRecord[]>({ table: "price_history", method: "POST", headers: { Prefer: "return=representation" }, body: input });
}
