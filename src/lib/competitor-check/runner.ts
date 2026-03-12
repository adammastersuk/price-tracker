import { derivePricingStatus } from "@/lib/pricing-logic";
import {
  getProducts,
  getCompetitorPrices,
  insertCompetitorPrice,
  insertPriceHistory,
  updateCompetitorPrice,
  type CompetitorPriceInput
} from "@/lib/db";
import { selectAdapter } from "@/lib/competitor-check/adapters";

export interface RefreshOptions {
  productIds?: string[];
  batchSize?: number;
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
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function getBatchSize(explicit?: number): number {
  if (explicit) return explicit;
  const env = Number.parseInt(process.env.CHECK_BATCH_SIZE ?? "", 10);
  return Number.isFinite(env) && env > 0 ? env : 10;
}

function isSuspicious(previousPrice: number | null, nextPrice: number | null): boolean {
  if (previousPrice === null || nextPrice === null || previousPrice === 0) return false;
  return Math.abs(((nextPrice - previousPrice) / previousPrice) * 100) >= 40;
}

function lowConfidence(result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>) {
  return result.match_confidence === "Low" || result.match_confidence === "Needs review";
}

function isImplausibleAgainstBents(bentsPrice: number, competitorPrice: number | null): boolean {
  if (competitorPrice === null || bentsPrice <= 0) return false;
  return competitorPrice < bentsPrice * 0.1 || competitorPrice > bentsPrice * 4;
}

function suspiciousReason(target: RefreshTarget, result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>) {
  const reasons: string[] = [];
  const nextPrice = result.competitor_current_price;
  if (isSuspicious(target.previousPrice, nextPrice)) {
    reasons.push("Large delta vs previous checked competitor price.");
  }
  if (isImplausibleAgainstBents(target.bentsPrice, nextPrice)) {
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

async function buildTargets(productIds?: string[]): Promise<RefreshTarget[]> {
  const products = await getProducts();
  const filtered = productIds?.length ? products.filter((p) => productIds.includes(p.id)) : products;

  const targets: RefreshTarget[] = [];
  for (const product of filtered) {
    const mappings = await getCompetitorPrices(product.id);
    if (!mappings.length) {
      targets.push({
        productId: product.id,
        sku: product.internalSku,
        productName: product.productName,
        brand: product.brand,
        bentsPrice: product.bentsRetailPrice,
        competitorName: product.competitorName,
        competitorUrl: "",
        previousPrice: product.competitorCurrentPrice,
        previousValidPrice: product.competitorCurrentPrice
      });
      continue;
    }
    for (const mapping of mappings) {
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
        previousValidPrice: mapping.competitor_current_price
      });
    }
  }

  return targets;
}

async function saveSuccess(target: RefreshTarget, result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>) {
  const reasons = suspiciousReason(target, result);
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
  });

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

  if (target.mappingId) {
    await updateCompetitorPrice(target.mappingId, payload);
  } else {
    await insertCompetitorPrice(payload);
  }

  await insertPriceHistory({
    product_id: target.productId,
    competitor_name: target.competitorName || "Unknown competitor",
    price: acceptedCurrentPrice ?? undefined,
    checked_at: now
  });

  return { suspicious };
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
}

export async function runCompetitorRefresh(options: RefreshOptions = {}): Promise<RefreshSummary> {
  const targets = await buildTargets(options.productIds);
  const failures: RefreshFailure[] = [];
  let processed = 0;
  let succeeded = 0;
  let suspicious = 0;

  for (const batch of chunk(targets, getBatchSize(options.batchSize))) {
    await Promise.all(batch.map(async (target) => {
      processed += 1;

      if (!target.competitorUrl) {
        const reason = "Missing competitor URL";
        failures.push({ productId: target.productId, sku: target.sku, competitorUrl: target.competitorUrl, reason });
        await saveFailure(target, reason);
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
        const saveResult = await saveSuccess(target, result);
        succeeded += 1;
        if (saveResult.suspicious) suspicious += 1;
      } catch (error) {
        const reason = (error as Error).message;
        failures.push({ productId: target.productId, sku: target.sku, competitorUrl: target.competitorUrl, reason });
        await saveFailure(target, reason);
      }
    }));
  }

  return {
    total: targets.length,
    processed,
    succeeded,
    failed: failures.length,
    suspicious,
    failures
  };
}
