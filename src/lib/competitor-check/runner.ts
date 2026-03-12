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
import { selectAdapter } from "@/lib/competitor-check/adapters";
import { completeRefreshRun, createRefreshRun, logActivity, logRefreshRunItem, upsertAlert } from "@/lib/operations";
import { rowCommercialSignals } from "@/lib/data-service";

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
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function getBatchSize(runtimeBatchSize: number | undefined, explicit?: number): number {
  if (explicit) return explicit;
  if (runtimeBatchSize && runtimeBatchSize > 0) return runtimeBatchSize;
  const env = Number.parseInt(process.env.CHECK_BATCH_SIZE ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 10;
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

async function saveFailure(target: RefreshTarget, reason: string) {
  if (!target.mappingId) return;
  await updateCompetitorPrice(target.mappingId, {
    last_checked_at: new Date().toISOString(),
    last_check_status: "failed",
    check_error_message: reason,
    pricing_status: "Needs review",
    extraction_metadata: {
      trust_rejected: true,
      failure_reason: reason
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

async function generateOperationalAlerts(runtime: Awaited<ReturnType<typeof getRuntimeSettings>>) {
  const rows = await getProducts();
  for (const row of rows) {
    const signals = rowCommercialSignals(row, runtime);
    if (signals.bentsNotCheapest && signals.lowestTrusted) {
      await upsertAlert({
        dedupe_key: `not-cheapest:${row.id}:${signals.lowestTrusted.competitorName}`,
        product_id: row.id,
        competitor_name: signals.lowestTrusted.competitorName,
        reason: "Bents not cheapest beyond threshold",
        gap_amount_gbp: signals.gapGbp,
        context: { gapPercent: signals.gapPercent, bentsPrice: row.bentsRetailPrice, competitorPrice: signals.lowestTrusted.price }
      });
    }
    if (signals.promoDiscrepancy) {
      await upsertAlert({
        dedupe_key: `promo-discrepancy:${row.id}`,
        product_id: row.id,
        reason: "Promo discrepancy",
        context: { sku: row.internalSku }
      });
    }
    if (signals.stale) {
      await upsertAlert({
        dedupe_key: `stale:${row.id}`,
        product_id: row.id,
        reason: "Stale checks",
        context: { staleHours: runtime.scrapeDefaults.staleCheckHours }
      });
    }
  }
}

export async function runCompetitorRefresh(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const failures: RefreshFailure[] = [];
  let processed = 0;
  let succeeded = 0;
  let suspicious = 0;

  const runtime = await getRuntimeSettings();
  const targets = await buildTargets(options, runtime);
  const runId = await createRefreshRun({
    trigger_source: options.triggerSource ?? "manual",
    schedule_mode: options.scheduleMode ?? "manual",
    metadata: { targetCount: targets.length }
  });

  for (const batch of chunk(targets, getBatchSize(runtime.scrapeDefaults.batchSize, options.batchSize))) {
    await Promise.all(batch.map(async (target) => {
      processed += 1;
      const started = Date.now();

      if (!target.competitorUrl) {
        const reason = "Missing competitor URL";
        failures.push({ productId: target.productId, sku: target.sku, competitorUrl: target.competitorUrl, reason });
        await saveFailure(target, reason);
        if (runId) {
          await logRefreshRunItem({ run_id: runId, product_id: target.productId, competitor_price_id: target.mappingId, competitor_name: target.competitorName, competitor_url: target.competitorUrl, status: "missing_url", error_message: reason });
        }
        return;
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
        succeeded += 1;
        if (saveResult.suspicious) suspicious += 1;
        if (runId) {
          await logRefreshRunItem({
            run_id: runId,
            product_id: target.productId,
            competitor_price_id: saveResult.mappingId,
            competitor_name: target.competitorName,
            competitor_url: target.competitorUrl,
            status: saveResult.suspicious ? "suspicious" : "success",
            suspicious: saveResult.suspicious,
            extraction_source: result.extraction_source,
            duration_ms: Date.now() - started,
            metadata: { pricingStatus: saveResult.pricingStatus, acceptedCurrentPrice: saveResult.acceptedCurrentPrice }
          });
        }
      } catch (error) {
        const reason = (error as Error).message;
        failures.push({ productId: target.productId, sku: target.sku, competitorUrl: target.competitorUrl, reason });
        await saveFailure(target, reason);
        if (runId) {
          await logRefreshRunItem({
            run_id: runId,
            product_id: target.productId,
            competitor_price_id: target.mappingId,
            competitor_name: target.competitorName,
            competitor_url: target.competitorUrl,
            status: "failed",
            duration_ms: Date.now() - started,
            error_message: reason
          });
        }
      }
    }));
  }

  await generateOperationalAlerts(runtime);

  const summary = {
    total: targets.length,
    processed,
    succeeded,
    failed: failures.length,
    suspicious,
    failures,
    runId: runId ?? undefined
  };

  if (runId) {
    await completeRefreshRun(runId, summary);
    await logActivity({
      event_type: "refresh_run_completed",
      entity_type: "refresh_run",
      entity_id: runId,
      summary: `Refresh run completed (${summary.succeeded} success, ${summary.failed} failed, ${summary.suspicious} suspicious).`,
      metadata: summary
    });
  }

  return summary;
}
