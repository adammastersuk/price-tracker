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
        previousPrice: product.competitorCurrentPrice
      });
      continue;
    }
    const active = mappings[0];
    targets.push({
      productId: product.id,
      sku: product.internalSku,
      productName: product.productName,
      brand: product.brand,
      bentsPrice: product.bentsRetailPrice,
      competitorName: active.competitor_name,
      competitorUrl: active.competitor_url ?? "",
      mappingId: active.id,
      previousPrice: active.competitor_current_price
    });
  }

  return targets;
}

async function saveSuccess(target: RefreshTarget, result: Awaited<ReturnType<ReturnType<typeof selectAdapter>["fetchPriceSignal"]>>) {
  const diff = result.competitor_current_price === null
    ? null
    : Number((target.bentsPrice - result.competitor_current_price).toFixed(2));
  const diffPct = result.competitor_current_price === null || result.competitor_current_price === 0
    ? null
    : Number((((target.bentsPrice - result.competitor_current_price) / result.competitor_current_price) * 100).toFixed(2));
  const suspicious = isSuspicious(target.previousPrice, result.competitor_current_price);
  const now = new Date().toISOString();
  const pricingStatus = derivePricingStatus({
    competitorCurrentPrice: result.competitor_current_price,
    competitorPromoPrice: result.competitor_promo_price,
    competitorStockStatus: result.competitor_stock_status as "In Stock" | "Low Stock" | "Out of Stock" | "Unknown",
    priceDifferencePercent: diffPct
  });

  const payload: CompetitorPriceInput = {
    product_id: target.productId,
    competitor_name: target.competitorName || "Unknown competitor",
    competitor_url: target.competitorUrl,
    competitor_current_price: result.competitor_current_price ?? undefined,
    competitor_promo_price: result.competitor_promo_price ?? undefined,
    competitor_was_price: result.competitor_was_price ?? undefined,
    competitor_stock_status: result.competitor_stock_status,
    last_checked_at: now,
    price_difference_gbp: diff ?? undefined,
    price_difference_percent: diffPct ?? undefined,
    pricing_status: pricingStatus,
    last_check_status: suspicious ? "suspicious" : "success",
    check_error_message: "",
    raw_price_text: result.raw_price_text,
    extraction_source: result.extraction_source,
    suspicious_change_flag: suspicious
  };

  if (target.mappingId) {
    await updateCompetitorPrice(target.mappingId, payload);
  } else {
    await insertCompetitorPrice(payload);
  }

  await insertPriceHistory({
    product_id: target.productId,
    competitor_name: target.competitorName || "Unknown competitor",
    price: result.competitor_current_price ?? undefined,
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
    pricing_status: "Needs review"
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
