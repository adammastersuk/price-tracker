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

export class AdapterExtractionError extends Error {
  constructor(message: string, public diagnostics: Record<string, unknown> = {}) {
    super(message);
    this.name = "AdapterExtractionError";
  }
}

function parseCurrencyLike(value: string): number | null {
  const normalized = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function parseGbpCurrency(value: string): number | null {
  const gbpMatch = decodeHtmlEntities(value).match(/(?:£|&pound;|GBP)\s*[\d,.]{1,12}/i);
  if (!gbpMatch) return null;
  return parseCurrencyLike(gbpMatch[0]);
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

function normalizeHostname(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function isRuxleyManorHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /^ruxley-?manor\.co\.uk$/i.test(normalizedHost);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&pound;/gi, "£")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}


function parseStockFromText(value: string): "In Stock" | "Unknown" {
  if (/\bin\s+stock\b/i.test(value)) return "In Stock";
  return "Unknown";
}

function findPurchaseArea(html: string) {
  const addToCartMatch = html.match(/<(section|div|form)[^>]*(?:product|purchase|buy|basket|cart)[^>]*>[\s\S]{0,2000}?(?:add\s*to\s*(?:basket|cart)|buy\s*now)[\s\S]{0,2000}?<\/\1>/i);
  if (addToCartMatch) {
    return {
      text: stripTags(addToCartMatch[0]),
      found: true,
      source: "purchase_block"
    };
  }

  const fallback = html.match(/(?:add\s*to\s*(?:basket|cart)|buy\s*now)[\s\S]{0,400}/i);
  if (fallback) {
    return {
      text: stripTags(fallback[0]),
      found: true,
      source: "purchase_cta_context"
    };
  }

  return { text: "", found: false, source: "none" };
}

class CharliesAdapter implements CompetitorAdapter {
  name = "charlies";

  supports(url: string) {
    const host = hostFromUrl(url) || url;
    return /charlies\.co\.uk/i.test(host);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Charlies adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const checkedSelectors = [
      "span[data-test-id=\"product-grid-product-price\"][data-product-price-with-tax]",
      "input#form-action-addToCart[type=\"submit\"]",
      "stock text near purchase area"
    ];

    const selectorDiagnostics: Record<string, boolean> = {};
    const candidateValues: Array<{ source_selector: string; extracted_text: string; parsed: number | null }> = [];

    const spanMatch = html.match(/<span[^>]*data-test-id=["']product-grid-product-price["'][^>]*data-product-price-with-tax(?:\s*=\s*["'][^"']*["'])?[^>]*>([\s\S]*?)<\/span>/i);
    if (spanMatch?.[1]) {
      const extractedText = stripTags(spanMatch[1]);
      const parsed = parseGbpCurrency(extractedText);
      selectorDiagnostics["span[data-test-id=\"product-grid-product-price\"][data-product-price-with-tax]"] = true;
      candidateValues.push({ source_selector: "span[data-test-id=\"product-grid-product-price\"][data-product-price-with-tax]", extracted_text: extractedText, parsed });
    } else {
      selectorDiagnostics["span[data-test-id=\"product-grid-product-price\"][data-product-price-with-tax]"] = false;
    }

    const addToBasketMatch = html.match(/<input[^>]*id=["']form-action-addToCart["'][^>]*type=["']submit["'][^>]*value=["']([^"']+)["'][^>]*>/i);
    if (addToBasketMatch?.[1]) {
      const extractedText = decodeHtmlEntities(addToBasketMatch[1]).trim();
      const parsed = parseGbpCurrency(extractedText);
      selectorDiagnostics["input#form-action-addToCart[type=\"submit\"]"] = true;
      candidateValues.push({ source_selector: "input#form-action-addToCart[type=\"submit\"]", extracted_text: extractedText, parsed });
    } else {
      selectorDiagnostics["input#form-action-addToCart[type=\"submit\"]"] = false;
    }

    const purchaseArea = findPurchaseArea(html);
    const stockText = purchaseArea.text.match(/\bin\s+stock\b/i)?.[0] ?? "";

    const accepted = candidateValues.find((candidate) => candidate.parsed !== null && candidate.parsed > 0) ?? null;
    if (!accepted || accepted.parsed === null) {
      const failureMessage = `${stockText ? "Stock detected but no valid price found" : "Charlies adapter could not find price selector"}. Selectors attempted: ${checkedSelectors.join(", ")}`;
      throw new AdapterExtractionError(failureMessage, {
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorDiagnostics,
        candidate_values_found: candidateValues,
        accepted_value: null,
        rejected_values: candidateValues,
        rejection_reasons: ["required_price_selector_missing_or_invalid"],
        stock_text_found: stockText || null,
        purchase_area_detected: purchaseArea.found
      });
    }

    const wasMatch = html.match(/(?:was|rrp)[^£]{0,80}(£|&pound;)\s?([\d,.]{1,12})/i);
    const wasPrice = parseCurrencyLike(wasMatch?.[0] ?? "");

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: wasPrice,
      competitor_stock_status: parseStockFromText(stockText),
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "charlies_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: accepted.extracted_text,
        source_selector: accepted.source_selector,
        stock_text_found: stockText || null,
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorDiagnostics,
        candidate_values_found: candidateValues,
        accepted_value: accepted.parsed,
        rejected_values: candidateValues.filter((candidate) => candidate !== accepted),
        rejection_reasons: [],
        purchase_area_detected: purchaseArea.found,
        purchase_area_source: purchaseArea.source
      }
    };
  }
}

class WhitehallAdapter implements CompetitorAdapter {
  name = "whitehall";

  supports(url: string) {
    const host = hostFromUrl(url) || url;
    return /whitehallgardencentre\.co\.uk/i.test(host) || /whitehall/i.test(host);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Whitehall adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const checkedSelectors = [
      "p.product-details-price__regular-price--sale",
      "s.product-details-price__sale-full-price",
      "stock text near purchase area"
    ];
    const selectorsFound: Record<string, boolean> = {};

    const saleMatch = html.match(/<p[^>]*class=["'][^"']*\bproduct-details-price__regular-price--sale\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const saleText = saleMatch?.[1] ? stripTags(saleMatch[1]) : "";
    selectorsFound["p.product-details-price__regular-price--sale"] = Boolean(saleText);

    const purchaseArea = findPurchaseArea(html);
    const stockText = purchaseArea.text.match(/\bin\s+stock\b/i)?.[0] ?? "";

    const salePrice = parseCurrencyLike(saleText);
    if (salePrice === null) {
      const failureMessage = stockText ? "Stock detected but no valid price found" : "Whitehall sale price selector missing";
      throw new AdapterExtractionError(failureMessage, {
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: saleText ? [{ source_selector: "p.product-details-price__regular-price--sale", extracted_text: saleText, parsed: salePrice }] : [],
        accepted_value: null,
        rejected_values: saleText ? [{ source_selector: "p.product-details-price__regular-price--sale", extracted_text: saleText, parsed: salePrice }] : [],
        rejection_reasons: ["required_sale_price_selector_missing_or_invalid"],
        stock_text_found: stockText || null,
        purchase_area_detected: purchaseArea.found
      });
    }

    const wasMatch = html.match(/<s[^>]*class=["'][^"']*\bproduct-details-price__sale-full-price\b[^"']*["'][^>]*>([\s\S]*?)<\/s>/i);
    const wasText = wasMatch?.[1] ? stripTags(wasMatch[1]) : "";
    selectorsFound["s.product-details-price__sale-full-price"] = Boolean(wasText);
    const wasPrice = parseCurrencyLike(wasText);

    return {
      competitor_current_price: salePrice,
      competitor_promo_price: null,
      competitor_was_price: wasPrice,
      competitor_stock_status: parseStockFromText(stockText),
      match_confidence: "High",
      raw_price_text: saleText,
      extraction_source: "whitehall_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: saleText,
        source_selector: "p.product-details-price__regular-price--sale",
        stock_text_found: stockText || null,
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: [
          { source_selector: "p.product-details-price__regular-price--sale", extracted_text: saleText, parsed: salePrice },
          ...(wasText ? [{ source_selector: "s.product-details-price__sale-full-price", extracted_text: wasText, parsed: wasPrice }] : [])
        ],
        accepted_value: salePrice,
        rejected_values: [],
        rejection_reasons: [],
        purchase_area_detected: purchaseArea.found,
        purchase_area_source: purchaseArea.source
      }
    };
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
  /basket/i,
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

function normalizeHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNowPriceForGardenFurnitureWorld(html: string) {
  const rejectedCandidates: CandidateReview[] = [];

  for (const match of html.matchAll(GENERIC_PRICE_RE)) {
    const raw = match[0] ?? "";
    const value = parseCurrencyLike(raw);
    if (value === null) continue;
    const idx = match.index ?? 0;
    const context = html.slice(Math.max(0, idx - 180), Math.min(html.length, idx + 180));
    if (GFW_BLOCKED_CONTEXT.some((pattern) => pattern.test(context))) {
      rejectedCandidates.push({
        value,
        score: -1,
        source: "currency_token",
        reason: "blocked_context"
      });
    }
  }

  const spanNowPattern =
    /<span[^>]*>\s*Now\s*<\/span>[\s\S]{0,240}?<span[^>]*>\s*(?:£|&pound;)\s?([\d,.]{1,12})\s*<\/span>/i;
  const spanMatch = html.match(spanNowPattern);
  if (spanMatch?.[1]) {
    const extractedText = `£${spanMatch[1]}`;
    const parsed = parseCurrencyLike(extractedText);
    if (parsed !== null) {
      return {
        value: parsed,
        extractedText,
        sourcePattern: "Now price span",
        rejectedCandidates
      };
    }
  }

  const normalizedText = normalizeHtmlText(html);
  const textMatch = normalizedText.match(/Now\s*(?:£|&pound;)\s?([\d,.]{1,12})/i);
  if (textMatch?.[1]) {
    const extractedText = `£${textMatch[1]}`;
    const parsed = parseCurrencyLike(extractedText);
    if (parsed !== null) {
      return {
        value: parsed,
        extractedText,
        sourcePattern: "Now text pattern",
        rejectedCandidates
      };
    }
  }

  return {
    value: null,
    extractedText: null,
    sourcePattern: "Now price span",
    rejectedCandidates
  };
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

    const nowExtraction = extractNowPriceForGardenFurnitureWorld(html);
    if (nowExtraction.value === null) {
      throw new Error("failed extraction: garden furniture world now price not found");
    }

    const wasMatch = html.match(/(?:was|rrp)[^£]{0,50}(£|&pound;)\s?([\d,.]{1,12})/i);
    const was = parseCurrencyLike(wasMatch?.[0] ?? "");
    const promoContext = html.match(/(?:save\s+\d+%|sale|special offer|limited time)/i)?.[0] ?? "";
    const stock = /out of stock|sold out|unavailable/i.test(html)
      ? "Out of Stock"
      : /low stock|only \d+ left/i.test(html)
        ? "Low Stock"
        : "In Stock";

    return {
      competitor_current_price: nowExtraction.value,
      competitor_promo_price: was && nowExtraction.value < was ? nowExtraction.value : null,
      competitor_was_price: was,
      competitor_stock_status: stock,
      match_confidence: "High",
      raw_price_text: nowExtraction.extractedText ?? undefined,
      extraction_source: "garden_furniture_world",
      metadata: {
        extraction_method: "garden_furniture_world_now_price",
        extracted_text: nowExtraction.extractedText,
        source_pattern: nowExtraction.sourcePattern,
        rejected_candidates: nowExtraction.rejectedCandidates,
        promo_context: promoContext,
        accepted_reason: "deterministic_now_rule"
      }
    };
  }
}

class RuxleyManorAdapter implements CompetitorAdapter {
  name = "ruxley-manor";

  supports(url: string) {
    return isRuxleyManorHost(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Ruxley Manor adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const checkedSelectors = [
      ".price-wrapper.now-price .price",
      ".now-price .price",
      ".prices .price"
    ];

    const selectorPatterns: Array<{ selector: string; pattern: RegExp }> = [
      {
        selector: ".price-wrapper.now-price .price",
        pattern:
          /<div[^>]*class=["'][^"']*\bprice-wrapper\b[^"']*\bnow-price\b[^"']*["'][^>]*>[\s\S]{0,500}?<span[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      },
      {
        selector: ".now-price .price",
        pattern:
          /<[^>]*class=["'][^"']*\bnow-price\b[^"']*["'][^>]*>[\s\S]{0,500}?<span[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      },
      {
        selector: ".prices .price",
        pattern:
          /<[^>]*class=["'][^"']*\bprices\b[^"']*["'][^>]*>[\s\S]{0,500}?<[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\//i
      }
    ];

    const selectorsFound: Record<string, boolean> = {};
    const candidateValues: Array<{ source_selector: string; extracted_text: string; parsed: number | null }> = [];

    for (const { selector, pattern } of selectorPatterns) {
      const match = html.match(pattern);
      const extractedText = match?.[1] ? stripTags(match[1]) : "";
      const parsed = extractedText ? parseGbpCurrency(extractedText) : null;
      selectorsFound[selector] = Boolean(extractedText);
      if (extractedText) {
        candidateValues.push({ source_selector: selector, extracted_text: extractedText, parsed });
      }
    }

    const accepted = candidateValues.find((candidate) => candidate.parsed !== null && candidate.parsed > 0) ?? null;
    if (!accepted || accepted.parsed === null) {
      throw new AdapterExtractionError(
        `Ruxley Manor price extraction failed. Selectors attempted: ${checkedSelectors.join(", ")}`,
        {
          adapter_attempted: this.name,
          selectors_checked: checkedSelectors,
          selectors_found: selectorsFound,
          candidate_values_found: candidateValues,
          accepted_value: null,
          rejected_values: candidateValues,
          rejection_reasons: ["required_now_price_selector_missing_or_invalid"]
        }
      );
    }

    const stock = /out\s+of\s+stock/i.test(html)
      ? "Out of Stock"
      : /in\s+stock|add\s*to\s*(?:basket|cart)|buy\s*now/i.test(html)
        ? "In Stock"
        : "Unknown";

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: null,
      competitor_stock_status: stock,
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "ruxley_manor_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: accepted.extracted_text,
        source_selector: accepted.source_selector,
        adapter_attempted: this.name,
        matched_hostname: hostFromUrl(input.competitorUrl),
        normalized_hostname: normalizeHostname(hostFromUrl(input.competitorUrl) || ""),
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: candidateValues,
        accepted_value: accepted.parsed,
        rejected_values: candidateValues.filter((candidate) => candidate !== accepted),
        rejection_reasons: []
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
    const host = hostFromUrl(url) || url;
    if (/gardenfurnitureworld\.co\.uk/i.test(host)) return false;
    if (/charlies\.co\.uk/i.test(host)) return false;
    if (/whitehallgardencentre\.co\.uk|whitehall/i.test(host)) return false;
    if (isRuxleyManorHost(host)) return false;
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
  new CharliesAdapter(),
  new WhitehallAdapter(),
  new GardenFurnitureWorldAdapter(),
  new RuxleyManorAdapter(),
  new RetailerPlaceholderAdapter("placeholder-bq", /b\&?q|diy/i),
  new RetailerPlaceholderAdapter("placeholder-homebase", /homebase/i),
  new GenericHtmlPriceExtractorAdapter(),
  new MockCompetitorAdapter()
];

export function selectAdapter(competitorUrl: string): CompetitorAdapter {
  return adapters.find((adapter) => adapter.supports(competitorUrl)) ?? new MockCompetitorAdapter();
}
