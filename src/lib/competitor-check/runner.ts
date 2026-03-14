import { derivePricingStatus } from "@/lib/pricing-logic";
import {
  getProducts,
  getCompetitorPrices,
  insertCompetitorPrice,
  insertPriceHistory,
  updateCompetitorPrice,
  updateProduct,
  type CompetitorPriceInput,
  getRuntimeSettings,
  insertProductCycleHistory,
  insertProductSourceHistory
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
import { CheckStatus, CompetitorListing } from "@/types/pricing";

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
  costPrice: number | null;
  bentsPrice: number;
  bentsUrl: string;
  competitorMappings: Array<{
    mappingId?: string;
    competitorName: string;
    competitorUrl: string;
    previousPrice: number | null;
    previousValidPrice: number | null;
    lastCheckedAt?: string;
  }>;
  cycleTargets: Array<{
    sourceType: "bents" | "competitor";
    sourceName: string;
    url: string;
    mappingId?: string;
  }>;
  refreshTier: "default" | "priority";
}

interface QueuedTarget {
  queueItemId: string;
  runId: string;
  target: RefreshTarget;
}

interface SourceCheckResult {
  sourceType: "bents" | "competitor";
  sourceName: string;
  url: string;
  currentPrice: number | null;
  previousPrice: number | null;
  stockStatus: CompetitorListing["competitorStockStatus"];
  success: boolean;
  status: CheckStatus;
  checkedAt: string;
  notes?: string;
  extractionSource?: string;
  metadata?: Record<string, unknown>;
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

const BENTS_DIAGNOSTICS_ENABLED = process.env.LOG_BENTS_DIAGNOSTICS === "1";
const BENTS_PIPELINE_DIAGNOSTICS_ENABLED = process.env.LOG_BENTS_PIPELINE === "1";

function normalizeSourceUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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

function suspiciousReason(target: { bentsPrice: number; previousPrice: number | null; previousValidPrice: number | null; competitorUrl: string; }, result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>, thresholds: { low: number; high: number; }) {
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
    const refreshTier = product.actionWorkflowStatus === "Open" || product.actionWorkflowStatus === "In Review" ? "priority" : "default";
    const frequencyHours = options.scheduleMode === "priority"
      ? priorityHours
      : runtime.scrapeDefaults.defaultRefreshFrequencyHours;

    const filteredMappings = mappings.filter((mapping) => {
      if (options.competitorListingIds?.length && !options.competitorListingIds.includes(mapping.id)) return false;
      if (options.scheduleMode && options.scheduleMode !== "manual") {
        if (options.scheduleMode === "priority" && refreshTier !== "priority") return false;
        if (!isDue(mapping.last_checked_at, frequencyHours)) return false;
      }
      return true;
    });

    const cycleTargets: RefreshTarget["cycleTargets"] = [
      {
        sourceType: "bents",
        sourceName: "Bents",
        url: product.bentsProductUrl ?? ""
      },
      ...filteredMappings.map((mapping) => ({
        sourceType: "competitor" as const,
        sourceName: mapping.competitor_name,
        url: mapping.competitor_url ?? "",
        mappingId: mapping.id
      }))
    ];

    if (!filteredMappings.length && !product.bentsProductUrl) {
      continue;
    }

    targets.push({
      productId: product.id,
      sku: product.internalSku,
      productName: product.productName,
      brand: product.brand,
      costPrice: product.costPrice,
      bentsPrice: product.bentsRetailPrice,
      bentsUrl: product.bentsProductUrl,
      cycleTargets,
      refreshTier,
      competitorMappings: filteredMappings.map((mapping) => ({
        mappingId: mapping.id,
        competitorName: mapping.competitor_name,
        competitorUrl: mapping.competitor_url ?? "",
        previousPrice: mapping.competitor_current_price,
        previousValidPrice: mapping.competitor_current_price,
        lastCheckedAt: mapping.last_checked_at
      }))
    });
  }

  return targets;
}

async function checkBentsSource(target: RefreshTarget, checkedAt: string): Promise<SourceCheckResult> {
  if (!target.bentsUrl) {
    return {
      sourceType: "bents",
      sourceName: "Bents",
      url: "",
      currentPrice: target.bentsPrice,
      previousPrice: target.bentsPrice,
      stockStatus: "Unknown",
      success: false,
      status: "failed",
      checkedAt,
      notes: "Missing Bents product URL"
    };
  }

  const normalizedBentsUrl = normalizeSourceUrl(target.bentsUrl);
  const adapter = selectAdapter(normalizedBentsUrl || target.bentsUrl);

  try {
    const result = await adapter.fetchPriceSignal({
      sku: target.sku,
      competitorUrl: normalizedBentsUrl || target.bentsUrl,
      productName: target.productName,
      brand: target.brand
    });

    if (BENTS_DIAGNOSTICS_ENABLED) {
      console.info("[bents-check]", {
        productId: target.productId,
        sku: target.sku,
        bentsUrl: target.bentsUrl,
        normalizedBentsUrl: normalizedBentsUrl || null,
        selectedAdapter: adapter.name,
        parsedResult: result.competitor_current_price !== null
      });
    }

    const sourceResult: SourceCheckResult = {
      sourceType: "bents",
      sourceName: "Bents",
      url: normalizedBentsUrl || target.bentsUrl,
      currentPrice: result.competitor_current_price,
      previousPrice: target.bentsPrice,
      stockStatus: (result.competitor_stock_status as SourceCheckResult["stockStatus"]) ?? "Unknown",
      success: result.competitor_current_price !== null,
      status: result.competitor_current_price === null ? "failed" : "success",
      checkedAt,
      notes: result.competitor_current_price === null ? "Bents price token not found; preserving last known Bents price" : "",
      extractionSource: result.extraction_source,
      metadata: result.metadata
    }

    return sourceResult;
  } catch (error) {
    if (BENTS_DIAGNOSTICS_ENABLED) {
      console.warn("[bents-check-failed]", {
        productId: target.productId,
        sku: target.sku,
        bentsUrl: target.bentsUrl,
        normalizedBentsUrl: normalizedBentsUrl || null,
        selectedAdapter: adapter.name,
        error: error instanceof Error ? error.message : "Unknown Bents check failure"
      });
    }

    const reason = error instanceof Error ? error.message : "Unknown Bents check failure";
    return {
      sourceType: "bents",
      sourceName: "Bents",
      url: normalizedBentsUrl || target.bentsUrl,
      currentPrice: target.bentsPrice,
      previousPrice: target.bentsPrice,
      stockStatus: "Unknown",
      success: false,
      status: "failed",
      checkedAt,
      notes: reason,
      extractionSource: `failed:${adapter.name}`,
      metadata: undefined
    };
  }
}

async function saveFailure(target: RefreshTarget, mappingId: string | undefined, competitorName: string, competitorUrl: string, reason: string, diagnostics?: Record<string, unknown>) {
  if (!mappingId) return;
  const selectedAdapter = typeof diagnostics?.selected_adapter === "string" ? diagnostics.selected_adapter : "failed";
  await updateCompetitorPrice(mappingId, {
    last_checked_at: new Date().toISOString(),
    last_check_status: "failed",
    check_error_message: reason,
    pricing_status: "Needs review",
    extraction_source: `${selectedAdapter}_failed`,
    extraction_metadata: {
      trust_rejected: true,
      failure_reason: reason,
      ...(diagnostics ?? {})
    }
  });

  await upsertAlert({
    dedupe_key: `failed-check:${target.productId}:${competitorName}`,
    product_id: target.productId,
    competitor_name: competitorName,
    reason: "Repeated failed checks",
    context: { reason, competitorUrl }
  });
}

async function checkCompetitorSource(
  target: RefreshTarget,
  mapping: RefreshTarget["competitorMappings"][number],
  runtime: Awaited<ReturnType<typeof getRuntimeSettings>>,
  checkedAt: string
): Promise<{ result: SourceCheckResult; failure?: RefreshFailure; suspicious?: boolean; succeeded?: boolean; }> {
  if (!mapping.competitorUrl) {
    const reason = "Missing competitor URL";
    await saveFailure(target, mapping.mappingId, mapping.competitorName, mapping.competitorUrl, reason);
    return {
      result: {
        sourceType: "competitor",
        sourceName: mapping.competitorName,
        url: mapping.competitorUrl,
        currentPrice: mapping.previousValidPrice,
        previousPrice: mapping.previousValidPrice,
        stockStatus: "Unknown",
        success: false,
        status: "failed",
        checkedAt,
        notes: reason
      },
      failure: { productId: target.productId, sku: target.sku, competitorUrl: mapping.competitorUrl, reason },
      succeeded: false
    };
  }

  try {
    const adapter = selectAdapter(mapping.competitorUrl);
    const fetched = await adapter.fetchPriceSignal({
      sku: target.sku,
      competitorUrl: mapping.competitorUrl,
      productName: target.productName,
      brand: target.brand
    });

    const reasons = suspiciousReason(
      {
        bentsPrice: target.bentsPrice,
        previousPrice: mapping.previousPrice,
        previousValidPrice: mapping.previousValidPrice,
        competitorUrl: mapping.competitorUrl
      },
      fetched,
      {
        low: runtime.toleranceSettings.suspiciousLowPriceThresholdPercent,
        high: runtime.toleranceSettings.suspiciousHighPriceThresholdPercent
      }
    );

    const suspicious = reasons.length > 0;
    const acceptedCurrentPrice = suspicious ? mapping.previousValidPrice : fetched.competitor_current_price;
    const diff = acceptedCurrentPrice === null ? null : Number((target.bentsPrice - (acceptedCurrentPrice ?? 0)).toFixed(2));
    const diffPct = acceptedCurrentPrice === null || acceptedCurrentPrice === 0
      ? null
      : Number((((target.bentsPrice - acceptedCurrentPrice) / acceptedCurrentPrice) * 100).toFixed(2));
    const pricingStatus = derivePricingStatus({
      competitorCurrentPrice: acceptedCurrentPrice,
      competitorPromoPrice: fetched.competitor_promo_price,
      competitorStockStatus: fetched.competitor_stock_status as "In Stock" | "Low Stock" | "Out of Stock" | "Unknown",
      priceDifferencePercent: diffPct
    }, runtime.toleranceSettings.inLinePricingTolerancePercent);

    const payload: CompetitorPriceInput = {
      product_id: target.productId,
      competitor_name: mapping.competitorName || "Unknown competitor",
      competitor_url: mapping.competitorUrl,
      competitor_current_price: acceptedCurrentPrice ?? undefined,
      competitor_promo_price: fetched.competitor_promo_price ?? undefined,
      competitor_was_price: (suspicious ? mapping.previousValidPrice : fetched.competitor_was_price) ?? undefined,
      competitor_stock_status: fetched.competitor_stock_status,
      last_checked_at: checkedAt,
      price_difference_gbp: diff ?? undefined,
      price_difference_percent: diffPct ?? undefined,
      pricing_status: pricingStatus,
      last_check_status: suspicious ? "suspicious" : "success",
      check_error_message: suspicious
        ? `Suspicious extraction detected. Previous valid price retained for review. ${reasons.join(" ")}`
        : "",
      raw_price_text: fetched.raw_price_text,
      extraction_source: fetched.extraction_source,
      suspicious_change_flag: suspicious,
      extraction_metadata: {
        ...(fetched.metadata ?? {}),
        trust_rejected: suspicious,
        accepted_current_price: acceptedCurrentPrice,
        extracted_current_price: fetched.competitor_current_price,
        trust_warnings: reasons,
        previous_valid_price: mapping.previousValidPrice
      }
    };

    let mappingId = mapping.mappingId;
    if (mapping.mappingId) {
      await updateCompetitorPrice(mapping.mappingId, payload);
    } else {
      const inserted = await insertCompetitorPrice(payload);
      mappingId = inserted[0]?.id;
    }

    try {
      await insertPriceHistory({
        product_id: target.productId,
        competitor_name: mapping.competitorName || "Unknown competitor",
        competitor_url: mapping.competitorUrl,
        competitor_price_id: mappingId,
        price: acceptedCurrentPrice ?? undefined,
        current_price: acceptedCurrentPrice ?? undefined,
        promo_price: fetched.competitor_promo_price ?? undefined,
        was_price: (suspicious ? mapping.previousValidPrice : fetched.competitor_was_price) ?? undefined,
        checked_at: checkedAt,
        captured_at: checkedAt,
        last_check_status: suspicious ? "suspicious" : "success",
        suspicious_change_flag: suspicious,
        extraction_source: fetched.extraction_source,
        extraction_metadata: {
          ...(fetched.metadata ?? {}),
          trust_rejected: suspicious,
          trust_warnings: reasons
        }
      });
    } catch (error) {
      console.warn("Failed to insert price history", error);
    }

    if (suspicious) {
      await upsertAlert({
        dedupe_key: `suspicious:${target.productId}:${mapping.competitorName}`,
        product_id: target.productId,
        competitor_name: mapping.competitorName,
        reason: "Suspicious extraction",
        context: { reasons, competitorUrl: mapping.competitorUrl, extracted: fetched.competitor_current_price, accepted: acceptedCurrentPrice }
      });
    }

    return {
      result: {
        sourceType: "competitor",
        sourceName: mapping.competitorName,
        url: mapping.competitorUrl,
        currentPrice: acceptedCurrentPrice,
        previousPrice: mapping.previousPrice,
        stockStatus: (fetched.competitor_stock_status as SourceCheckResult["stockStatus"]) ?? "Unknown",
        success: true,
        status: suspicious ? "suspicious" : "success",
        checkedAt,
        notes: suspicious ? reasons.join(" ") : "",
        extractionSource: fetched.extraction_source,
        metadata: fetched.metadata
      },
      suspicious,
      succeeded: true
    };
  } catch (error) {
    const reason = (error as Error).message;
    const selectedAdapter = selectAdapter(mapping.competitorUrl);
    const parsedHostname = (() => {
      try {
        return new URL(mapping.competitorUrl).hostname;
      } catch {
        return "";
      }
    })();
    const diagnostics = {
      ...(error instanceof AdapterExtractionError ? error.diagnostics : {}),
      parsed_hostname: parsedHostname,
      selected_adapter: selectedAdapter.name
    };

    await saveFailure(target, mapping.mappingId, mapping.competitorName, mapping.competitorUrl, reason, diagnostics);
    return {
      result: {
        sourceType: "competitor",
        sourceName: mapping.competitorName,
        url: mapping.competitorUrl,
        currentPrice: mapping.previousValidPrice,
        previousPrice: mapping.previousValidPrice,
        stockStatus: "Unknown",
        success: false,
        status: "failed",
        checkedAt,
        notes: reason,
        metadata: diagnostics
      },
      failure: { productId: target.productId, sku: target.sku, competitorUrl: mapping.competitorUrl, reason },
      succeeded: false
    };
  }
}

async function updateProductFromCycle(target: RefreshTarget, bentsResult: SourceCheckResult, sourceResults: SourceCheckResult[]) {
  const latestBentsPrice = bentsResult.success && bentsResult.currentPrice !== null
    ? bentsResult.currentPrice
    : target.bentsPrice;
  const marginPercent = target.costPrice === null || latestBentsPrice <= 0
    ? null
    : Number((((latestBentsPrice - target.costPrice) / latestBentsPrice) * 100).toFixed(2));

  await updateProduct(target.productId, {
    bents_price: latestBentsPrice,
    margin_percent: marginPercent ?? undefined
  });

  if (!bentsResult.success) {
    await upsertAlert({
      dedupe_key: `bents-source-failed:${target.productId}`,
      product_id: target.productId,
      reason: "Bents source check failed",
      context: { bentsUrl: target.bentsUrl, reason: bentsResult.notes, latestKnownPrice: target.bentsPrice, sourceResults }
    });
  }
}

async function processTarget(target: RefreshTarget, runtime: Awaited<ReturnType<typeof getRuntimeSettings>>, runId?: string): Promise<{ failure?: RefreshFailure; suspicious?: boolean; succeeded?: boolean; sourceResults: SourceCheckResult[]; }> {
  const checkedAt = new Date().toISOString();
  const sourceResults: SourceCheckResult[] = [];
  let bentsResult: SourceCheckResult | null = null;

  const failures: RefreshFailure[] = [];
  let hadCompetitorSuccess = false;
  let suspicious = false;

  for (const cycleTarget of target.cycleTargets) {
    if (cycleTarget.sourceType === "bents") {
      bentsResult = await checkBentsSource(target, checkedAt);
      sourceResults.push(bentsResult);
      continue;
    }

    const mapping = target.competitorMappings.find((candidate) => candidate.mappingId === cycleTarget.mappingId);
    if (!mapping) continue;

    const checked = await checkCompetitorSource(target, mapping, runtime, checkedAt);
    sourceResults.push(checked.result);
    if (checked.failure) failures.push(checked.failure);
    if (checked.succeeded) hadCompetitorSuccess = true;
    if (checked.suspicious) suspicious = true;
  }

  const ensuredBentsResult = bentsResult ?? await checkBentsSource(target, checkedAt);
  if (!bentsResult) {
    sourceResults.unshift(ensuredBentsResult);
  }

  await updateProductFromCycle(target, ensuredBentsResult, sourceResults);

  if (runId) {
    console.info("[product-refresh] executed product cycle", {
      runId,
      productId: target.productId,
      sku: target.sku,
      sourceCount: sourceResults.length,
      bentsInvoked: true,
      bentsStatus: ensuredBentsResult.status,
      competitorSourceCount: sourceResults.filter((source) => source.sourceType === "competitor").length
    });
  }

  try {
    const cycleStatus: CheckStatus = sourceResults.some((s) => s.status === "failed")
      ? "failed"
      : sourceResults.some((s) => s.status === "suspicious")
        ? "suspicious"
        : sourceResults.every((s) => s.status === "success")
          ? "success"
          : "pending";
    const cycleSuccessCount = sourceResults.filter((s) => s.status === "success").length;
    const cycleFailedCount = sourceResults.filter((s) => s.status === "failed").length;
    const cycleSuspiciousCount = sourceResults.filter((s) => s.status === "suspicious").length;
    const cycle = await insertProductCycleHistory({
      product_id: target.productId,
      run_id: runId,
      checked_at: checkedAt,
      source_count: sourceResults.length,
      success_count: cycleSuccessCount,
      failed_count: cycleFailedCount,
      suspicious_count: cycleSuspiciousCount,
      status: cycleStatus,
      metadata: { sku: target.sku, bentsUrl: target.bentsUrl }
    });
    const cycleId = cycle[0]?.id;
    for (const source of sourceResults) {
      const insertedRows = await insertProductSourceHistory({
        product_id: target.productId,
        cycle_id: cycleId,
        source_type: source.sourceType,
        source_name: source.sourceName,
        source_url: source.url,
        checked_at: source.checkedAt,
        status: source.status,
        success: source.success,
        current_price: source.currentPrice,
        previous_price: source.previousPrice,
        stock_status: source.stockStatus,
        extraction_source: source.extractionSource,
        notes: source.notes,
        metadata: source.metadata
      });

      if (BENTS_PIPELINE_DIAGNOSTICS_ENABLED && source.sourceType === "bents") {
        const inserted = insertedRows[0];
        console.info("[bents-source-history-inserted]", {
          runId: runId ?? null,
          productId: target.productId,
          sku: target.sku,
          cycleId: cycleId ?? null,
          insertedRowId: inserted?.id ?? null,
          sourceType: inserted?.source_type ?? source.sourceType,
          sourceName: inserted?.source_name ?? source.sourceName,
          status: inserted?.status ?? source.status,
          success: inserted?.success ?? source.success,
          currentPrice: inserted?.current_price ?? source.currentPrice
        });
      }
    }

    if (runId) {
      console.info("[product-refresh] persisted cycle history", {
        runId,
        productId: target.productId,
        cycleId: cycleId ?? null,
        sourceCount: sourceResults.length,
        successCount: cycleSuccessCount,
        failedCount: cycleFailedCount,
        suspiciousCount: cycleSuspiciousCount,
        bentsIncluded: sourceResults.some((source) => source.sourceType === "bents")
      });
    }

  } catch (error) {
    console.warn("Failed to persist cycle/source history", error);
  }

  const failedReason = failures[0]?.reason ?? (!ensuredBentsResult.success ? (ensuredBentsResult.notes ?? "Bents source check failed") : undefined);
  return {
    sourceResults,
    failure: failedReason ? { productId: target.productId, sku: target.sku, competitorUrl: failures[0]?.competitorUrl ?? target.bentsUrl, reason: failedReason } : undefined,
    suspicious,
    succeeded: ensuredBentsResult.success || hadCompetitorSuccess
  };
}

export async function enqueueCompetitorRefresh(options: RefreshOptions = {}): Promise<{ runId?: string; queued: number; total: number; }> {
  const runtime = await getRuntimeSettings();
  const targets = await buildTargets(options, runtime);
  const runId = await createRefreshRun({
    trigger_source: options.triggerSource ?? "manual",
    schedule_mode: options.scheduleMode ?? "manual",
    total: targets.length,
    metadata: { targetCount: targets.length, pending: targets.length, sourceType: "product_cycle" }
  });

  if (runId) {
    for (const target of targets) {
      await logRefreshRunItem({
        run_id: runId,
        product_id: target.productId,
        status: "queued",
        competitor_name: "Product cycle",
        competitor_url: target.bentsUrl,
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
      costPrice: typeof target.costPrice === "number" ? target.costPrice : null,
      bentsPrice: Number(target.bentsPrice ?? 0),
      bentsUrl: target.bentsUrl ?? row.competitor_url ?? "",
      refreshTier: target.refreshTier === "priority" ? "priority" : "default",
      competitorMappings: Array.isArray(target.competitorMappings) ? target.competitorMappings : [],
      cycleTargets: Array.isArray(target.cycleTargets)
        ? target.cycleTargets
        : [
            {
              sourceType: "bents",
              sourceName: "Bents",
              url: target.bentsUrl ?? row.competitor_url ?? ""
            },
            ...(Array.isArray(target.competitorMappings)
              ? target.competitorMappings.map((mapping) => ({
                  sourceType: "competitor" as const,
                  sourceName: mapping.competitorName ?? "Unknown competitor",
                  url: mapping.competitorUrl ?? "",
                  mappingId: mapping.mappingId
                }))
              : [])
          ]
    }
  };
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

  const result = await processTarget(queued.target, runtime, runId);
  if (result.failure) failures.push(result.failure);

  await updateRefreshRunItem(queued.queueItemId, {
    status: result.succeeded ? (result.suspicious ? "suspicious" : "success") : "failed",
    suspicious: !!result.suspicious,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    error_message: result.failure?.reason,
    metadata: { sourceResults: result.sourceResults }
  });

  await updateRunCounts(runId, {
    succeeded: result.succeeded ? 1 : 0,
    failed: result.succeeded ? 0 : 1,
    suspicious: result.suspicious ? 1 : 0,
    processed: 1
  });

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

export async function processQueuedRefreshRun(runId: string): Promise<RefreshSummary> {
  let summary = await processOneQueuedRefresh(runId);
  while ((summary.pending ?? 0) > 0) {
    summary = await processOneQueuedRefresh(runId);
  }
  return summary;
}

export async function runCompetitorRefresh(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const queued = await enqueueCompetitorRefresh(options);
  if (!queued.runId) {
    return { total: queued.total, processed: 0, succeeded: 0, failed: 0, suspicious: 0, failures: [] };
  }
  return processQueuedRefreshRun(queued.runId);
}
