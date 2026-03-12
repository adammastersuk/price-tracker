import { CheckStatus } from "@/types/pricing";
import { supabaseRequest } from "@/lib/db/client";

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
  await supabaseRequest<unknown[]>({ table: "activity_log", method: "POST", body: entry });
}

export async function getActivity(limit = 50) {
  return supabaseRequest<Array<ActivityLogInput & { id: string; created_at: string }>>({
    table: "activity_log",
    query: new URLSearchParams({ select: "*", order: "created_at.desc", limit: String(limit) })
  });
}

export async function upsertAlert(input: AlertInput) {
  return supabaseRequest<unknown[]>({
    table: "alerts",
    method: "POST",
    query: new URLSearchParams({ on_conflict: "dedupe_key" }),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: { ...input, status: input.status ?? "new", last_seen_at: new Date().toISOString() }
  });
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

export async function createRefreshRun(input: { trigger_source: string; schedule_mode: string; metadata?: Record<string, unknown> }) {
  const rows = await supabaseRequest<RefreshRunRecord[]>({
    table: "refresh_runs",
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { ...input, started_at: new Date().toISOString() }
  });
  return rows[0]?.id;
}

export async function completeRefreshRun(runId: string, summary: { total: number; processed: number; succeeded: number; failed: number; suspicious: number; metadata?: Record<string, unknown> }) {
  await supabaseRequest<unknown[]>({
    table: "refresh_runs",
    method: "PATCH",
    query: new URLSearchParams({ id: `eq.${runId}` }),
    body: { ...summary, completed_at: new Date().toISOString(), metadata: summary.metadata }
  });
}

export async function logRefreshRunItem(input: {
  run_id: string;
  product_id: string;
  competitor_price_id?: string;
  competitor_name?: string;
  competitor_url?: string;
  status: CheckStatus | "missing_url";
  suspicious?: boolean;
  duration_ms?: number;
  error_message?: string;
  extraction_source?: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRequest<unknown[]>({ table: "refresh_run_items", method: "POST", body: { ...input, checked_at: new Date().toISOString() } });
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
  const rows = await supabaseRequest<Array<{ competitor_name: string | null; status: string; suspicious: boolean; checked_at: string; duration_ms: number | null }>>({
    table: "refresh_run_items",
    query: new URLSearchParams({ select: "competitor_name,status,suspicious,checked_at,duration_ms", checked_at: `gte.${since}`, order: "checked_at.desc", limit: "5000" })
  });

  const grouped = new Map<string, { competitorName: string; total: number; success: number; failed: number; suspicious: number; durations: number[]; lastSuccess: string | null }>();
  for (const row of rows) {
    const key = (row.competitor_name || "Unknown").trim() || "Unknown";
    const entry = grouped.get(key) ?? { competitorName: key, total: 0, success: 0, failed: 0, suspicious: 0, durations: [], lastSuccess: null };
    entry.total += 1;
    if (row.status === "success") {
      entry.success += 1;
      if (!entry.lastSuccess || new Date(row.checked_at).getTime() > new Date(entry.lastSuccess).getTime()) {
        entry.lastSuccess = row.checked_at;
      }
    }
    if (row.status === "failed") entry.failed += 1;
    if (row.suspicious || row.status === "suspicious") entry.suspicious += 1;
    if (row.duration_ms && row.duration_ms > 0) entry.durations.push(row.duration_ms);
    grouped.set(key, entry);
  }

  return [...grouped.values()].map((entry) => {
    const failureRate = entry.total ? entry.failed / entry.total : 0;
    const sortedDur = [...entry.durations].sort((a, b) => a - b);
    const median = sortedDur.length ? sortedDur[Math.floor(sortedDur.length / 2)] : null;
    const avg = sortedDur.length ? Math.round(sortedDur.reduce((a, b) => a + b, 0) / sortedDur.length) : null;
    const health = failureRate > 0.35 ? "Failing" : failureRate > 0.15 || entry.suspicious > 0 ? "Watch" : "Healthy";
    return {
      competitorName: entry.competitorName,
      totalRuns: entry.total,
      successRate: entry.total ? Number(((entry.success / entry.total) * 100).toFixed(1)) : 0,
      failureCount: entry.failed,
      failureRate: Number((failureRate * 100).toFixed(1)),
      suspiciousCount: entry.suspicious,
      lastSuccessfulRun: entry.lastSuccess,
      avgDurationMs: avg,
      medianDurationMs: median,
      health
    };
  }).sort((a, b) => b.failureRate - a.failureRate || b.suspiciousCount - a.suspiciousCount);
}
