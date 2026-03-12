import { MatchConfidence } from "@/types/pricing";

export interface AdapterInput {
  sku: string;
  competitorUrl: string;
  productName: string;
  brand: string;
}

export interface AdapterResult {
  competitor_current_price: number | null;
  competitor_promo_price: number | null;
  competitor_was_price: number | null;
  competitor_stock_status: string;
  match_confidence: MatchConfidence;
  raw_price_text?: string;
  extraction_source?: string;
  metadata?: Record<string, unknown>;
}

export interface CompetitorAdapter {
  name: string;
  supports: (url: string) => boolean;
  fetchPriceSignal: (input: AdapterInput) => Promise<AdapterResult>;
}

function parseCurrencyLike(value: string): number | null {
  const normalized = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

interface PriceCandidate {
  value: number;
  context: string;
  score: number;
  source: string;
}

interface CandidateReview {
  value: number;
  score: number;
  source: string;
  reason: string;
}

const NEGATIVE_PRICE_CONTEXT = [
  "delivery",
  "orders over",
  "order over",
  "over £",
  "over &pound;",
  "finance",
  "per month",
  "monthly",
  "voucher",
  "voucher code",
  "promo code",
  "discount code",
  "header",
  "announcement",
  "sitewide",
  "strip",
  "newsletter",
  "free shipping",
  "free uk mainland"
];

const POSITIVE_PRICE_CONTEXT = [
  "itemprop=\"price\"",
  "product-price",
  "product price",
  "price-wrapper",
  "price block",
  "price-container",
  "add to basket",
  "add-to-basket",
  "add to cart",
  "buy now",
  "preorder",
  "now",
  "was",
  "our price"
];

const GENERIC_PRICE_RE = /(?:£|&pound;|GBP)\s?([\d,.]{1,12})/gi;

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function scoreContext(context: string): number {
  const normalized = context.toLowerCase();
  let score = 0;
  for (const token of POSITIVE_PRICE_CONTEXT) {
    if (normalized.includes(token)) score += 3;
  }
  for (const token of NEGATIVE_PRICE_CONTEXT) {
    if (normalized.includes(token)) score -= 5;
  }
  return score;
}

function extractHeuristicCandidates(html: string): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  for (const match of html.matchAll(GENERIC_PRICE_RE)) {
    const full = match[0] ?? "";
    const value = parseCurrencyLike(full);
    if (value === null || value < 0.1 || value > 100000) continue;
    const idx = match.index ?? 0;
    const context = html.slice(Math.max(0, idx - 160), Math.min(html.length, idx + 200));
    const score = scoreContext(context);
    candidates.push({ value, context: context.replace(/\s+/g, " ").trim(), score, source: "currency_token" });
  }

  for (const match of html.matchAll(/itemprop="price"[^>]*content="([\d.]{1,12})"|content="([\d.]{1,12})"[^>]*itemprop="price"/gi)) {
    const value = parseCurrencyLike(match[1] ?? match[2] ?? "");
    if (value === null || value < 0.1 || value > 100000) continue;
    candidates.push({ value, context: match[0], score: 8, source: "itemprop_price" });
  }

  for (const match of html.matchAll(/"price"\s*[:=]\s*"?([\d.]{1,12})"?/gi)) {
    const value = parseCurrencyLike(match[1] ?? "");
    if (value === null || value < 0.1 || value > 100000) continue;
    const idx = match.index ?? 0;
    const context = html.slice(Math.max(0, idx - 120), Math.min(html.length, idx + 120));
    candidates.push({ value, context: context.replace(/\s+/g, " ").trim(), score: 5, source: "json_price" });
  }

  return candidates;
}

function pickBestPrice(candidates: PriceCandidate[]) {
  const unique = new Map<number, PriceCandidate>();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.value);
    if (!existing || candidate.score > existing.score) {
      unique.set(candidate.value, candidate);
    }
  }

  const ranked = [...unique.values()].sort((a, b) => b.score - a.score || b.value - a.value);
  const viable = ranked.filter((candidate) => candidate.score >= 0);
  const best = viable[0] ?? null;
  const alternates = viable.slice(1, 5).map((candidate) => ({
    value: candidate.value,
    score: candidate.score,
    source: candidate.source
  }));

  return { best, alternates, rankedCount: ranked.length };
}

const GFW_BLOCKED_CONTEXT = [
  /delivery/i,
  /orders?\s+over/i,
  /order\s+over/i,
  /finance/i,
  /per\s+month/i,
  /monthly/i,
  /voucher/i,
  /promo\s*code/i,
  /discount\s*code/i,
  /sitewide/i,
  /header/i,
  /announcement/i,
  /free\s+(?:delivery|shipping)/i
];

const GFW_PRODUCT_CONTEXT = [
  /product\s*title/i,
  /product-title/i,
  /product\s*price/i,
  /price\s*wrapper/i,
  /price\s*block/i,
  /was/i,
  /now/i,
  /add\s*to\s*basket/i,
  /add-to-basket/i,
  /quantity/i,
  /preorder/i,
  /itemprop="price"/i,
  /"@type"\s*:\s*"product"/i
];

function summarizeCandidate(candidate: PriceCandidate, reason: string): CandidateReview {
  return {
    value: candidate.value,
    score: candidate.score,
    source: candidate.source,
    reason
  };
}

function reviewGardenFurnitureCandidates(candidates: PriceCandidate[]) {
  const accepted: PriceCandidate[] = [];
  const rejected: CandidateReview[] = [];

  for (const candidate of candidates) {
    const context = candidate.context.toLowerCase();
    const blockedByContext = GFW_BLOCKED_CONTEXT.some((pattern) => pattern.test(context));
    const productSignal = GFW_PRODUCT_CONTEXT.some((pattern) => pattern.test(context)) || candidate.source === "json_ld";

    if (blockedByContext && !productSignal) {
      rejected.push(summarizeCandidate(candidate, "blocked_context"));
      continue;
    }

    const adjustedScore = candidate.score + (productSignal ? 5 : 0) - (blockedByContext ? 10 : 0);
    const reviewed = { ...candidate, score: adjustedScore };

    if (reviewed.score < 1) {
      rejected.push(summarizeCandidate(reviewed, "low_confidence"));
      continue;
    }

    accepted.push(reviewed);
  }

  const strongestSignal = accepted
    .filter((candidate) => GFW_PRODUCT_CONTEXT.some((pattern) => pattern.test(candidate.context)) || candidate.source === "json_ld")
    .sort((a, b) => b.score - a.score || b.value - a.value)[0] ?? null;

  const lowStandalone = accepted
    .filter((candidate) => candidate.value <= 120)
    .sort((a, b) => a.value - b.value || b.score - a.score)[0] ?? null;

  if (lowStandalone && strongestSignal && strongestSignal.value > lowStandalone.value * 1.8) {
    rejected.push(summarizeCandidate(lowStandalone, "rejected_low_standalone_vs_product_signal"));
    const filtered = accepted.filter((candidate) => candidate !== lowStandalone);
    return {
      accepted: filtered,
      rejected,
      forcedSuspicious: true,
      forcedReason: "Low standalone token conflicts with stronger product price signals"
    };
  }

  return { accepted, rejected, forcedSuspicious: false, forcedReason: "" };
}

class GardenFurnitureWorldAdapter implements CompetitorAdapter {
  name = "garden-furniture-world";

  supports(url: string) {
    return /gardenfurnitureworld\.co\.uk/i.test(hostFromUrl(url) || url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`GFW adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const scriptMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    const jsonPrices: number[] = [];
    for (const scriptMatch of scriptMatches) {
      const blob = scriptMatch[1] ?? "";
      const direct = [...blob.matchAll(/"price"\s*:\s*"?([\d.]{1,12})"?/gi)];
      for (const priceMatch of direct) {
        const parsed = parseCurrencyLike(priceMatch[1] ?? "");
        if (parsed !== null) jsonPrices.push(parsed);
      }
    }

    const blockCandidates = extractHeuristicCandidates(html)
      .map((candidate) => ({
        ...candidate,
        score: candidate.score + (/product|basket|add to basket|price|now|was/i.test(candidate.context) ? 4 : 0)
      }));
    const jsonCandidates = [...new Set(jsonPrices)].map((value) => ({ value, context: "json-ld", score: 9, source: "json_ld" }));
    const reviewed = reviewGardenFurnitureCandidates([...jsonCandidates, ...blockCandidates]);
    const { best, alternates, rankedCount } = pickBestPrice(reviewed.accepted);

    const wasMatch = html.match(/(?:was|rrp)[^£]{0,50}(£|&pound;)\s?([\d,.]{1,12})/i);
    const was = parseCurrencyLike(wasMatch?.[0] ?? "");
    const promoContext = html.match(/(?:save\s+\d+%|sale|special offer|limited time)/i)?.[0] ?? "";
    const stock = /out of stock|sold out|unavailable/i.test(html)
      ? "Out of Stock"
      : /low stock|only \d+ left/i.test(html)
        ? "Low Stock"
        : "In Stock";

    return {
      competitor_current_price: best?.value ?? null,
      competitor_promo_price: best && was && best.value < was ? best.value : null,
      competitor_was_price: was,
      competitor_stock_status: stock,
      match_confidence: best ? (best.score >= 9 ? "High" : best.score >= 5 ? "Medium" : "Low") : "Needs review",
      raw_price_text: best?.context.slice(0, 180),
      extraction_source: "garden_furniture_world",
      metadata: {
        ranked_count: rankedCount,
        alternates,
        promo_context: promoContext,
        accepted_reason: best ? "product_context_signal" : "no_reliable_candidate",
        rejected_candidates: reviewed.rejected,
        forced_suspicious: reviewed.forcedSuspicious,
        forced_suspicious_reason: reviewed.forcedReason,
        selected_source: best?.source ?? null
      }
    };
  }
}

export class MockCompetitorAdapter implements CompetitorAdapter {
  name = "mock";

  supports() {
    return true;
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const hash = [...input.sku].reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const hasPriceSignal = hash % 4 !== 0;
    const base = 1 + (hash % 40);
    const current = hasPriceSignal ? Number((base + 0.49).toFixed(2)) : null;
    return {
      competitor_current_price: current,
      competitor_promo_price: current !== null && hash % 3 === 0 ? Number((current * 0.95).toFixed(2)) : null,
      competitor_was_price: current !== null && hash % 5 === 0 ? Number((current * 1.08).toFixed(2)) : null,
      competitor_stock_status: hash % 9 === 0 ? "Low Stock" : "In Stock",
      match_confidence: hasPriceSignal ? "Low" : "Needs review",
      raw_price_text: hasPriceSignal ? `Mock estimate for ${input.sku}` : "No reliable mock price",
      extraction_source: "mock",
      metadata: { deterministic_seed: hash }
    };
  }
}

export class GenericHtmlPriceExtractorAdapter implements CompetitorAdapter {
  name = "generic-html";

  supports(url: string) {
    return /^https?:\/\//.test(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(input.competitorUrl, {
        headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const { best, alternates, rankedCount } = pickBestPrice(extractHeuristicCandidates(html));
      const current = best?.value ?? null;
      const promo = alternates.find((v) => current !== null && v.value < current)?.value ?? null;
      const was = alternates.find((v) => current !== null && v.value > current)?.value ?? null;
      const blockedByContext = best ? scoreContext(best.context) < 0 : false;

      return {
        competitor_current_price: current,
        competitor_promo_price: promo,
        competitor_was_price: was,
        competitor_stock_status: /out of stock|sold out/i.test(html) ? "Out of Stock" : "In Stock",
        match_confidence: current
          ? blockedByContext
            ? "Needs review"
            : best && best.score >= 7
              ? "Medium"
              : "Low"
          : "Needs review",
        raw_price_text: best?.context?.slice(0, 120),
        extraction_source: "html_regex",
        metadata: {
          candidate_count: rankedCount,
          alternates,
          chosen_source: best?.source,
          blocked_by_negative_context: blockedByContext
        }
      };
    } catch (error) {
      throw new Error(`Generic extractor failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class RetailerPlaceholderAdapter implements CompetitorAdapter {
  constructor(public name: string, private hostHint: RegExp) {}

  supports(url: string) {
    return this.hostHint.test(url);
  }

  async fetchPriceSignal(): Promise<AdapterResult> {
    throw new Error(`${this.name} adapter not implemented yet`);
  }
}

const adapters: CompetitorAdapter[] = [
  new GardenFurnitureWorldAdapter(),
  new RetailerPlaceholderAdapter("placeholder-bq", /b\&?q|diy/i),
  new RetailerPlaceholderAdapter("placeholder-homebase", /homebase/i),
  new GenericHtmlPriceExtractorAdapter(),
  new MockCompetitorAdapter()
];

export function selectAdapter(competitorUrl: string): CompetitorAdapter {
  return adapters.find((adapter) => adapter.supports(competitorUrl)) ?? new MockCompetitorAdapter();
}
