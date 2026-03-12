import { CheckStatus, CompetitorListing, PricingStatus, TrackedProductRow, WorkflowStatus } from "@/types/pricing";
import { supabaseRequest } from "@/lib/db/client";
import { toNullablePlainObject, toPlainObject } from "@/lib/json";

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
  extraction_metadata: Record<string, unknown> | null;
}

interface ProductNoteRecord { id: string; note: string; owner: string | null; workflow_status: string | null; created_at: string; }
interface PriceHistoryRecord {
  id: string;
  competitor_name: string;
  competitor_url?: string | null;
  competitor_price_id?: string | null;
  price: number | null;
  current_price?: number | null;
  promo_price?: number | null;
  was_price?: number | null;
  checked_at: string;
  captured_at?: string | null;
  last_check_status?: string | null;
  suspicious_change_flag?: boolean | null;
  extraction_source?: string | null;
  extraction_metadata?: Record<string, unknown> | null;
}

interface BuyerRecord { id: string; name: string; is_active: boolean; created_at: string; updated_at: string; }
interface DepartmentRecord { id: string; name: string; created_at: string; updated_at: string; }
interface BuyerDepartmentRecord { id: string; buyer_id: string; department_id: string; created_at: string; }
interface CompetitorRecord {
  id: string;
  name: string;
  base_url: string;
  domain: string;
  adapter_key: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}
interface AppSettingRecord { key: string; value: Record<string, unknown>; updated_at: string; }

export interface BuyerConfig {
  id: string;
  name: string;
  isActive: boolean;
  departments: string[];
  usedByProducts: number;
}

export interface DepartmentConfig {
  id: string;
  name: string;
  buyers: string[];
  usedByProducts: number;
}

export interface CompetitorConfig {
  id: string;
  name: string;
  baseUrl: string;
  domain: string;
  adapterKey: string;
  isEnabled: boolean;
  usedByProducts: number;
}

export interface RuntimeSettings {
  scrapeDefaults: {
    staleCheckHours: number;
    batchSize: number;
    defaultRefreshFrequencyHours: number;
  };
  toleranceSettings: {
    inLinePricingTolerancePercent: number;
    suspiciousLowPriceThresholdPercent: number;
    suspiciousHighPriceThresholdPercent: number;
  };
}


interface MergeProductsSummary {
  sourceProductId: string;
  targetProductId: string;
  movedCompetitorCount: number;
  skippedDuplicateCompetitorCount: number;
  movedNotesCount: number;
  movedHistoryCount: number;
  sourceDeleted: boolean;
}

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
  extraction_metadata?: Record<string, unknown>;
}

const defaultRuntimeSettings: RuntimeSettings = {
  scrapeDefaults: {
    staleCheckHours: Number.parseFloat(process.env.NEXT_PUBLIC_STALE_CHECK_HOURS ?? "24") || 24,
    batchSize: 50,
    defaultRefreshFrequencyHours: 24
  },
  toleranceSettings: {
    inLinePricingTolerancePercent: Number.parseFloat(process.env.DEFAULT_PRICE_TOLERANCE ?? "3") || 3,
    suspiciousLowPriceThresholdPercent: 35,
    suspiciousHighPriceThresholdPercent: 80
  }
};

const productSelect = "*,competitor_prices(*),product_notes(*),price_history(*)";

function isTrustworthyListing(comp: CompetitorListing): boolean {
  if (comp.lastCheckStatus !== "success") return false;
  if (comp.competitorCurrentPrice === null || !Number.isFinite(comp.competitorCurrentPrice) || comp.competitorCurrentPrice <= 0) return false;
  if ((comp.extractionMetadata?.trust_rejected as boolean | undefined) === true) return false;
  return true;
}

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
    extractionMetadata: toPlainObject(comp.extraction_metadata, {}),
    priceDifferenceGbp: comp.price_difference_gbp ?? null,
    priceDifferencePercent: comp.price_difference_percent ?? null,
    pricingStatus: (comp.pricing_status as PricingStatus) ?? "Needs review"
  }));

  const validListings = competitorListings.filter(isTrustworthyListing);
  const lowestValidListing = [...validListings].sort((a, b) =>
    (a.competitorCurrentPrice ?? Number.POSITIVE_INFINITY) - (b.competitorCurrentPrice ?? Number.POSITIVE_INFINITY)
  )[0] ?? null;
  const fallbackListing = competitorListings[0] ?? null;
  const summaryListing = lowestValidListing ?? fallbackListing;

  const competitorCount = competitorListings.length;
  const additionalCompetitorCount = Math.max(competitorCount - 1, 0);
  const competitorSummaryLabel = summaryListing
    ? additionalCompetitorCount > 0
      ? `${summaryListing.competitorName} +${additionalCompetitorCount} more`
      : summaryListing.competitorName
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
    competitorName: summaryListing?.competitorName ?? "No competitor",
    competitorProductUrl: summaryListing?.competitorProductUrl ?? "",
    competitorCurrentPrice: summaryListing?.competitorCurrentPrice ?? null,
    competitorPromoPrice: summaryListing?.competitorPromoPrice ?? null,
    competitorWasPrice: summaryListing?.competitorWasPrice ?? null,
    competitorStockStatus: summaryListing?.competitorStockStatus ?? "Unknown",
    lastCheckedAt: summaryListing?.lastCheckedAt ?? product.updated_at,
    lastCheckStatus: summaryListing?.lastCheckStatus ?? "pending",
    checkErrorMessage: summaryListing?.checkErrorMessage ?? "",
    rawPriceText: summaryListing?.rawPriceText ?? "",
    extractionSource: summaryListing?.extractionSource ?? "",
    suspiciousChangeFlag: summaryListing?.suspiciousChangeFlag ?? false,
    priceDifferenceGbp: summaryListing?.priceDifferenceGbp ?? null,
    priceDifferencePercent: summaryListing?.priceDifferencePercent ?? null,
    pricingStatus: summaryListing?.pricingStatus ?? "Needs review",
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
      checkedAt: h.captured_at ?? h.checked_at,
      bentsPrice: Number(product.bents_price ?? 0),
      competitorPrice: h.current_price ?? h.price
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
    body: { ...input, extraction_metadata: toNullablePlainObject(input.extraction_metadata) }
  });
}

export async function upsertCompetitorPrice(input: CompetitorPriceInput): Promise<CompetitorPriceRecord[]> {
  return supabaseRequest<CompetitorPriceRecord[]>({
    table: "competitor_prices",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "product_id,competitor_name,competitor_url" }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { ...input, extraction_metadata: toNullablePlainObject(input.extraction_metadata) }
  });
}


export async function updateCompetitorPrice(id: string, updates: Partial<CompetitorPriceInput>): Promise<CompetitorPriceRecord[]> {
  const query = new URLSearchParams({ id: `eq.${id}` });
  return supabaseRequest<CompetitorPriceRecord[]>({
    table: "competitor_prices",
    method: "PATCH",
    query,
    headers: { Prefer: "return=representation" },
    body: { ...updates, extraction_metadata: toNullablePlainObject(updates.extraction_metadata) }
  });
}

export async function deleteCompetitorPrice(id: string): Promise<void> {
  const query = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest<unknown[]>({
    table: "competitor_prices",
    method: "DELETE",
    query
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

export async function addProductNotesBulk(inputs: Array<{ product_id: string; note: string; owner?: string; workflow_status?: string; }>): Promise<ProductNoteRecord[]> {
  if (!inputs.length) return [];
  return supabaseRequest<ProductNoteRecord[]>({
    table: "product_notes",
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: inputs
  });
}

export async function insertPriceHistory(input: {
  product_id: string;
  competitor_name: string;
  competitor_url?: string;
  competitor_price_id?: string;
  price?: number | null;
  current_price?: number | null;
  promo_price?: number | null;
  was_price?: number | null;
  checked_at?: string;
  captured_at?: string;
  last_check_status?: CheckStatus;
  suspicious_change_flag?: boolean;
  extraction_source?: string;
  extraction_metadata?: Record<string, unknown>;
}): Promise<PriceHistoryRecord[]> {
  return supabaseRequest<PriceHistoryRecord[]>({
    table: "price_history",
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { ...input, extraction_metadata: toNullablePlainObject(input.extraction_metadata) }
  });
}

export async function findProductBySku(sku: string): Promise<ProductRecord | null> {
  const query = new URLSearchParams({ select: "*", sku: `eq.${sku}`, limit: "1" });
  const rows = await supabaseRequest<ProductRecord[]>({ table: "products", query });
  return rows[0] ?? null;
}

export async function deleteProduct(id: string): Promise<void> {
  const query = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest<unknown[]>({
    table: "products",
    method: "DELETE",
    query
  });
}

export async function mergeProducts(sourceProductId: string, targetProductId: string): Promise<MergeProductsSummary> {
  const sourceCompetitors = await getCompetitorPrices(sourceProductId);
  const targetCompetitors = await getCompetitorPrices(targetProductId);

  const targetCompetitorKeys = new Set(
    targetCompetitors.map((row) => `${row.competitor_name.toLowerCase()}::${(row.competitor_url ?? "").toLowerCase()}`)
  );

  let movedCompetitorCount = 0;
  let skippedDuplicateCompetitorCount = 0;

  for (const sourceRow of sourceCompetitors) {
    const key = `${sourceRow.competitor_name.toLowerCase()}::${(sourceRow.competitor_url ?? "").toLowerCase()}`;
    if (targetCompetitorKeys.has(key)) {
      skippedDuplicateCompetitorCount += 1;
      continue;
    }

    await updateCompetitorPrice(sourceRow.id, { product_id: targetProductId });
    targetCompetitorKeys.add(key);
    movedCompetitorCount += 1;
  }

  const notesToMove = await supabaseRequest<ProductNoteRecord[]>({
    table: "product_notes",
    query: new URLSearchParams({ select: "*", product_id: `eq.${sourceProductId}` })
  });
  for (const note of notesToMove) {
    await supabaseRequest<ProductNoteRecord[]>({
      table: "product_notes",
      method: "PATCH",
      query: new URLSearchParams({ id: `eq.${note.id}` }),
      headers: { Prefer: "return=representation" },
      body: { product_id: targetProductId }
    });
  }

  const historyToMove = await supabaseRequest<PriceHistoryRecord[]>({
    table: "price_history",
    query: new URLSearchParams({ select: "*", product_id: `eq.${sourceProductId}` })
  });
  for (const historyRow of historyToMove) {
    await supabaseRequest<PriceHistoryRecord[]>({
      table: "price_history",
      method: "PATCH",
      query: new URLSearchParams({ id: `eq.${historyRow.id}` }),
      headers: { Prefer: "return=representation" },
      body: { product_id: targetProductId }
    });
  }

  const remainingCompetitors = await getCompetitorPrices(sourceProductId);
  let sourceDeleted = false;
  if (!remainingCompetitors.length) {
    await deleteProduct(sourceProductId);
    sourceDeleted = true;
  }

  return {
    sourceProductId,
    targetProductId,
    movedCompetitorCount,
    skippedDuplicateCompetitorCount,
    movedNotesCount: notesToMove.length,
    movedHistoryCount: historyToMove.length,
    sourceDeleted
  };
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const rows = await supabaseRequest<AppSettingRecord[]>({ table: "app_settings", query: new URLSearchParams({ select: "*" }) });
  const map = new Map(rows.map((row) => [row.key, toPlainObject(row.value, {})]));
  const scrape = map.get("scrape_defaults") as RuntimeSettings["scrapeDefaults"] | undefined;
  const tolerance = map.get("tolerance_settings") as RuntimeSettings["toleranceSettings"] | undefined;

  return {
    scrapeDefaults: {
      staleCheckHours: Number(scrape?.staleCheckHours ?? defaultRuntimeSettings.scrapeDefaults.staleCheckHours),
      batchSize: Number(scrape?.batchSize ?? defaultRuntimeSettings.scrapeDefaults.batchSize),
      defaultRefreshFrequencyHours: Number(scrape?.defaultRefreshFrequencyHours ?? defaultRuntimeSettings.scrapeDefaults.defaultRefreshFrequencyHours)
    },
    toleranceSettings: {
      inLinePricingTolerancePercent: Number(tolerance?.inLinePricingTolerancePercent ?? defaultRuntimeSettings.toleranceSettings.inLinePricingTolerancePercent),
      suspiciousLowPriceThresholdPercent: Number(tolerance?.suspiciousLowPriceThresholdPercent ?? defaultRuntimeSettings.toleranceSettings.suspiciousLowPriceThresholdPercent),
      suspiciousHighPriceThresholdPercent: Number(tolerance?.suspiciousHighPriceThresholdPercent ?? defaultRuntimeSettings.toleranceSettings.suspiciousHighPriceThresholdPercent)
    }
  };
}

export async function updateAppSetting(key: string, value: Record<string, unknown>) {
  return supabaseRequest<AppSettingRecord[]>({
    table: "app_settings",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "key" }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { key, value: toPlainObject(value, {}) }
  });
}

export async function getSettingsConfig() {
  const [buyers, departments, mappings, competitors, runtimeSettings, products, competitorPrices] = await Promise.all([
    supabaseRequest<BuyerRecord[]>({ table: "buyers", query: new URLSearchParams({ select: "*", order: "name.asc" }) }),
    supabaseRequest<DepartmentRecord[]>({ table: "departments", query: new URLSearchParams({ select: "*", order: "name.asc" }) }),
    supabaseRequest<BuyerDepartmentRecord[]>({ table: "buyer_departments", query: new URLSearchParams({ select: "*" }) }),
    supabaseRequest<CompetitorRecord[]>({ table: "competitors", query: new URLSearchParams({ select: "*", order: "name.asc" }) }),
    getRuntimeSettings(),
    supabaseRequest<Array<{ buyer: string | null; department: string | null }>>({ table: "products", query: new URLSearchParams({ select: "buyer,department" }) }),
    supabaseRequest<Array<{ competitor_name: string | null }>>({ table: "competitor_prices", query: new URLSearchParams({ select: "competitor_name" }) })
  ]);

  const departmentsById = new Map(departments.map((d) => [d.id, d.name]));
  const buyersById = new Map(buyers.map((b) => [b.id, b.name]));
  const deptsByBuyer = mappings.reduce<Record<string, string[]>>((acc, mapping) => {
    acc[mapping.buyer_id] = acc[mapping.buyer_id] ?? [];
    const deptName = departmentsById.get(mapping.department_id);
    if (deptName) acc[mapping.buyer_id].push(deptName);
    return acc;
  }, {});

  const buyerUsage = products.reduce<Record<string, number>>((acc, row) => {
    const key = row.buyer?.trim();
    if (key) acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const departmentUsage = products.reduce<Record<string, number>>((acc, row) => {
    const key = row.department?.trim();
    if (key) acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const competitorUsage = competitorPrices.reduce<Record<string, number>>((acc, row) => {
    const key = row.competitor_name?.trim();
    if (key) acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const buyersByDept = mappings.reduce<Record<string, string[]>>((acc, mapping) => {
    acc[mapping.department_id] = acc[mapping.department_id] ?? [];
    const buyerName = buyersById.get(mapping.buyer_id);
    if (buyerName) acc[mapping.department_id].push(buyerName);
    return acc;
  }, {});

  return {
    buyers: buyers.map((buyer) => ({
      id: buyer.id,
      name: buyer.name,
      isActive: buyer.is_active,
      departments: (deptsByBuyer[buyer.id] ?? []).sort((a, b) => a.localeCompare(b)),
      usedByProducts: buyerUsage[buyer.name] ?? 0
    } as BuyerConfig)),
    departments: departments.map((department) => ({
      id: department.id,
      name: department.name,
      buyers: (buyersByDept[department.id] ?? []).sort((a, b) => a.localeCompare(b)),
      usedByProducts: departmentUsage[department.name] ?? 0
    } as DepartmentConfig)),
    competitors: competitors.map((row) => ({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      domain: row.domain,
      adapterKey: row.adapter_key,
      isEnabled: row.is_enabled,
      usedByProducts: competitorUsage[row.name] ?? 0
    } as CompetitorConfig)),
    runtimeSettings
  };
}

export async function createBuyer(name: string, isActive = true) {
  return supabaseRequest<BuyerRecord[]>({ table: "buyers", method: "POST", headers: { Prefer: "return=representation" }, body: { name, is_active: isActive } });
}

export async function updateBuyer(id: string, updates: { name?: string; is_active?: boolean; department_ids?: string[]; }) {
  const buyer = await supabaseRequest<BuyerRecord[]>({ table: "buyers", query: new URLSearchParams({ select: "*", id: `eq.${id}`, limit: "1" }) });
  if (!buyer[0]) throw new Error("Buyer not found");
  const { department_ids, ...buyerUpdates } = updates;
  if (Object.keys(buyerUpdates).length) {
    await supabaseRequest<BuyerRecord[]>({ table: "buyers", method: "PATCH", query: new URLSearchParams({ id: `eq.${id}` }), headers: { Prefer: "return=representation" }, body: buyerUpdates });
  }
  if (department_ids) {
    await supabaseRequest<unknown[]>({ table: "buyer_departments", method: "DELETE", query: new URLSearchParams({ buyer_id: `eq.${id}` }) });
    if (department_ids.length) {
      await supabaseRequest<BuyerDepartmentRecord[]>({ table: "buyer_departments", method: "POST", body: department_ids.map((departmentId) => ({ buyer_id: id, department_id: departmentId })) });
    }
  }
}

export async function deleteBuyerSafe(id: string) {
  const buyerRows = await supabaseRequest<BuyerRecord[]>({ table: "buyers", query: new URLSearchParams({ select: "name", id: `eq.${id}`, limit: "1" }) });
  const buyer = buyerRows[0];
  if (!buyer) throw new Error("Buyer not found");
  const linkedProducts = await supabaseRequest<Array<{ id: string }>>({ table: "products", query: new URLSearchParams({ select: "id", buyer: `eq.${buyer.name}` }) });
  if (linkedProducts.length) {
    throw new Error(`Cannot delete buyer \"${buyer.name}\" because it is used by ${linkedProducts.length} product${linkedProducts.length === 1 ? "" : "s"}. Reassign those products first.`);
  }
  await supabaseRequest<unknown[]>({ table: "buyers", method: "DELETE", query: new URLSearchParams({ id: `eq.${id}` }) });
}

export async function createDepartment(name: string) {
  return supabaseRequest<DepartmentRecord[]>({ table: "departments", method: "POST", headers: { Prefer: "return=representation" }, body: { name } });
}

export async function updateDepartment(id: string, updates: { name?: string }) {
  await supabaseRequest<DepartmentRecord[]>({ table: "departments", method: "PATCH", query: new URLSearchParams({ id: `eq.${id}` }), headers: { Prefer: "return=representation" }, body: updates });
}

export async function deleteDepartmentSafe(id: string) {
  const departmentRows = await supabaseRequest<DepartmentRecord[]>({ table: "departments", query: new URLSearchParams({ select: "name", id: `eq.${id}`, limit: "1" }) });
  const department = departmentRows[0];
  if (!department) throw new Error("Department not found");
  const linkedProducts = await supabaseRequest<Array<{ id: string }>>({ table: "products", query: new URLSearchParams({ select: "id", department: `eq.${department.name}` }) });
  if (linkedProducts.length) {
    throw new Error(`Cannot delete department \"${department.name}\" because it is used by ${linkedProducts.length} product${linkedProducts.length === 1 ? "" : "s"}. Reassign those products first.`);
  }
  await supabaseRequest<unknown[]>({ table: "departments", method: "DELETE", query: new URLSearchParams({ id: `eq.${id}` }) });
}

export async function createCompetitor(input: { name: string; base_url: string; domain: string; adapter_key: string; is_enabled: boolean; }) {
  return supabaseRequest<CompetitorRecord[]>({ table: "competitors", method: "POST", headers: { Prefer: "return=representation" }, body: input });
}

export async function updateCompetitor(id: string, updates: Partial<{ name: string; base_url: string; domain: string; adapter_key: string; is_enabled: boolean; }>) {
  return supabaseRequest<CompetitorRecord[]>({ table: "competitors", method: "PATCH", query: new URLSearchParams({ id: `eq.${id}` }), headers: { Prefer: "return=representation" }, body: updates });
}

export async function deleteCompetitorSafe(id: string) {
  const rows = await supabaseRequest<CompetitorRecord[]>({ table: "competitors", query: new URLSearchParams({ select: "name", id: `eq.${id}`, limit: "1" }) });
  const competitor = rows[0];
  if (!competitor) throw new Error("Competitor not found");
  const linked = await supabaseRequest<Array<{ id: string }>>({ table: "competitor_prices", query: new URLSearchParams({ select: "id", competitor_name: `eq.${competitor.name}` }) });
  if (linked.length) throw new Error(`Cannot delete competitor \"${competitor.name}\" because it is used by ${linked.length} listing${linked.length === 1 ? "" : "s"}. Reassign those listings first.`);
  await supabaseRequest<unknown[]>({ table: "competitors", method: "DELETE", query: new URLSearchParams({ id: `eq.${id}` }) });
}
