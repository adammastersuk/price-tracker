import { derivePricingStatus } from "@/lib/pricing-logic";
import {
  getProducts,
  getCompetitorPrices,
  insertCompetitorPrice,
  insertPriceHistory,
  updateCompetitorPrice,
  type CompetitorPriceInput,
  getRuntimeSettings
} from "@/lib/db";
import { AdapterExtractionError, selectAdapter } from "@/lib/competitor-check/adapters";
import {
  completeRefreshRun,
  createRefreshRun,
  getRefreshRun,
  listQueuedRefreshRunItems,
  logActivity,
  logRefreshRunItem,
  updateRefreshRun,
  updateRefreshRunItem,
  upsertAlert
} from "@/lib/operations";
import { toPlainObject } from "@/lib/json";

export interface RefreshOptions {
  productIds?: string[];
  competitorListingIds?: string[];
  batchSize?: number;
  scheduleMode?: "manual" | "priority" | "daily";
  triggerSource?: "manual" | "cron";
}

interface RefreshTarget {
  productId: string;
  sku: string;
  productName: string;
  brand: string;
  bentsPrice: number;
  competitorName: string;
  competitorUrl: string;
  mappingId?: string;
  previousPrice: number | null;
  previousValidPrice: number | null;
  refreshTier: "default" | "priority";
  lastCheckedAt?: string;
}

interface QueuedTarget {
  queueItemId: string;
  runId: string;
  target: RefreshTarget;
}

export interface RefreshFailure {
  productId: string;
  sku: string;
  competitorUrl: string;
  reason: string;
}

export interface RefreshSummary {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  suspicious: number;
  failures: RefreshFailure[];
  runId?: string;
  pending?: number;
}

function isSuspicious(previousPrice: number | null, nextPrice: number | null, highThresholdPercent: number): boolean {
  if (previousPrice === null || nextPrice === null || previousPrice === 0) return false;
  return Math.abs(((nextPrice - previousPrice) / previousPrice) * 100) >= highThresholdPercent;
}

function lowConfidence(result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>) {
  return result.match_confidence === "Low" || result.match_confidence === "Needs review";
}

function isImplausibleAgainstBents(bentsPrice: number, competitorPrice: number | null, lowThresholdPercent: number, highThresholdPercent: number): boolean {
  if (competitorPrice === null || bentsPrice <= 0) return false;
  const lowFactor = Math.max(0, 1 - lowThresholdPercent / 100);
  const highFactor = 1 + highThresholdPercent / 100;
  return competitorPrice < bentsPrice * lowFactor || competitorPrice > bentsPrice * highFactor;
}

function suspiciousReason(target: RefreshTarget, result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>, thresholds: { low: number; high: number; }) {
  const reasons: string[] = [];
  const nextPrice = result.competitor_current_price;
  if (isSuspicious(target.previousPrice, nextPrice, thresholds.high)) {
    reasons.push("Large delta vs previous checked competitor price.");
  }
  if (isImplausibleAgainstBents(target.bentsPrice, nextPrice, thresholds.low, thresholds.high)) {
    reasons.push("Extracted value is implausible against Bents product price context.");
  }
  if (nextPrice !== null && target.bentsPrice > 500 && nextPrice < target.bentsPrice * 0.25) {
    reasons.push("Value appears too low for this product class and may be a delivery/banner threshold token.");
  }
  if (lowConfidence(result) && nextPrice !== null) {
    reasons.push("Extractor confidence is low for the captured price token.");
  }
  if ((result.metadata?.forced_suspicious as boolean | undefined) === true) {
    reasons.push(String(result.metadata?.forced_suspicious_reason ?? "Adapter trust rules flagged extraction as suspicious."));
  }
  return reasons;
}

function isDue(lastCheckedAt: string | undefined, hours: number) {
  if (!lastCheckedAt) return true;
  const ts = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts >= hours * 3600_000;
}

async function buildTargets(options: RefreshOptions, runtime: Awaited<ReturnType<typeof getRuntimeSettings>>): Promise<RefreshTarget[]> {
  const products = await getProducts();
  const filtered = options.productIds?.length ? products.filter((p) => options.productIds?.includes(p.id)) : products;
  const priorityHours = Number(process.env.PRIORITY_REFRESH_FREQUENCY_HOURS ?? "6") || 6;

  const targets: RefreshTarget[] = [];
  for (const product of filtered) {
    const mappings = await getCompetitorPrices(product.id);
    for (const mapping of mappings) {
      if (options.competitorListingIds?.length && !options.competitorListingIds.includes(mapping.id)) {
        continue;
      }
      const refreshTier = product.actionWorkflowStatus === "Open" || product.actionWorkflowStatus === "In Review" ? "priority" : "default";
      const frequencyHours = options.scheduleMode === "priority"
        ? priorityHours
        : runtime.scrapeDefaults.defaultRefreshFrequencyHours;

      if (options.scheduleMode && options.scheduleMode !== "manual") {
        if (options.scheduleMode === "priority" && refreshTier !== "priority") continue;
        if (!isDue(mapping.last_checked_at, frequencyHours)) continue;
      }

      targets.push({
        productId: product.id,
        sku: product.internalSku,
        productName: product.productName,
        brand: product.brand,
        bentsPrice: product.bentsRetailPrice,
        competitorName: mapping.competitor_name,
        competitorUrl: mapping.competitor_url ?? "",
        mappingId: mapping.id,
        previousPrice: mapping.competitor_current_price,
        previousValidPrice: mapping.competitor_current_price,
        refreshTier,
        lastCheckedAt: mapping.last_checked_at
      });
    }
  }

  return targets;
}

async function saveSuccess(target: RefreshTarget, result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>, runtime: Awaited<ReturnType<typeof getRuntimeSettings>>) {
  const reasons = suspiciousReason(target, result, {
    low: runtime.toleranceSettings.suspiciousLowPriceThresholdPercent,
    high: runtime.toleranceSettings.suspiciousHighPriceThresholdPercent
  });
  const suspicious = reasons.length > 0;

  const acceptedCurrentPrice = suspicious ? target.previousValidPrice : result.competitor_current_price;
  const diff = acceptedCurrentPrice === null
    ? null
    : Number((target.bentsPrice - (acceptedCurrentPrice ?? 0)).toFixed(2));
  const diffPct = acceptedCurrentPrice === null || acceptedCurrentPrice === 0
    ? null
    : Number((((target.bentsPrice - acceptedCurrentPrice) / acceptedCurrentPrice) * 100).toFixed(2));
  const now = new Date().toISOString();
  const pricingStatus = derivePricingStatus({
    competitorCurrentPrice: acceptedCurrentPrice,
    competitorPromoPrice: result.competitor_promo_price,
    competitorStockStatus: result.competitor_stock_status as "In Stock" | "Low Stock" | "Out of Stock" | "Unknown",
    priceDifferencePercent: diffPct
  }, runtime.toleranceSettings.inLinePricingTolerancePercent);

  const payload: CompetitorPriceInput = {
    product_id: target.productId,
    competitor_name: target.competitorName || "Unknown competitor",
    competitor_url: target.competitorUrl,
    competitor_current_price: acceptedCurrentPrice ?? undefined,
    competitor_promo_price: result.competitor_promo_price ?? undefined,
    competitor_was_price: (suspicious ? target.previousValidPrice : result.competitor_was_price) ?? undefined,
    competitor_stock_status: result.competitor_stock_status,
    last_checked_at: now,
    price_difference_gbp: diff ?? undefined,
    price_difference_percent: diffPct ?? undefined,
    pricing_status: pricingStatus,
    last_check_status: suspicious ? "suspicious" : "success",
    check_error_message: suspicious
      ? `Suspicious extraction detected. Previous valid price retained for review. ${reasons.join(" ")}`
      : "",
    raw_price_text: result.raw_price_text,
    extraction_source: result.extraction_source,
    suspicious_change_flag: suspicious,
    extraction_metadata: {
      ...(result.metadata ?? {}),
      trust_rejected: suspicious,
      accepted_current_price: acceptedCurrentPrice,
      extracted_current_price: result.competitor_current_price,
      trust_warnings: reasons,
      previous_valid_price: target.previousValidPrice
    }
  };

  let mappingId = target.mappingId;
  if (target.mappingId) {
    await updateCompetitorPrice(target.mappingId, payload);
  } else {
    const inserted = await insertCompetitorPrice(payload);
    mappingId = inserted[0]?.id;
  }

  try {
    await insertPriceHistory({
      product_id: target.productId,
      competitor_name: target.competitorName || "Unknown competitor",
      competitor_url: target.competitorUrl,
      competitor_price_id: mappingId,
      price: acceptedCurrentPrice ?? undefined,
      current_price: acceptedCurrentPrice ?? undefined,
      promo_price: result.competitor_promo_price ?? undefined,
      was_price: (suspicious ? target.previousValidPrice : result.competitor_was_price) ?? undefined,
      checked_at: now,
      captured_at: now,
      last_check_status: suspicious ? "suspicious" : "success",
      suspicious_change_flag: suspicious,
      extraction_source: result.extraction_source,
      extraction_metadata: {
        ...(result.metadata ?? {}),
        trust_rejected: suspicious,
        trust_warnings: reasons
      }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to insert price history", error);
  }

  if (suspicious) {
    await upsertAlert({
      dedupe_key: `suspicious:${target.productId}:${target.competitorName}`,
      product_id: target.productId,
      competitor_name: target.competitorName,
      reason: "Suspicious extraction",
      context: { reasons, competitorUrl: target.competitorUrl, extracted: result.competitor_current_price, accepted: acceptedCurrentPrice }
    });
  }

  return { suspicious, mappingId, acceptedCurrentPrice, pricingStatus };
}

async function saveFailure(target: RefreshTarget, reason: string, diagnostics?: Record<string, unknown>) {
  if (!target.mappingId) return;
  await updateCompetitorPrice(target.mappingId, {
    last_checked_at: new Date().toISOString(),
    last_check_status: "failed",
    check_error_message: reason,
    pricing_status: "Needs review",
    extraction_metadata: {
      trust_rejected: true,
      failure_reason: reason,
      ...(diagnostics ?? {})
    }
  });

  await upsertAlert({
    dedupe_key: `failed-check:${target.productId}:${target.competitorName}`,
    product_id: target.productId,
    competitor_name: target.competitorName,
    reason: "Repeated failed checks",
    context: { reason, competitorUrl: target.competitorUrl }
  });
}

export async function enqueueCompetitorRefresh(options: RefreshOptions = {}): Promise<{ runId?: string; queued: number; total: number; }> {
  const runtime = await getRuntimeSettings();
  const targets = await buildTargets(options, runtime);
  const runId = await createRefreshRun({
    trigger_source: options.triggerSource ?? "manual",
    schedule_mode: options.scheduleMode ?? "manual",
    total: targets.length,
    metadata: { targetCount: targets.length, pending: targets.length }
  });

  if (runId) {
    for (const target of targets) {
      await logRefreshRunItem({
        run_id: runId,
        product_id: target.productId,
        competitor_price_id: target.mappingId,
        competitor_name: target.competitorName,
        competitor_url: target.competitorUrl,
        status: "queued",
        metadata: { target }
      });
    }
  }

  return { runId: runId ?? undefined, queued: targets.length, total: targets.length };
}

async function readQueuedTarget(runId: string): Promise<QueuedTarget | null> {
  const rows = await listQueuedRefreshRunItems(runId, 1);
  const row = rows[0];
  if (!row) return null;
  const target = toPlainObject(row.metadata?.target, {}) as Partial<RefreshTarget>;
  return {
    queueItemId: row.id,
    runId,
    target: {
      productId: target.productId ?? row.product_id,
      sku: target.sku ?? "Unknown SKU",
      productName: target.productName ?? "Unknown product",
      brand: target.brand ?? "Unknown",
      bentsPrice: Number(target.bentsPrice ?? 0),
      competitorName: target.competitorName ?? row.competitor_name ?? "Unknown competitor",
      competitorUrl: target.competitorUrl ?? row.competitor_url ?? "",
      mappingId: target.mappingId ?? row.competitor_price_id ?? undefined,
      previousPrice: typeof target.previousPrice === "number" ? target.previousPrice : null,
      previousValidPrice: typeof target.previousValidPrice === "number" ? target.previousValidPrice : null,
      refreshTier: target.refreshTier === "priority" ? "priority" : "default",
      lastCheckedAt: target.lastCheckedAt
    }
  };
}



async function processTarget(target: RefreshTarget, runtime: Awaited<ReturnType<typeof getRuntimeSettings>>): Promise<{ failure?: RefreshFailure; suspicious?: boolean; succeeded?: boolean; }> {
  if (!target.competitorUrl) {
    const reason = "Missing competitor URL";
    await saveFailure(target, reason);
    return { failure: { productId: target.productId, sku: target.sku, competitorUrl: target.competitorUrl, reason }, succeeded: false };
  }

  try {
    const adapter = selectAdapter(target.competitorUrl);
    const result = await adapter.fetchPriceSignal({
      sku: target.sku,
      competitorUrl: target.competitorUrl,
      productName: target.productName,
      brand: target.brand
    });
    const saveResult = await saveSuccess(target, result, runtime);
    return { suspicious: saveResult.suspicious, succeeded: true };
  } catch (error) {
    const reason = (error as Error).message;
    const diagnostics = error instanceof AdapterExtractionError ? error.diagnostics : undefined;
    await saveFailure(target, reason, diagnostics);
    return { failure: { productId: target.productId, sku: target.sku, competitorUrl: target.competitorUrl, reason }, succeeded: false };
  }
}

export async function runCompetitorRefreshInline(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const runtime = await getRuntimeSettings();
  const targets = await buildTargets(options, runtime);
  const limit = Math.max(1, Number(options.batchSize ?? runtime.scrapeDefaults.batchSize) || runtime.scrapeDefaults.batchSize);
  const selected = targets.slice(0, limit);
  const failures: RefreshFailure[] = [];
  let succeeded = 0;
  let failed = 0;
  let suspicious = 0;

  for (const target of selected) {
    const result = await processTarget(target, runtime);
    if (result.failure) failures.push(result.failure);
    if (result.succeeded) succeeded += 1;
    else failed += 1;
    if (result.suspicious) suspicious += 1;
  }

  return {
    total: selected.length,
    processed: selected.length,
    succeeded,
    failed,
    suspicious,
    failures
  };
}

async function updateRunCounts(runId: string, update: { succeeded?: number; failed?: number; suspicious?: number; processed?: number; pending?: number; total?: number; }) {
  const run = await getRefreshRun(runId);
  if (!run) return;
  const pending = update.pending ?? Math.max(run.total - (run.processed + (update.processed ?? 0)), 0);
  const next = {
    total: update.total ?? run.total,
    processed: run.processed + (update.processed ?? 0),
    succeeded: run.succeeded + (update.succeeded ?? 0),
    failed: run.failed + (update.failed ?? 0),
    suspicious: run.suspicious + (update.suspicious ?? 0),
    metadata: { pending }
  };
  await updateRefreshRun(runId, next);
}

export async function processOneQueuedRefresh(runId: string): Promise<RefreshSummary> {
  const queued = await readQueuedTarget(runId);
  if (!queued) {
    const run = await getRefreshRun(runId);
    return {
      total: run?.total ?? 0,
      processed: run?.processed ?? 0,
      succeeded: run?.succeeded ?? 0,
      failed: run?.failed ?? 0,
      suspicious: run?.suspicious ?? 0,
      failures: [],
      runId,
      pending: 0
    };
  }

  const runtime = await getRuntimeSettings();
  const started = Date.now();
  const failures: RefreshFailure[] = [];

  if (!queued.target.competitorUrl) {
    const reason = "Missing competitor URL";
    failures.push({ productId: queued.target.productId, sku: queued.target.sku, competitorUrl: queued.target.competitorUrl, reason });
    await saveFailure(queued.target, reason);
    await updateRefreshRunItem(queued.queueItemId, {
      status: "missing_url",
      error_message: reason,
      checked_at: new Date().toISOString(),
      duration_ms: Date.now() - started
    });
    await updateRunCounts(runId, { failed: 1, processed: 1 });
  } else {
    try {
      const adapter = selectAdapter(queued.target.competitorUrl);
      const result = await adapter.fetchPriceSignal({
        sku: queued.target.sku,
        competitorUrl: queued.target.competitorUrl,
        productName: queued.target.productName,
        brand: queued.target.brand
      });
      const saveResult = await saveSuccess(queued.target, result, runtime);
      await updateRefreshRunItem(queued.queueItemId, {
        status: saveResult.suspicious ? "suspicious" : "success",
        suspicious: saveResult.suspicious,
        extraction_source: result.extraction_source,
        competitor_price_id: saveResult.mappingId,
        checked_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        metadata: { pricingStatus: saveResult.pricingStatus, acceptedCurrentPrice: saveResult.acceptedCurrentPrice }
      });
      await updateRunCounts(runId, { succeeded: 1, suspicious: saveResult.suspicious ? 1 : 0, processed: 1 });
    } catch (error) {
      const reason = (error as Error).message;
      const diagnostics = error instanceof AdapterExtractionError ? error.diagnostics : undefined;
      failures.push({ productId: queued.target.productId, sku: queued.target.sku, competitorUrl: queued.target.competitorUrl, reason });
      await saveFailure(queued.target, reason, diagnostics);
      await updateRefreshRunItem(queued.queueItemId, {
        status: "failed",
        error_message: reason,
        checked_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        metadata: diagnostics
      });
      await updateRunCounts(runId, { failed: 1, processed: 1 });
    }
  }

  const [run, pendingRows] = await Promise.all([getRefreshRun(runId), listQueuedRefreshRunItems(runId, 1)]);
  const pending = pendingRows.length > 0 ? (run ? Math.max(run.total - run.processed, 0) : 1) : 0;

  const summary: RefreshSummary = {
    total: run?.total ?? 0,
    processed: run?.processed ?? 0,
    succeeded: run?.succeeded ?? 0,
    failed: run?.failed ?? 0,
    suspicious: run?.suspicious ?? 0,
    failures,
    runId,
    pending
  };

  if (pending === 0 && runId) {
    await completeRefreshRun(runId, {
      total: summary.total,
      processed: summary.processed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      suspicious: summary.suspicious,
      metadata: { pending: 0 }
    });
    await logActivity({
      event_type: "refresh_run_completed",
      entity_type: "refresh_run",
      entity_id: runId,
      summary: `Refresh run completed (${summary.succeeded} success, ${summary.failed} failed, ${summary.suspicious} suspicious).`,
      metadata: summary as unknown as Record<string, unknown>
    });
  }

  return summary;
}

export async function runCompetitorRefresh(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const queued = await enqueueCompetitorRefresh(options);
  if (!queued.runId) {
    return { total: queued.total, processed: 0, succeeded: 0, failed: 0, suspicious: 0, failures: [] };
  }
  return processOneQueuedRefresh(queued.runId);
}
