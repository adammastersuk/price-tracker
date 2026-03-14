import { CheckStatus } from "@/types/pricing";
import { supabaseRequest } from "@/lib/db/client";
import { toNullablePlainObject, toPlainObject } from "@/lib/json";

export interface ActivityLogInput {
  event_type: string;
  entity_type: string;
  entity_id?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface AlertInput {
  dedupe_key: string;
  product_id?: string;
  competitor_name?: string;
  reason: string;
  gap_amount_gbp?: number;
  context?: Record<string, unknown>;
  status?: "new" | "acknowledged" | "resolved";
}

interface RefreshRunRecord { id: string; }

export async function logActivity(entry: ActivityLogInput) {
  try {
    await supabaseRequest<unknown[]>({
      table: "activity_log",
      method: "POST",
      body: { ...entry, metadata: toNullablePlainObject(entry.metadata) }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to write activity log entry", error);
  }
}

export async function getActivity(limit = 50) {
  return supabaseRequest<Array<ActivityLogInput & { id: string; created_at: string }>>({
    table: "activity_log",
    query: new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) })
  });
}

export async function upsertAlert(input: AlertInput) {
  try {
    return await supabaseRequest<unknown[]>({
      table: "alerts",
      method: "POST",
      query: new URLSearchParams({ on_conflict: "dedupe_key" }),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { ...input, status: input.status ?? "new", context: toNullablePlainObject(input.context), last_seen_at: new Date().toISOString() }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to upsert alert", error);
    return [];
  }
}

export async function getAlerts(limit = 100) {
  return supabaseRequest<Array<AlertInput & { id: string; created_at: string; updated_at: string; last_seen_at: string }>>({
    table: "alerts",
    query: new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) })
  });
}

export async function updateAlertStatus(id: string, status: "new" | "acknowledged" | "resolved") {
  return supabaseRequest<unknown[]>({
    table: "alerts",
    method: "PATCH",
    query: new URLSearchParams({ id: `eq.${id}` }),
    headers: { Prefer: "return=representation" },
    body: { status }
  });
}

export async function createRefreshRun(input: { trigger_source: string; schedule_mode: string; metadata?: Record<string, unknown>; total?: number; processed?: number; succeeded?: number; failed?: number; suspicious?: number; }) {
  try {
    const rows = await supabaseRequest<RefreshRunRecord[]>({
      table: "refresh_runs",
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { ...input, metadata: toNullablePlainObject(input.metadata), started_at: new Date().toISOString() }
    });
    return rows[0]?.id;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to create refresh run record", error);
    return undefined;
  }
}

export async function updateRefreshRun(runId: string, summary: { total?: number; processed?: number; succeeded?: number; failed?: number; suspicious?: number; metadata?: Record<string, unknown> }) {
  try {
    await supabaseRequest<unknown[]>({
      table: "refresh_runs",
      method: "PATCH",
      query: new URLSearchParams({ id: `eq.${runId}` }),
      body: { ...summary, metadata: toNullablePlainObject(summary.metadata) }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to update refresh run ${runId}`, error);
  }
}

export async function completeRefreshRun(runId: string, summary: { total: number; processed: number; succeeded: number; failed: number; suspicious: number; metadata?: Record<string, unknown> }) {
  try {
    await supabaseRequest<unknown[]>({
      table: "refresh_runs",
      method: "PATCH",
      query: new URLSearchParams({ id: `eq.${runId}` }),
      body: { ...summary, completed_at: new Date().toISOString(), metadata: toNullablePlainObject(summary.metadata) }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to complete refresh run ${runId}`, error);
  }
}

export async function logRefreshRunItem(input: {
  id?: string;
  run_id: string;
  product_id: string;
  competitor_price_id?: string;
  competitor_name?: string;
  competitor_url?: string;
  status: CheckStatus | "missing_url" | "queued" | "processing";
  suspicious?: boolean;
  duration_ms?: number;
  error_message?: string;
  extraction_source?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabaseRequest<unknown[]>({
      table: "refresh_run_items",
      method: "POST",
      body: { ...input, metadata: toNullablePlainObject(input.metadata), checked_at: new Date().toISOString() }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to log refresh run item", error);
  }
}

export interface RefreshRunRow {
  id: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  suspicious: number;
}

export interface RefreshRunItemRow {
  id: string;
  run_id: string;
  product_id: string;
  competitor_price_id: string | null;
  competitor_name: string | null;
  competitor_url: string | null;
  status: string;
  suspicious: boolean;
  metadata: Record<string, unknown> | null;
}

export async function getRefreshRun(runId: string) {
  const rows = await supabaseRequest<RefreshRunRow[]>({
    table: "refresh_runs",
    query: new URLSearchParams({ select: "id,total,processed,succeeded,failed,suspicious", id: `eq.${runId}`, limit: "1" })
  });
  return rows[0] ?? null;
}

export async function listQueuedRefreshRunItems(runId: string, limit = 1) {
  const rows = await supabaseRequest<RefreshRunItemRow[]>({
    table: "refresh_run_items",
    query: new URLSearchParams({ select: "id,run_id,product_id,competitor_price_id,competitor_name,competitor_url,status,suspicious,metadata", run_id: `eq.${runId}`, status: "eq.queued", order: "checked_at.asc", limit: String(limit) })
  });
  return rows.map((row) => ({ ...row, metadata: toPlainObject(row.metadata, {}) }));
}

export async function updateRefreshRunItem(id: string, updates: Partial<RefreshRunItemRow> & { checked_at?: string; duration_ms?: number; error_message?: string; extraction_source?: string; metadata?: Record<string, unknown>; competitor_price_id?: string; competitor_name?: string; competitor_url?: string; status?: string; suspicious?: boolean; }) {
  try {
    return await supabaseRequest<unknown[]>({
      table: "refresh_run_items",
      method: "PATCH",
      query: new URLSearchParams({ id: `eq.${id}` }),
      body: { ...updates, metadata: toNullablePlainObject(updates.metadata) }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to update refresh run item ${id}`, error);
    return [];
  }
}

export interface SavedViewState {
  search: string;
  buyers: string[];
  departments: string[];
  suppliers: string[];
  competitors: string[];
  statuses: string[];
  sortKey: string;
  sortDirection: "asc" | "desc";
}

export async function listSavedViews(page = "products") {
  return supabaseRequest<Array<{ id: string; name: string; state: SavedViewState; created_at: string; updated_at: string }>>({
    table: "saved_views",
    query: new URLSearchParams({ select: "id,name,state,created_at,updated_at", page: `eq.${page}`, scope_type: "eq.global", order: "created_at.asc" })
  });
}

export async function createSavedView(input: { name: string; page?: string; state: SavedViewState }) {
  return supabaseRequest<unknown[]>({ table: "saved_views", method: "POST", headers: { Prefer: "return=representation" }, body: { ...input, page: input.page ?? "products", scope_type: "global" } });
}

export async function updateSavedView(id: string, updates: Partial<{ name: string; state: SavedViewState }>) {
  return supabaseRequest<unknown[]>({ table: "saved_views", method: "PATCH", query: new URLSearchParams({ id: `eq.${id}` }), headers: { Prefer: "return=representation" }, body: updates });
}

export async function deleteSavedView(id: string) {
  await supabaseRequest<unknown[]>({ table: "saved_views", method: "DELETE", query: new URLSearchParams({ id: `eq.${id}` }) });
}

export async function getScraperHealth(limit = 14) {
  const since = new Date(Date.now() - limit * 24 * 3600_000).toISOString();

  const aggregate = (
    rows: Array<{ source_name: string; source_type: string; status: string; success: boolean; checked_at: string; metadata?: Record<string, unknown> | null; }>
  ) => {
    const grouped = new Map<string, { competitorName: string; total: number; success: number; failed: number; suspicious: number; lastSuccess: string | null; selectors: string[]; firstParty: boolean }>();
    for (const row of rows) {
      const key = (row.source_name || "Unknown").trim() || "Unknown";
      const entry = grouped.get(key) ?? { competitorName: key, total: 0, success: 0, failed: 0, suspicious: 0, lastSuccess: null, selectors: [], firstParty: row.source_type === "bents" || /bents/i.test(key) };
      entry.total += 1;
      if (row.success || row.status === "success") {
        entry.success += 1;
        if (!entry.lastSuccess || new Date(row.checked_at).getTime() > new Date(entry.lastSuccess).getTime()) {
          entry.lastSuccess = row.checked_at;
        }
      }
      if (row.status === "failed") entry.failed += 1;
      if (row.status === "suspicious") entry.suspicious += 1;
      const selectors = row.metadata?.selectors_checked;
      if (Array.isArray(selectors)) {
        entry.selectors = [...new Set([...entry.selectors, ...selectors.filter((x): x is string => typeof x === "string")])].slice(0, 6);
      }
      grouped.set(key, entry);
    }

    const mapped = [...grouped.values()].map((entry) => {
      const failureRate = entry.total ? entry.failed / entry.total : 0;
      const health = failureRate > 0.35 ? "Failing" : failureRate > 0.15 || entry.suspicious > 0 ? "Watch" : "Healthy";
      return {
        competitorName: entry.competitorName,
        totalRuns: entry.total,
        successRate: entry.total ? Number(((entry.success / entry.total) * 100).toFixed(1)) : 0,
        failureCount: entry.failed,
        failureRate: Number((failureRate * 100).toFixed(1)),
        suspiciousCount: entry.suspicious,
        lastSuccessfulRun: entry.lastSuccess,
        health,
        selectors: entry.selectors,
        firstParty: entry.firstParty,
        extractionSource: entry.firstParty ? "bents_dom_adapter" : undefined
      };
    });

    if (!mapped.some((row) => /bents/i.test(row.competitorName))) {
      mapped.unshift({
        competitorName: "Bents (first-party adapter)",
        totalRuns: 0,
        successRate: 0,
        failureCount: 0,
        failureRate: 0,
        suspiciousCount: 0,
        lastSuccessfulRun: null,
        health: "Watch",
        selectors: [".price--withTax", "[data-product-price-with-tax]", ".in-stock"],
        firstParty: true,
        extractionSource: "bents_dom_adapter"
      });
    }

    return mapped.sort((a, b) => Number(b.firstParty) - Number(a.firstParty) || b.failureRate - a.failureRate || b.suspiciousCount - a.suspiciousCount);
  };

  try {
    const rows = await supabaseRequest<Array<{ source_name: string; source_type: string; status: string; success: boolean; checked_at: string; extraction_source: string | null; metadata: Record<string, unknown> | null }>>({
      table: "product_source_history",
      query: new URLSearchParams({ select: "source_name,source_type,status,success,checked_at,extraction_source,metadata", checked_at: `gte.${since}`, order: "checked_at.desc", limit: "8000" })
    });
    return aggregate(rows);
  } catch (error) {
    console.warn("product_source_history unavailable for scraper health; falling back to refresh_run_items", error);
  }

  try {
    const rows = await supabaseRequest<Array<{ competitor_name: string | null; status: string; suspicious: boolean; checked_at: string }>>({
      table: "refresh_run_items",
      query: new URLSearchParams({ select: "competitor_name,status,suspicious,checked_at", checked_at: `gte.${since}`, order: "checked_at.desc", limit: "5000" })
    });

    return aggregate(rows.map((row) => ({
      source_name: row.competitor_name ?? "Unknown",
      source_type: /bents/i.test(row.competitor_name ?? "") ? "bents" : "competitor",
      status: row.status,
      success: row.status === "success",
      checked_at: row.checked_at,
      metadata: null
    })));
  } catch (fallbackError) {
    console.warn("refresh_run_items fallback unavailable for scraper health", fallbackError);
    return [{
      competitorName: "Bents (first-party adapter)",
      totalRuns: 0,
      successRate: 0,
      failureCount: 0,
      failureRate: 0,
      suspiciousCount: 0,
      lastSuccessfulRun: null,
      health: "Watch",
      selectors: [".price--withTax", "[data-product-price-with-tax]", ".in-stock"],
      firstParty: true,
      extractionSource: "bents_dom_adapter"
    }];
  }
}
