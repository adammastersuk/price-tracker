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
  result_status?: "ok" | "out_of_stock" | "removed" | "adapter_error";
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


type WebbsPageClassification = "product" | "category" | "search" | "home" | "not_found" | "unknown";

interface WebbsPageDiagnostics {
  pageClassification: WebbsPageClassification;
  looksLikeProductPage: boolean;
  removedLikely: boolean;
  removalReason: string;
  stock: "In Stock" | "Limited Stock" | "Out of Stock" | "Unknown";
}

export function normalizeComparableUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${normalizeHostname(parsed.hostname)}${path.toLowerCase()}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function pathFromUrl(raw: string): string {
  try {
    return new URL(raw).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function canonicalUrlFromHtml(html: string): string | null {
  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  return canonicalMatch?.[1]?.trim() || null;
}

function looksLikeWebbsProductPath(path: string): boolean {
  if (!path || path === "/") return false;
  return /\/$/.test(path) && !/(\/search|\/category|\/categories|\/collections|\/brand|\/brands|\/shop|\/garden-water-features\/?$)/i.test(path);
}

function stockFromWebbsHtml(html: string): "In Stock" | "Limited Stock" | "Out of Stock" | "Unknown" {
  const detectedStock = detectWebbsStockStatus(html).stock;
  return detectedStock === "Low Stock" ? "Limited Stock" : detectedStock;
}

function extractWebbsCartControls(html: string): Array<{ control: string; disabled: boolean }> {
  const controls: Array<{ control: string; disabled: boolean }> = [];
  const buttonRe = /<button\b[^>]*>[\s\S]*?<\/button>/gi;
  const inputRe = /<input\b[^>]*>/gi;

  const collectControl = (controlHtml: string, textSource = controlHtml) => {
    const controlText = normalizeWhitespace(stripTags(textSource)).toLowerCase();
    const isPurchaseCta = /\b(add\s+to\s+basket|add\s+to\s+cart|buy\s+now)\b/i.test(controlText);
    if (!isPurchaseCta) return;

    const disabled =
      /\bdisabled\b/i.test(controlHtml) ||
      /aria-disabled\s*=\s*["']?true["']?/i.test(controlHtml) ||
      /\b(?:is-|btn-)?disabled\b/i.test(controlHtml) ||
      /\b(?:sold\s*out|out\s+of\s+stock|unavailable)\b/i.test(controlText);

    controls.push({ control: controlText, disabled });
  };

  for (const buttonMatch of html.matchAll(buttonRe)) {
    collectControl(buttonMatch[0]);
  }

  for (const inputMatch of html.matchAll(inputRe)) {
    const tag = inputMatch[0];
    const valueMatch = tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i);
    collectControl(tag, valueMatch?.[1] ?? tag);
  }

  return controls;
}

function detectWebbsStockStatus(html: string): {
  stock: "In Stock" | "Low Stock" | "Out of Stock" | "Unknown";
  diagnostics: {
    hasVisibleInStockText: boolean;
    hasVisibleLowStockText: boolean;
    hasVisibleOutOfStockText: boolean;
    hasEnabledAddToBasket: boolean;
    hasDisabledAddToBasket: boolean;
    hasVisibleQuantityInput: boolean;
    hasActivePurchaseForm: boolean;
    hasUnavailablePurchaseContainer: boolean;
    visibleStockText: string;
    matchedAddToBasketControls: number;
  };
} {
  const visibleHtml = extractVisibleHtml(html);
  const visibleText = normalizeWhitespace(stripTags(visibleHtml)).toLowerCase();
  const cartControls = extractWebbsCartControls(visibleHtml);

  const stockContainerMatches = [
    ...visibleHtml.matchAll(/<[^>]*class=["'][^"']*\b(?:stock|inventory|availability|product-stock|stock-label)\b[^"']*["'][^>]*>([\s\S]*?)<\//gi)
  ];
  const visibleStockText = normalizeWhitespace(stockContainerMatches.map((match) => stripTags(match[1] ?? "")).join(" ")).toLowerCase();

  const hasVisibleInStockText = /\bin\s+stock\b/.test(visibleStockText) || /\bin\s+stock\b/.test(visibleText);
  const hasVisibleLowStockText =
    /\blow\s+stock\b|\blimited\s+stock\b|\bonly\s+\d+\s+left\b/.test(visibleStockText) ||
    /\blow\s+stock\b|\blimited\s+stock\b|\bonly\s+\d+\s+left\b/.test(visibleText);
  const hasVisibleOutOfStockText =
    /\bout\s+of\s+stock\b|\bsold\s+out\b/.test(visibleStockText) ||
    /\bout\s+of\s+stock\b|\bsold\s+out\b/.test(visibleText);

  const hasEnabledAddToBasket = cartControls.some((control) => !control.disabled);
  const hasDisabledAddToBasket = cartControls.some((control) => control.disabled);

  const hasVisibleQuantityInput =
    /<input\b[^>]*(?:name\s*=\s*["']qty|name\s*=\s*["']quantity|id\s*=\s*["'][^"']*qty|id\s*=\s*["'][^"']*quantity|class\s*=\s*["'][^"']*qty|class\s*=\s*["'][^"']*quantity)[^>]*>/i.test(visibleHtml) &&
    !/<input\b[^>]*(?:name\s*=\s*["']qty|name\s*=\s*["']quantity|id\s*=\s*["'][^"']*qty|id\s*=\s*["'][^"']*quantity|class\s*=\s*["'][^"']*qty|class\s*=\s*["'][^"']*quantity)[^>]*\bdisabled\b/i.test(visibleHtml);

  const hasActivePurchaseForm =
    /<form\b[^>]*>(?=[\s\S]{0,1500}(?:add\s*to\s*(?:basket|cart)|buy\s*now))[\s\S]*?<\/form>/i.test(visibleHtml) &&
    !/<form\b[^>]*\b(?:data-available|data-product-in-stock)\s*=\s*["']?false["']?[^>]*>/i.test(visibleHtml) &&
    !/<form\b[^>]*\b(?:unavailable|sold-?out)\b[^>]*>/i.test(visibleHtml);

  const hasUnavailablePurchaseContainer =
    /<[^>]*class=["'][^"']*(?:out-of-stock|sold-out|unavailable|not-available)[^"']*["'][^>]*>/i.test(visibleHtml) ||
    /<form\b[^>]*\b(?:data-available|data-product-in-stock)\s*=\s*["']?false["']?[^>]*>/i.test(visibleHtml);

  if ((hasDisabledAddToBasket || hasUnavailablePurchaseContainer) && hasVisibleOutOfStockText && !hasEnabledAddToBasket) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActivePurchaseForm,
        hasUnavailablePurchaseContainer,
        visibleStockText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasVisibleLowStockText) {
    return {
      stock: "Low Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActivePurchaseForm,
        hasUnavailablePurchaseContainer,
        visibleStockText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasVisibleInStockText) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActivePurchaseForm,
        hasUnavailablePurchaseContainer,
        visibleStockText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasEnabledAddToBasket || (hasVisibleQuantityInput && hasActivePurchaseForm)) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActivePurchaseForm,
        hasUnavailablePurchaseContainer,
        visibleStockText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasVisibleOutOfStockText || hasUnavailablePurchaseContainer || hasDisabledAddToBasket) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActivePurchaseForm,
        hasUnavailablePurchaseContainer,
        visibleStockText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  return {
    stock: "Unknown",
    diagnostics: {
      hasVisibleInStockText,
      hasVisibleLowStockText,
      hasVisibleOutOfStockText,
      hasEnabledAddToBasket,
      hasDisabledAddToBasket,
      hasVisibleQuantityInput,
      hasActivePurchaseForm,
      hasUnavailablePurchaseContainer,
      visibleStockText,
      matchedAddToBasketControls: cartControls.length
    }
  };
}

export function classifyWebbsPage(input: { html: string; originalUrl: string; finalUrl: string; httpStatus: number; redirected: boolean; }): WebbsPageDiagnostics {
  const { html, originalUrl, finalUrl, httpStatus, redirected } = input;
  const text = stripTags(html).toLowerCase();
  const finalPath = pathFromUrl(finalUrl);
  const canonical = canonicalUrlFromHtml(html);
  const canonicalPath = canonical ? pathFromUrl(canonical) : "";

  const hasProductJsonLd = /"@type"\s*:\s*"Product"/i.test(html);
  const hasProductTitle = /<(h1|meta)[^>]*(product|name|og:title)[^>]*>/i.test(html) || /<h1[^>]*>[^<]{3,}<\/h1>/i.test(html);
  const hasAddToCart = /add\s*to\s*(basket|cart)|buy\s*now/i.test(text);
  const hasPriceSignal = /(?:£|&pound;|GBP)\s*\d/.test(html) || /itemprop=["']price["']/i.test(html);

  const looksLikeProductPage = hasProductJsonLd || ((hasProductTitle || hasAddToCart) && hasPriceSignal);

  const notFoundSignal = httpStatus === 404 || httpStatus === 410 || /product\s+not\s+found|no\s+longer\s+available|discontinued|page\s+not\s+found|404/i.test(text);
  if (notFoundSignal) {
    return {
      pageClassification: "not_found",
      looksLikeProductPage: false,
      removedLikely: true,
      removalReason: "Product no longer available at retailer",
      stock: "Out of Stock"
    };
  }

  const isHome = finalPath === "/";
  const isSearch = /\/search/i.test(finalPath) || /\bsearch\b/i.test(text);
  const isCategory = /\/(garden-water-features|category|categories|collections|shop|brand|brands)\/?$/i.test(finalPath);

  const pageClassification: WebbsPageClassification = looksLikeProductPage
    ? "product"
    : isHome
      ? "home"
      : isSearch
        ? "search"
        : isCategory
          ? "category"
          : "unknown";

  const originalPath = pathFromUrl(originalUrl);
  const sameProductCanonical = Boolean(canonical && canonicalPath && normalizeComparableUrl(canonical) === normalizeComparableUrl(originalUrl));
  const sameProductUrl = normalizeComparableUrl(finalUrl) === normalizeComparableUrl(originalUrl) || sameProductCanonical;

  const redirectedToNonProduct = redirected && !sameProductUrl && !looksLikeProductPage && pageClassification !== "unknown";
  const originalLookedLikeProduct = looksLikeWebbsProductPath(originalPath);

  return {
    pageClassification,
    looksLikeProductPage,
    removedLikely: Boolean(originalLookedLikeProduct && redirectedToNonProduct),
    removalReason: redirectedToNonProduct
      ? "Original URL redirected to a non-product page"
      : "",
    stock: stockFromWebbsHtml(html)
  };
}

function buildWebbsRemovedResult(input: { originalUrl: string; finalUrl: string; redirectChain: string[]; httpStatus: number; pageClassification: WebbsPageClassification; reason: string; }): AdapterResult {
  return {
    competitor_current_price: null,
    competitor_promo_price: null,
    competitor_was_price: null,
    competitor_stock_status: "URL Unavailable",
    result_status: "removed",
    match_confidence: "High",
    raw_price_text: input.reason,
    extraction_source: "webbs_removed_product",
    metadata: {
      adapter_attempted: "webbs",
      original_url: input.originalUrl,
      final_url: input.finalUrl,
      redirect_chain: input.redirectChain,
      final_http_status: input.httpStatus,
      page_classification: input.pageClassification,
      internal_result_status: "removed",
      result_message: `URL unavailable: ${input.reason}`
    }
  };
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
    try {
      return new URL(`https://${raw}`).hostname.toLowerCase();
    } catch {
      return "";
    }
  }
}

function normalizeHostname(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function isRuxleyManorHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /^ruxley-?manor\.co\.uk$/i.test(normalizedHost);
}

function isScotsdalesHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /(^|\.)scotsdalegardencentre\.co\.uk$/i.test(normalizedHost) || /(^|\.)scotsdales\.com$/i.test(normalizedHost);
}

function isWebbsHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /(^|\.)webbsdirect\.co\.uk$/i.test(normalizedHost);
}

function isSquiresHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /(^|\.)squiresgardencentres\.co\.uk$/i.test(normalizedHost) || /(^|\.)squires\.co\.uk$/i.test(normalizedHost);
}

function isYorkshireGardenCentresHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /(^|\.)yorkshiregardencentres\.co\.uk$/i.test(normalizedHost);
}

function isBentsHost(raw: string): boolean {
  const normalizedHost = normalizeHostname(hostFromUrl(raw) || raw);
  return /(^|\.)bents\.co\.uk$/i.test(normalizedHost);
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractVisibleHtml(html: string): string {
  const withoutNonVisualBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  return withoutNonVisualBlocks.replace(
    /<([a-z0-9-]+)([^>]*)\b(?:hidden|aria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']|class\s*=\s*["'][^"']*(?:hidden|visually-hidden|sr-only)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
}

function extractSquiresCartControls(html: string): Array<{ control: string; disabled: boolean }> {
  const controls: Array<{ control: string; disabled: boolean }> = [];
  const patterns = [/<button\b[^>]*>[\s\S]*?<\/button>/gi, /<input\b[^>]*>/gi, /<a\b[^>]*>[\s\S]*?<\/a>/gi];

  const collectControl = (controlHtml: string, textSource = controlHtml) => {
    const controlText = normalizeWhitespace(stripTags(textSource)).toLowerCase();
    if (!/\b(add\s+to\s+basket|add\s+to\s+cart|buy\s+now)\b/i.test(controlText)) return;

    const disabled =
      /\bdisabled\b/i.test(controlHtml) ||
      /aria-disabled\s*=\s*["']?true["']?/i.test(controlHtml) ||
      /\b(?:is-|btn-)?disabled\b/i.test(controlHtml) ||
      /\b(?:sold\s*out|out\s+of\s+stock|unavailable)\b/i.test(controlText);

    controls.push({ control: controlText, disabled });
  };

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const tag = match[0];
      if (tag.startsWith("<input")) {
        const valueMatch = tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i);
        collectControl(tag, valueMatch?.[1] ?? tag);
      } else {
        collectControl(tag);
      }
    }
  }

  return controls;
}

function detectSquiresStockStatus(html: string): {
  stock: "In Stock" | "Low Stock" | "Out of Stock" | "Unknown";
  diagnostics: {
    hasVisibleInStockText: boolean;
    hasVisibleLowStockText: boolean;
    hasVisibleOutOfStockText: boolean;
    hasVisibleUnavailableText: boolean;
    hasAvailabilityInStockClass: boolean;
    hasAvailabilityOutOfStockClass: boolean;
    hasEnabledAddToBasket: boolean;
    hasDisabledAddToBasket: boolean;
    hasVisibleQuantityInput: boolean;
    hasActiveBasketForm: boolean;
    hasUnavailablePurchaseState: boolean;
    stockContainerText: string;
    matchedAddToBasketControls: number;
  };
} {
  const visibleHtml = extractVisibleHtml(html);
  const visibleText = normalizeWhitespace(stripTags(visibleHtml)).toLowerCase();
  const cartControls = extractSquiresCartControls(visibleHtml);

  const stockContainerMatches = [
    ...visibleHtml.matchAll(/<[^>]*class=["'][^"']*\b(?:availability|stock|inventory|product-stock|stock-label)\b[^"']*["'][^>]*>([\s\S]*?)<\//gi)
  ];
  const stockContainerText = normalizeWhitespace(stockContainerMatches.map((match) => stripTags(match[1] ?? "")).join(" ")).toLowerCase();

  const normalizedStockText = normalizeWhitespace(`${stockContainerText} ${visibleText}`.trim());
  const hasVisibleInStockText = /\bin\s+stock\b/.test(normalizedStockText);
  const hasVisibleLowStockText = /\blow\s+stock\b|\blimited\s+stock\b|\bonly\s+\d+\s+left\b/.test(normalizedStockText);
  const hasVisibleOutOfStockText = /\bout\s+of\s+stock\b|\bsold\s+out\b/.test(normalizedStockText);
  const hasVisibleUnavailableText = /\bunavailable\b/.test(normalizedStockText);

  const hasAvailabilityInStockClass = /class\s*=\s*["'][^"']*\bavailability\b[^"']*\bin-stock\b[^"']*["']/i.test(visibleHtml);
  const hasAvailabilityOutOfStockClass =
    /class\s*=\s*["'][^"']*\bavailability\b[^"']*\b(?:out-of-stock|unavailable|sold-out)\b[^"']*["']/i.test(visibleHtml);

  const hasEnabledAddToBasket = cartControls.some((control) => !control.disabled);
  const hasDisabledAddToBasket = cartControls.some((control) => control.disabled);

  const hasVisibleQuantityInput =
    /<(?:input|select)\b[^>]*(?:name\s*=\s*["']qty|name\s*=\s*["']quantity|id\s*=\s*["'][^"']*(?:qty|quantity)|class\s*=\s*["'][^"']*(?:qty|quantity)[^"']*)[^>]*>/i.test(visibleHtml) &&
    !/<(?:input|select)\b[^>]*(?:name\s*=\s*["']qty|name\s*=\s*["']quantity|id\s*=\s*["'][^"']*(?:qty|quantity)|class\s*=\s*["'][^"']*(?:qty|quantity)[^"']*)[^>]*\bdisabled\b/i.test(visibleHtml);

  const hasActiveBasketForm =
    /<form\b[^>]*>(?=[\s\S]{0,2200}(?:add\s*to\s*(?:basket|cart)|buy\s*now))[\s\S]*?<\/form>/i.test(visibleHtml) &&
    !/<form\b[^>]*\b(?:data-available|data-product-in-stock)\s*=\s*["']?false["']?[^>]*>/i.test(visibleHtml) &&
    !/<form\b[^>]*\b(?:unavailable|sold-?out)\b[^>]*>/i.test(visibleHtml);

  const hasUnavailablePurchaseState =
    hasAvailabilityOutOfStockClass ||
    /<[^>]*class=["'][^"']*\b(?:out-of-stock|sold-out|unavailable|not-available)\b[^"']*["'][^>]*>/i.test(visibleHtml) ||
    /<form\b[^>]*\b(?:data-available|data-product-in-stock)\s*=\s*["']?false["']?[^>]*>/i.test(visibleHtml);

  const hasPositivePurchasableSignal =
    hasAvailabilityInStockClass || hasVisibleInStockText || hasVisibleLowStockText || hasEnabledAddToBasket || (hasVisibleQuantityInput && hasActiveBasketForm);
  const hasClearUnavailableSignal = hasVisibleOutOfStockText || hasVisibleUnavailableText || hasUnavailablePurchaseState || hasDisabledAddToBasket;

  if (hasClearUnavailableSignal && !hasPositivePurchasableSignal && (hasDisabledAddToBasket || hasUnavailablePurchaseState || hasAvailabilityOutOfStockClass)) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasVisibleUnavailableText,
        hasAvailabilityInStockClass,
        hasAvailabilityOutOfStockClass,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActiveBasketForm,
        hasUnavailablePurchaseState,
        stockContainerText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasVisibleLowStockText) {
    return {
      stock: "Low Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasVisibleUnavailableText,
        hasAvailabilityInStockClass,
        hasAvailabilityOutOfStockClass,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActiveBasketForm,
        hasUnavailablePurchaseState,
        stockContainerText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasAvailabilityInStockClass || hasVisibleInStockText) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasVisibleUnavailableText,
        hasAvailabilityInStockClass,
        hasAvailabilityOutOfStockClass,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActiveBasketForm,
        hasUnavailablePurchaseState,
        stockContainerText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasEnabledAddToBasket || (hasVisibleQuantityInput && hasActiveBasketForm)) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasVisibleUnavailableText,
        hasAvailabilityInStockClass,
        hasAvailabilityOutOfStockClass,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActiveBasketForm,
        hasUnavailablePurchaseState,
        stockContainerText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  if (hasClearUnavailableSignal) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasVisibleUnavailableText,
        hasAvailabilityInStockClass,
        hasAvailabilityOutOfStockClass,
        hasEnabledAddToBasket,
        hasDisabledAddToBasket,
        hasVisibleQuantityInput,
        hasActiveBasketForm,
        hasUnavailablePurchaseState,
        stockContainerText,
        matchedAddToBasketControls: cartControls.length
      }
    };
  }

  return {
    stock: "Unknown",
    diagnostics: {
      hasVisibleInStockText,
      hasVisibleLowStockText,
      hasVisibleOutOfStockText,
      hasVisibleUnavailableText,
      hasAvailabilityInStockClass,
      hasAvailabilityOutOfStockClass,
      hasEnabledAddToBasket,
      hasDisabledAddToBasket,
      hasVisibleQuantityInput,
      hasActiveBasketForm,
      hasUnavailablePurchaseState,
      stockContainerText,
      matchedAddToBasketControls: cartControls.length
    }
  };
}

function extractYorkshireCartControls(html: string): Array<{ control: string; disabled: boolean }> {
  const controls: Array<{ control: string; disabled: boolean }> = [];

  const buttonRe = /<button\b[^>]*>[\s\S]*?<\/button>/gi;
  const inputRe = /<input\b[^>]*>/gi;
  const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;

  const collectControl = (controlHtml: string, textSource = controlHtml) => {
    const controlText = normalizeWhitespace(stripTags(textSource)).toLowerCase();
    const matchesAddToCart = /\b(add\s+to\s+cart|add\s+to\s+basket|buy\s+now)\b/i.test(controlText);
    if (!matchesAddToCart) return;

    const disabled =
      /\bdisabled\b/i.test(controlHtml) ||
      /aria-disabled\s*=\s*["']?true["']?/i.test(controlHtml) ||
      /\b(?:is-|btn-)?disabled\b|\bunavailable\b|\bsold\s*out\b|\bout\s+of\s+stock\b/i.test(controlHtml) ||
      /\b(?:sold\s*out|out\s+of\s+stock|unavailable)\b/i.test(controlText);

    controls.push({ control: controlText, disabled });
  };

  for (const buttonMatch of html.matchAll(buttonRe)) {
    collectControl(buttonMatch[0]);
  }

  for (const inputMatch of html.matchAll(inputRe)) {
    const tag = inputMatch[0];
    const valueMatch = tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i);
    collectControl(tag, valueMatch?.[1] ?? tag);
  }

  for (const anchorMatch of html.matchAll(anchorRe)) {
    collectControl(anchorMatch[0]);
  }

  return controls;
}

function detectYorkshireStockStatus(html: string): {
  stock: "In Stock" | "Low Stock" | "Out of Stock" | "Unknown";
  diagnostics: {
    hasLowStockSelector: boolean;
    hasLowStockText: boolean;
    hasInStockText: boolean;
    hasExplicitOutOfStockText: boolean;
    hasExplicitUnavailableText: boolean;
    hasUnavailableFormState: boolean;
    hasEnabledAddToCart: boolean;
    hasDisabledAddToCart: boolean;
    matchedAddToCartControls: number;
  };
} {
  const visibleHtml = extractVisibleHtml(html);
  const visibleText = normalizeWhitespace(stripTags(visibleHtml)).toLowerCase();
  const cartControls = extractYorkshireCartControls(visibleHtml);

  const hasEnabledAddToCart = cartControls.some((control) => !control.disabled);
  const hasDisabledAddToCart = cartControls.some((control) => control.disabled);

  const hasLowStockSelector =
    /class\s*=\s*["'][^"']*\bproduct_inventory-low-stock-text\b[^"']*["']/i.test(visibleHtml) &&
    /\blow\s+stock\b/i.test(visibleText);
  const hasLowStockText = /\blow\s+stock\b|\blimited\s+stock\b|\bonly\s+\d+\s+left\b/i.test(visibleText);
  const hasInStockText = /\bin\s+stock\b|\bin\s+stock\s+for\s+home\s+delivery\b/i.test(visibleText);
  const hasExplicitOutOfStockText = /\bout\s+of\s+stock\b|\bsold\s+out\b/i.test(visibleText);
  const hasExplicitUnavailableText = /\bunavailable\b/.test(visibleText);
  const hasUnavailableFormState =
    /<form\b[^>]*\b(?:unavailable|sold-?out|disabled)\b[^>]*>/i.test(visibleHtml) ||
    /<form\b[^>]*\bdata-available\s*=\s*["']?false["']?[^>]*>/i.test(visibleHtml);

  const hasPositivePurchasableSignal = hasEnabledAddToCart || hasLowStockSelector || hasLowStockText || hasInStockText;
  const hasClearUnavailableState = (hasDisabledAddToCart || hasUnavailableFormState) && !hasEnabledAddToCart;

  if ((hasExplicitOutOfStockText || hasExplicitUnavailableText) && hasClearUnavailableState) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasLowStockSelector,
        hasLowStockText,
        hasInStockText,
        hasExplicitOutOfStockText,
        hasExplicitUnavailableText,
        hasUnavailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (hasLowStockSelector || hasLowStockText) {
    return {
      stock: "Low Stock",
      diagnostics: {
        hasLowStockSelector,
        hasLowStockText,
        hasInStockText,
        hasExplicitOutOfStockText,
        hasExplicitUnavailableText,
        hasUnavailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (hasInStockText) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasLowStockSelector,
        hasLowStockText,
        hasInStockText,
        hasExplicitOutOfStockText,
        hasExplicitUnavailableText,
        hasUnavailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (hasEnabledAddToCart) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasLowStockSelector,
        hasLowStockText,
        hasInStockText,
        hasExplicitOutOfStockText,
        hasExplicitUnavailableText,
        hasUnavailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (!hasPositivePurchasableSignal && (hasExplicitOutOfStockText || hasExplicitUnavailableText || hasClearUnavailableState)) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasLowStockSelector,
        hasLowStockText,
        hasInStockText,
        hasExplicitOutOfStockText,
        hasExplicitUnavailableText,
        hasUnavailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  return {
    stock: "Unknown",
    diagnostics: {
      hasLowStockSelector,
      hasLowStockText,
      hasInStockText,
      hasExplicitOutOfStockText,
      hasExplicitUnavailableText,
      hasUnavailableFormState,
      hasEnabledAddToCart,
      hasDisabledAddToCart,
      matchedAddToCartControls: cartControls.length
    }
  };
}

function extractWhitehallCartControls(html: string): Array<{ control: string; disabled: boolean }> {
  const controls: Array<{ control: string; disabled: boolean }> = [];
  const controlPatterns = [/<button\b[^>]*>[\s\S]*?<\/button>/gi, /<input\b[^>]*>/gi, /<a\b[^>]*>[\s\S]*?<\/a>/gi];

  const collectControl = (controlHtml: string, textSource = controlHtml) => {
    const controlText = normalizeWhitespace(stripTags(textSource)).toLowerCase();
    if (!/\b(add\s+to\s+cart|add\s+to\s+basket|buy\s+now|pre-?order)\b/i.test(controlText)) return;

    const classMatch = controlHtml.match(/\bclass\s*=\s*["']([^"']+)["']/i);
    const classValue = classMatch?.[1]?.toLowerCase() ?? "";
    const disabled =
      /\bdisabled\b/i.test(controlHtml) ||
      /aria-disabled\s*=\s*["']?true["']?/i.test(controlHtml) ||
      /\b(?:is-|btn-)?disabled\b/.test(classValue);

    controls.push({ control: controlText, disabled });
  };

  for (const pattern of controlPatterns) {
    for (const match of html.matchAll(pattern)) {
      const tag = match[0];
      if (tag.startsWith("<input")) {
        const valueMatch = tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i);
        collectControl(tag, valueMatch?.[1] ?? tag);
      } else {
        collectControl(tag);
      }
    }
  }

  return controls;
}

function detectWhitehallStockStatus(html: string): {
  stock: "In Stock" | "Low Stock" | "Out of Stock" | "Unknown";
  diagnostics: {
    hasVisibleInStockText: boolean;
    hasVisibleLowStockText: boolean;
    hasVisibleOutOfStockText: boolean;
    hasUnavailableFormState: boolean;
    hasAvailableFormState: boolean;
    hasEnabledAddToCart: boolean;
    hasDisabledAddToCart: boolean;
    stockContainerText: string;
    matchedAddToCartControls: number;
  };
} {
  const visibleHtml = extractVisibleHtml(html);
  const visibleText = normalizeWhitespace(stripTags(visibleHtml)).toLowerCase();
  const cartControls = extractWhitehallCartControls(visibleHtml);

  const stockContainerMatches = [...visibleHtml.matchAll(/<[^>]*class=["'][^"']*\b(?:stock-display|low-stock|stock|inventory|product-form__inventory)\b[^"']*["'][^>]*>([\s\S]*?)<\//gi)];
  const stockContainerText = normalizeWhitespace(stockContainerMatches.map((match) => stripTags(match[1] ?? "")).join(" ")).toLowerCase();

  const hasVisibleInStockText = /\bin\s+stock\b/.test(stockContainerText) || /\bin\s+stock\b/.test(visibleText);
  const hasVisibleLowStockText =
    /\blow\s+stock\b|\blimited\s+stock\b|\bonly\s+\d+\s+left\b/.test(stockContainerText) ||
    /\blow\s+stock\b|\blimited\s+stock\b|\bonly\s+\d+\s+left\b/.test(visibleText);
  const hasVisibleOutOfStockText = /\bout\s+of\s+stock\b|\bsold\s+out\b|\bunavailable\b/.test(stockContainerText || visibleText);

  const hasUnavailableFormState =
    /<form\b[^>]*\b(?:data-product-in-stock|data-available)\s*=\s*["']?false["']?[^>]*>/i.test(visibleHtml) ||
    /<form\b[^>]*\b(?:unavailable|sold-?out)\b[^>]*>/i.test(visibleHtml);
  const hasAvailableFormState =
    /<form\b[^>]*\b(?:data-product-in-stock|data-available)\s*=\s*["']?true["']?[^>]*>/i.test(visibleHtml) ||
    /<form\b[^>]*\b(?:available|in-stock)\b[^>]*>/i.test(visibleHtml);

  const hasEnabledAddToCart = cartControls.some((control) => !control.disabled);
  const hasDisabledAddToCart = cartControls.some((control) => control.disabled);

  if ((hasDisabledAddToCart || hasUnavailableFormState) && hasVisibleOutOfStockText && !hasEnabledAddToCart && !hasAvailableFormState) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasUnavailableFormState,
        hasAvailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        stockContainerText,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (hasVisibleLowStockText) {
    return {
      stock: "Low Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasUnavailableFormState,
        hasAvailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        stockContainerText,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (hasVisibleInStockText || hasAvailableFormState) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasUnavailableFormState,
        hasAvailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        stockContainerText,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (hasEnabledAddToCart && !hasUnavailableFormState) {
    return {
      stock: "In Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasUnavailableFormState,
        hasAvailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        stockContainerText,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  if (!hasEnabledAddToCart && (hasVisibleOutOfStockText || hasUnavailableFormState || hasDisabledAddToCart)) {
    return {
      stock: "Out of Stock",
      diagnostics: {
        hasVisibleInStockText,
        hasVisibleLowStockText,
        hasVisibleOutOfStockText,
        hasUnavailableFormState,
        hasAvailableFormState,
        hasEnabledAddToCart,
        hasDisabledAddToCart,
        stockContainerText,
        matchedAddToCartControls: cartControls.length
      }
    };
  }

  return {
    stock: "Unknown",
    diagnostics: {
      hasVisibleInStockText,
      hasVisibleLowStockText,
      hasVisibleOutOfStockText,
      hasUnavailableFormState,
      hasAvailableFormState,
      hasEnabledAddToCart,
      hasDisabledAddToCart,
      stockContainerText,
      matchedAddToCartControls: cartControls.length
    }
  };
}

function parseWooCommerceAmount(value: string): number | null {
  const normalized = decodeHtmlEntities(value)
    .replace(/\u00a0/g, " ")
    .replace(/£|GBP/gi, " ")
    .trim();
  const numberMatch = normalized.match(/\d[\d,]*(?:\.\d{1,2})?/);
  return numberMatch ? parseCurrencyLike(numberMatch[0]) : null;
}

function snippetAroundFirstOccurrence(html: string, token: string, radius = 120): string | null {
  const idx = html.toLowerCase().indexOf(token.toLowerCase());
  if (idx < 0) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(html.length, idx + token.length + radius);
  return html.slice(start, end).replace(/\s+/g, " ").trim();
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

    const { stock, diagnostics: stockDiagnostics } = detectWhitehallStockStatus(html);

    const salePrice = parseCurrencyLike(saleText);
    if (salePrice === null) {
      const failureMessage = stock !== "Unknown" ? "Stock detected but no valid price found" : "Whitehall sale price selector missing";
      throw new AdapterExtractionError(failureMessage, {
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: saleText ? [{ source_selector: "p.product-details-price__regular-price--sale", extracted_text: saleText, parsed: salePrice }] : [],
        accepted_value: null,
        rejected_values: saleText ? [{ source_selector: "p.product-details-price__regular-price--sale", extracted_text: saleText, parsed: salePrice }] : [],
        rejection_reasons: ["required_sale_price_selector_missing_or_invalid"],
        stock_text_found: stock !== "Unknown" ? stock : null,
        stock_diagnostics: stockDiagnostics
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
      competitor_stock_status: stock,
      result_status: stock === "Out of Stock" ? "out_of_stock" : "ok",
      match_confidence: "High",
      raw_price_text: saleText,
      extraction_source: "whitehall_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: saleText,
        source_selector: "p.product-details-price__regular-price--sale",
        stock_text_found: stock,
        stock_diagnostics: stockDiagnostics,
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: [
          { source_selector: "p.product-details-price__regular-price--sale", extracted_text: saleText, parsed: salePrice },
          ...(wasText ? [{ source_selector: "s.product-details-price__sale-full-price", extracted_text: wasText, parsed: wasPrice }] : [])
        ],
        accepted_value: salePrice,
        rejected_values: [],
        rejection_reasons: []
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
      result_status: stock === "Out of Stock" ? "out_of_stock" : "ok",
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

class GatesGardenCentreAdapter implements CompetitorAdapter {
  name = "gates-garden-centre";

  supports(url: string) {
    const host = hostFromUrl(url) || url;
    return /gatesgardencentre\.co\.uk/i.test(host);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Gates adapter failed: HTTP ${response.status}`);
    const html = await response.text();
    const htmlSignals = {
      contains_woocommerce_price_amount: /woocommerce-Price-amount/i.test(html),
      contains_product_title: /product_title/i.test(html),
      contains_ast_stock_detail: /ast-stock-detail/i.test(html),
      contains_add_to_basket: /add\s*to\s*basket/i.test(html)
    };
    const htmlSignalSnippets = {
      woocommerce_price_amount_snippet: snippetAroundFirstOccurrence(html, "woocommerce-Price-amount"),
      product_title_snippet: snippetAroundFirstOccurrence(html, "product_title"),
      ast_stock_detail_snippet: snippetAroundFirstOccurrence(html, "ast-stock-detail")
    };

    const checkedSelectors = [
      "p.price .woocommerce-Price-amount.amount",
      ".summary .price .woocommerce-Price-amount.amount",
      ".woocommerce-Price-amount.amount"
    ];

    const amountClassPattern =
      '[^"\']*(?:\\bwoocommerce-Price-amount\\b[^"\']*\\bamount\\b|\\bamount\\b[^"\']*\\bwoocommerce-Price-amount\\b)[^"\']*';

    const selectorPatterns: Array<{ selector: string; pattern: RegExp }> = [
      {
        selector: "p.price .woocommerce-Price-amount.amount",
        pattern: new RegExp(
          `<p[^>]*class=["'][^"']*\\bprice\\b[^"']*["'][^>]*>[\\s\\S]{0,2000}?<span[^>]*class=["']${amountClassPattern}["'][^>]*>([\\s\\S]*?)<\\/span>`,
          "i"
        )
      },
      {
        selector: ".summary .price .woocommerce-Price-amount.amount",
        pattern: new RegExp(
          `<[^>]*class=["'][^"']*\\bsummary\\b[^"']*["'][^>]*>[\\s\\S]{0,8000}?<[^>]*class=["'][^"']*\\bprice\\b[^"']*["'][^>]*>[\\s\\S]{0,3000}?<span[^>]*class=["']${amountClassPattern}["'][^>]*>([\\s\\S]*?)<\\/span>`,
          "i"
        )
      },
      {
        selector: ".woocommerce-Price-amount.amount",
        pattern: new RegExp(`<span[^>]*class=["']${amountClassPattern}["'][^>]*>([\\s\\S]*?)<\\/span>`, "i")
      }
    ];

    const selectorsFound: Record<string, boolean> = {};
    const candidateValues: Array<{ source_selector: string; extracted_text: string; parsed: number | null }> = [];

    for (const { selector, pattern } of selectorPatterns) {
      const match = html.match(pattern);
      const extractedText = match?.[1] ? stripTags(match[1]) : "";
      let parsed = extractedText ? parseWooCommerceAmount(extractedText) : null;
      if (parsed === null && typeof match?.index === "number") {
        const nearbyText = stripTags(html.slice(Math.max(0, match.index - 80), Math.min(html.length, match.index + 320)));
        parsed = parseGbpCurrency(nearbyText);
      }
      selectorsFound[selector] = Boolean(extractedText);
      if (extractedText || parsed !== null) {
        candidateValues.push({ source_selector: selector, extracted_text: extractedText, parsed });
      }
    }
    const hasValidCandidate = () => candidateValues.some((candidate) => candidate.parsed !== null && candidate.parsed > 0);
    if (!hasValidCandidate()) {
      const looseMatch = html.match(/<span[^>]*class=["'][^"']*\bwoocommerce-Price-amount\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
      const looseExtractedText = looseMatch?.[1] ? stripTags(looseMatch[1]) : "";
      if (looseExtractedText) {
        candidateValues.push({
          source_selector: ".woocommerce-Price-amount",
          extracted_text: looseExtractedText,
          parsed: parseWooCommerceAmount(looseExtractedText)
        });
      }
    }

    if (!hasValidCandidate() && htmlSignals.contains_woocommerce_price_amount) {
      for (const match of html.matchAll(/<[^>]*class=["'][^"']*\bwoocommerce-Price-amount\b[^"']*["'][^>]*>([\s\S]{0,200}?)<\/[^>]+>/gi)) {
        const extractedText = stripTags(match[1] ?? "");
        const hasGbpSignal = /£|&pound;|GBP/i.test(match[0] ?? "") || /£|GBP/i.test(extractedText);
        if (!extractedText || !hasGbpSignal) continue;
        const parsed = parseWooCommerceAmount(extractedText);
        candidateValues.push({
          source_selector: "woocommerce_price_amount_nearest_gbp",
          extracted_text: extractedText,
          parsed
        });
        if (parsed !== null && parsed > 0) break;
      }
    }

    const accepted = candidateValues.find((candidate) => candidate.parsed !== null && candidate.parsed > 0) ?? null;
    if (!accepted || accepted.parsed === null) {
      throw new AdapterExtractionError(
        `Gates Garden Centre price extraction failed. Selectors attempted: ${checkedSelectors.join(", ")}.`,
        {
          adapter_attempted: this.name,
          selectors_checked: checkedSelectors,
          selectors_found: selectorsFound,
          candidate_values_found: candidateValues,
          accepted_value: null,
          rejected_values: candidateValues,
          rejection_reasons: ["required_woocommerce_price_selector_missing_or_invalid"],
          parsed_hostname: hostFromUrl(input.competitorUrl),
          selected_adapter: this.name,
          html_signals: htmlSignals,
          html_signal_snippets: htmlSignalSnippets
        }
      );
    }

    const stock = /\bavailability\s*:\s*out\s+of\s+stock\b|\bout\s+of\s+stock\b/i.test(html)
      ? "Out of Stock"
      : /\bavailability\s*:\s*in\s+stock\b|\bin\s+stock\b/i.test(html)
        ? "In Stock"
        : "Unknown";

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: null,
      competitor_stock_status: stock,
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "gates_garden_centre_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: accepted.extracted_text,
        source_selector: accepted.source_selector,
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: candidateValues,
        accepted_value: accepted.parsed,
        rejected_values: candidateValues.filter((candidate) => candidate !== accepted),
        rejection_reasons: [],
        parsed_hostname: hostFromUrl(input.competitorUrl),
        selected_adapter: this.name,
        html_signals: htmlSignals,
        html_signal_snippets: htmlSignalSnippets
      }
    };
  }
}

class ScotsdalesAdapter implements CompetitorAdapter {
  name = "scotsdales";

  supports(url: string) {
    return isScotsdalesHost(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Scotsdales adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const checkedSelectors = [
      ".price-box.price-final_price .price-wrapper .price",
      ".price-container.price-final_price .price",
      "[data-price-type=\"finalPrice\"] .price",
      ".price-box .price",
      "[data-price-type=\"finalPrice\"][data-price-amount]"
    ];

    const selectorPatterns: Array<{
      selector: string;
      pattern: RegExp;
      parseFrom: "text" | "attribute";
      formatter?: (value: string) => string;
    }> = [
      {
        selector: ".price-box.price-final_price .price-wrapper .price",
        pattern:
          /<[^>]*class=["'][^"']*\bprice-box\b[^"']*\bprice-final_price\b[^"']*["'][^>]*>[\s\S]{0,1200}?<[^>]*class=["'][^"']*\bprice-wrapper\b[^"']*["'][^>]*>[\s\S]{0,800}?<[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        parseFrom: "text"
      },
      {
        selector: ".price-container.price-final_price .price",
        pattern:
          /<[^>]*class=["'][^"']*\bprice-container\b[^"']*\bprice-final_price\b[^"']*["'][^>]*>[\s\S]{0,1000}?<[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        parseFrom: "text"
      },
      {
        selector: "[data-price-type=\"finalPrice\"] .price",
        pattern:
          /<[^>]*data-price-type=["']finalPrice["'][^>]*>[\s\S]{0,800}?<[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        parseFrom: "text"
      },
      {
        selector: ".price-box .price",
        pattern:
          /<[^>]*class=["'][^"']*\bprice-box\b[^"']*["'][^>]*>[\s\S]{0,1000}?<[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        parseFrom: "text"
      },
      {
        selector: "[data-price-type=\"finalPrice\"][data-price-amount]",
        pattern: /<[^>]*data-price-type=["']finalPrice["'][^>]*data-price-amount=["']([^"']+)["'][^>]*>/i,
        parseFrom: "attribute",
        formatter: (value) => `£${value}`
      }
    ];

    const selectorsFound: Record<string, boolean> = {};
    const candidateValues: Array<{ source_selector: string; extracted_text: string; parsed: number | null }> = [];

    for (const { selector, pattern, parseFrom, formatter } of selectorPatterns) {
      const match = html.match(pattern);
      const captured = match?.[1] ? decodeHtmlEntities(match[1]).trim() : "";
      selectorsFound[selector] = Boolean(captured);
      if (!captured) continue;
      const extractedText = formatter ? formatter(captured) : stripTags(captured);
      const parsed = parseFrom === "attribute" ? parseCurrencyLike(captured) : parseGbpCurrency(extractedText);
      candidateValues.push({ source_selector: selector, extracted_text: extractedText, parsed });
    }

    const accepted = candidateValues.find((candidate) => candidate.parsed !== null && candidate.parsed > 0) ?? null;
    if (!accepted?.parsed) {
      throw new AdapterExtractionError(
        `Scotsdales price extraction failed. Selectors attempted: ${checkedSelectors.join(", ")}`,
        {
          adapter_attempted: this.name,
          selectors_checked: checkedSelectors,
          selectors_found: selectorsFound,
          candidate_values_found: candidateValues,
          accepted_value: null,
          rejected_values: candidateValues,
          rejection_reasons: ["required_magento_final_price_selector_missing_or_invalid"]
        }
      );
    }

    const stock = /\bout\s+of\s+stock\b/i.test(html)
      ? "Out of Stock"
      : /\bin\s+stock\b/i.test(html)
        ? "In Stock"
        : "Unknown";

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: null,
      competitor_stock_status: stock,
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "scotsdales_selector_adapter",
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

class WebbsAdapter implements CompetitorAdapter {
  name = "webbs";

  supports(url: string) {
    return isWebbsHost(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    const originalUrl = input.competitorUrl;
    const finalUrl = response.url || input.competitorUrl;
    const redirected = normalizeComparableUrl(originalUrl) !== normalizeComparableUrl(finalUrl);
    const redirectChain = redirected ? [originalUrl, finalUrl] : [originalUrl];

    if (response.status === 404 || response.status === 410) {
      return buildWebbsRemovedResult({
        originalUrl,
        finalUrl,
        redirectChain,
        httpStatus: response.status,
        pageClassification: "not_found",
        reason: "Product no longer available at retailer"
      });
    }

    if (!response.ok) throw new AdapterExtractionError(`Webbs adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const pageDiagnostics = classifyWebbsPage({
      html,
      originalUrl,
      finalUrl,
      httpStatus: response.status,
      redirected
    });
    const { stock: webbsStock, diagnostics: webbsStockDiagnostics } = detectWebbsStockStatus(html);

    if (pageDiagnostics.removedLikely) {
      return buildWebbsRemovedResult({
        originalUrl,
        finalUrl,
        redirectChain,
        httpStatus: response.status,
        pageClassification: pageDiagnostics.pageClassification,
        reason: pageDiagnostics.removalReason
      });
    }

    const checkedSelectors = [
      'span[data-bind*="text: price"]',
      ".f-xxlarge.f-color1",
      '[data-bind*="pricedisplay"]',
      "#pp_flex[data-pp-amount]"
    ];

    const selectorPatterns: Array<{ selector: string; pattern: RegExp }> = [
      {
        selector: 'span[data-bind*="text: price"]',
        pattern: /<span[^>]*data-bind=["'][^"']*text:\s*price[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
      },
      {
        selector: ".f-xxlarge.f-color1",
        pattern:
          /<span[^>]*class=["'][^"']*\bf-xxlarge\b[^"']*\bf-color1\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
      },
      {
        selector: '[data-bind*="pricedisplay"]',
        pattern: /<span[^>]*data-bind=["'][^"']*pricedisplay[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi
      }
    ];

    const selectorsFound: Record<string, boolean> = {};
    const candidateValues: Array<{ source_selector: string; extracted_text: string; parsed: number | null; priority: number }> = [];

    selectorPatterns.forEach(({ selector, pattern }, priority) => {
      let foundForSelector = false;
      for (const match of html.matchAll(pattern)) {
        const fragment = match[0] ?? "";
        const extractedText = stripTags(match[1] ?? "");
        const parsed = parseGbpCurrency(extractedText);
        if (!extractedText) continue;
        if (/\b(?:was|rrp|old price|save)\b/i.test(fragment)) continue;
        if (/\b(?:display\s*:\s*none|visibility\s*:\s*hidden|hidden\b|aria-hidden\s*=\s*["']true["'])/i.test(fragment)) continue;
        foundForSelector = true;
        candidateValues.push({ source_selector: selector, extracted_text: extractedText, parsed, priority });
      }
      selectorsFound[selector] = foundForSelector;
    });

    const accepted =
      candidateValues
        .filter((candidate) => candidate.parsed !== null && candidate.parsed > 0)
        .sort((a, b) => a.priority - b.priority)[0] ?? null;

    if (!accepted || accepted.parsed === null) {
      const ppAmountMatch = html.match(/<[^>]*\bid=["']pp_flex["'][^>]*\bdata-pp-amount=["']([\d.]{1,12})["'][^>]*>/i);
      const ppFallbackText = ppAmountMatch?.[1] ? `£${ppAmountMatch[1]}` : "";
      const ppFallbackParsed = ppAmountMatch?.[1] ? parseCurrencyLike(ppAmountMatch[1]) : null;
      selectorsFound["#pp_flex[data-pp-amount]"] = Boolean(ppAmountMatch?.[1]);
      if (ppFallbackText) {
        candidateValues.push({
          source_selector: "#pp_flex[data-pp-amount]",
          extracted_text: ppFallbackText,
          parsed: ppFallbackParsed,
          priority: checkedSelectors.length - 1
        });
      }

      const fallbackAccepted = ppFallbackParsed && ppFallbackParsed > 0
        ? {
            source_selector: "#pp_flex[data-pp-amount]",
            extracted_text: ppFallbackText,
            parsed: ppFallbackParsed
          }
        : null;

      if (!fallbackAccepted || fallbackAccepted.parsed === null) {
        if (!pageDiagnostics.looksLikeProductPage) {
          return buildWebbsRemovedResult({
            originalUrl,
            finalUrl,
            redirectChain,
            httpStatus: response.status,
            pageClassification: pageDiagnostics.pageClassification,
            reason: "Original URL redirected to a non-product page"
          });
        }

        if (webbsStock === "Out of Stock") {
          return {
            competitor_current_price: null,
            competitor_promo_price: null,
            competitor_was_price: null,
            competitor_stock_status: "Out of Stock",
            result_status: "out_of_stock",
            match_confidence: "Medium",
            raw_price_text: "Out of stock product page detected but no active price found",
            extraction_source: "webbs_product_page_out_of_stock",
            metadata: {
              adapter_attempted: this.name,
              original_url: originalUrl,
              final_url: finalUrl,
              redirect_chain: redirectChain,
              final_http_status: response.status,
              page_classification: pageDiagnostics.pageClassification,
              stock_diagnostics: webbsStockDiagnostics,
              selectors_checked: checkedSelectors,
              selectors_found: selectorsFound,
              candidate_values_found: candidateValues,
              result_message: "Product appears out of stock and no active price was found"
            }
          };
        }

        throw new AdapterExtractionError(
          `Webbs price extraction failed. Selectors attempted: ${checkedSelectors.join(", ")}. Candidate values: ${candidateValues.map((candidate) => `${candidate.source_selector}=${candidate.extracted_text}`).join(" | ") || "none"}`,
          {
            adapter_attempted: this.name,
            selectors_checked: checkedSelectors,
            selectors_found: selectorsFound,
            candidate_values_found: candidateValues,
            accepted_value: null,
            rejected_values: candidateValues,
            rejection_reasons: ["required_webbs_price_selector_missing_or_invalid"]
          }
        );
      }

      const fallbackStock = webbsStock === "Low Stock" ? "Limited Stock" : webbsStock;

      return {
        competitor_current_price: fallbackAccepted.parsed,
        competitor_promo_price: null,
        competitor_was_price: null,
        competitor_stock_status: fallbackStock,
        result_status: fallbackStock === "Out of Stock" ? "out_of_stock" : "ok",
        match_confidence: "Medium",
        raw_price_text: fallbackAccepted.extracted_text,
        extraction_source: "webbs_paypal_fallback",
        metadata: {
          extraction_method: "deterministic_selector_fallback",
          extracted_text: fallbackAccepted.extracted_text,
          source_selector: fallbackAccepted.source_selector,
          adapter_attempted: this.name,
          original_url: originalUrl,
          final_url: finalUrl,
          redirect_chain: redirectChain,
          final_http_status: response.status,
          page_classification: pageDiagnostics.pageClassification,
          matched_hostname: hostFromUrl(input.competitorUrl),
          normalized_hostname: normalizeHostname(hostFromUrl(input.competitorUrl) || ""),
          selectors_checked: checkedSelectors,
          selectors_found: selectorsFound,
          candidate_values_found: candidateValues,
          accepted_value: fallbackAccepted.parsed,
          stock_diagnostics: webbsStockDiagnostics,
          rejected_values: candidateValues.filter((candidate) => candidate.source_selector !== fallbackAccepted.source_selector),
          rejection_reasons: []
        }
      };
    }

    selectorsFound["#pp_flex[data-pp-amount]"] = false;
    const stock = webbsStock === "Low Stock" ? "Limited Stock" : webbsStock;

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: null,
      competitor_stock_status: stock,
      result_status: stock === "Out of Stock" ? "out_of_stock" : "ok",
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "webbs_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: accepted.extracted_text,
        source_selector: accepted.source_selector,
        adapter_attempted: this.name,
        original_url: originalUrl,
        final_url: finalUrl,
        redirect_chain: redirectChain,
        final_http_status: response.status,
        page_classification: pageDiagnostics.pageClassification,
        matched_hostname: hostFromUrl(input.competitorUrl),
        normalized_hostname: normalizeHostname(hostFromUrl(input.competitorUrl) || ""),
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: candidateValues,
        accepted_value: accepted.parsed,
        stock_diagnostics: webbsStockDiagnostics,
        rejected_values: candidateValues.filter((candidate) => candidate !== accepted),
        rejection_reasons: []
      }
    };
  }
}

class SquiresAdapter implements CompetitorAdapter {
  name = "squires";

  supports(url: string) {
    return isSquiresHost(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Squires adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const checkedSelectors = [
      ".special-price .price",
      ".price-container .special-price .price",
      ".price-container .price"
    ];

    const selectorPatterns: Array<{ selector: string; pattern: RegExp }> = [
      {
        selector: ".special-price .price",
        pattern:
          /<[^>]*class=["'][^"']*\bspecial-price\b[^"']*["'][^>]*>[\s\S]{0,500}?<[^>]*class=["'](?:[^"']*\s)?price(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\//i
      },
      {
        selector: ".price-container .special-price .price",
        pattern:
          /<[^>]*class=["'][^"']*\bprice-container\b[^"']*["'][^>]*>[\s\S]{0,1000}?<[^>]*class=["'][^"']*\bspecial-price\b[^"']*["'][^>]*>[\s\S]{0,600}?<[^>]*class=["'](?:[^"']*\s)?price(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\//i
      },
      {
        selector: ".price-container .price",
        pattern:
          /<[^>]*class=["'][^"']*\bprice-container\b[^"']*["'][^>]*>[\s\S]{0,1000}?<[^>]*class=["'](?:[^"']*\s)?price(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\//i
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
        `Squires price extraction failed. Selectors attempted: ${checkedSelectors.join(", ")}. Candidate values: ${candidateValues.map((candidate) => `${candidate.source_selector}=${candidate.extracted_text}`).join(" | ") || "none"}`,
        {
          adapter_attempted: this.name,
          selectors_checked: checkedSelectors,
          selectors_found: selectorsFound,
          candidate_values_found: candidateValues,
          accepted_value: null,
          rejected_values: candidateValues,
          rejection_reasons: ["required_special_price_selector_missing_or_invalid"]
        }
      );
    }

    const wasMatch = html.match(/<[^>]*class=["'][^"']*\bold-price\b[^"']*["'][^>]*>([\s\S]*?)<\//i);
    const wasText = wasMatch?.[1] ? stripTags(wasMatch[1]) : "";
    const wasPrice = wasText ? parseGbpCurrency(wasText) : null;

    const squiresStockDetection = detectSquiresStockStatus(html);
    const stock = squiresStockDetection.stock;

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: wasPrice,
      competitor_stock_status: stock,
      result_status: stock === "Out of Stock" ? "out_of_stock" : "ok",
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "squires_selector_adapter",
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
        stock_diagnostics: squiresStockDetection.diagnostics,
        rejected_values: candidateValues.filter((candidate) => candidate !== accepted),
        rejection_reasons: []
      }
    };
  }
}

class YorkshireGardenCentresAdapter implements CompetitorAdapter {
  name = "yorkshire-garden-centres";

  supports(url: string) {
    return isYorkshireGardenCentresHost(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });

    if (!response.ok) throw new AdapterExtractionError(`Yorkshire Garden Centres adapter failed: HTTP ${response.status}`);
    const html = await response.text();

    const checkedSelectors = [
      ".price__sale .price-item.price-item--sale",
      ".price__regular .price-item.price-item--regular",
      ".price-item.price-item--regular",
      ".price__container .price-item"
    ];

    const selectorPatterns: Array<{ selector: string; pattern: RegExp; kind: "sale" | "regular" | "fallback" }> = [
      {
        selector: ".price__sale .price-item.price-item--sale",
        pattern:
          /<[^>]*class=["'][^"']*\bprice__sale\b[^"']*["'][^>]*>[\s\S]{0,900}?<[^>]*class=["'][^"']*\bprice-item\b[^"']*\bprice-item--sale\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        kind: "sale"
      },
      {
        selector: ".price__regular .price-item.price-item--regular",
        pattern:
          /<[^>]*class=["'][^"']*\bprice__regular\b[^"']*["'][^>]*>[\s\S]{0,900}?<[^>]*class=["'][^"']*\bprice-item\b[^"']*\bprice-item--regular\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        kind: "regular"
      },
      {
        selector: ".price-item.price-item--regular",
        pattern: /<[^>]*class=["'][^"']*\bprice-item\b[^"']*\bprice-item--regular\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        kind: "regular"
      },
      {
        selector: ".price__container .price-item",
        pattern:
          /<[^>]*class=["'][^"']*\bprice__container\b[^"']*["'][^>]*>[\s\S]{0,1200}?<[^>]*class=["'][^"']*\bprice-item\b[^"']*["'][^>]*>([\s\S]*?)<\//i,
        kind: "fallback"
      }
    ];

    const selectorsFound: Record<string, boolean> = {};
    const candidateValues: Array<{ source_selector: string; extracted_text: string; parsed: number | null; kind: string }> = [];

    for (const { selector, pattern, kind } of selectorPatterns) {
      const match = html.match(pattern);
      const extractedText = match?.[1] ? stripTags(match[1]) : "";
      selectorsFound[selector] = Boolean(extractedText);
      if (!extractedText) continue;
      const parsed = parseGbpCurrency(extractedText);
      candidateValues.push({ source_selector: selector, extracted_text: extractedText, parsed, kind });
    }

    const accepted = candidateValues.find((candidate) => candidate.parsed !== null && candidate.parsed > 0) ?? null;
    if (!accepted?.parsed) {
      throw new AdapterExtractionError(
        `Yorkshire Garden Centres price extraction failed. Selectors attempted: ${checkedSelectors.join(", ")}`,
        {
          adapter_attempted: this.name,
          matched_hostname: hostFromUrl(input.competitorUrl),
          normalized_hostname: normalizeHostname(hostFromUrl(input.competitorUrl) || ""),
          selectors_checked: checkedSelectors,
          selectors_found: selectorsFound,
          candidate_values_found: candidateValues,
          accepted_value: null,
          rejected_values: candidateValues,
          rejection_reasons: ["required_shopify_price_selector_missing_or_invalid"]
        }
      );
    }

    const compareAtMatch = html.match(
      /<[^>]*class=["'][^"']*\bprice-item\b[^"']*\bprice-item--regular\b[^"']*["'][^>]*>([\s\S]*?)<\//i
    );
    const compareAtText = compareAtMatch?.[1] ? stripTags(compareAtMatch[1]) : "";
    const compareAtPrice = compareAtText ? parseGbpCurrency(compareAtText) : null;
    const wasPrice = compareAtPrice && compareAtPrice > accepted.parsed ? compareAtPrice : null;

    const { stock, diagnostics: stockDiagnostics } = detectYorkshireStockStatus(html);

    return {
      competitor_current_price: accepted.parsed,
      competitor_promo_price: null,
      competitor_was_price: wasPrice,
      competitor_stock_status: stock,
      match_confidence: "High",
      raw_price_text: accepted.extracted_text,
      extraction_source: "yorkshire_garden_centres_selector_adapter",
      metadata: {
        extraction_method: "deterministic_selector",
        extracted_text: accepted.extracted_text,
        source_selector: accepted.source_selector,
        source_kind: accepted.kind,
        adapter_attempted: this.name,
        matched_hostname: hostFromUrl(input.competitorUrl),
        normalized_hostname: normalizeHostname(hostFromUrl(input.competitorUrl) || ""),
        selectors_checked: checkedSelectors,
        selectors_found: selectorsFound,
        candidate_values_found: candidateValues,
        accepted_value: accepted.parsed,
        rejected_values: candidateValues.filter((candidate) => candidate !== accepted),
        rejection_reasons: [],
        compare_at_candidate: compareAtText ? { extracted_text: compareAtText, parsed: compareAtPrice } : null,
        stock_diagnostics: stockDiagnostics
      }
    };
  }
}


class BentsAdapter implements CompetitorAdapter {
  name = "bents-first-party";

  supports(url: string) {
    return isBentsHost(url);
  }

  async fetchPriceSignal(input: AdapterInput): Promise<AdapterResult> {
    const response = await fetch(input.competitorUrl, {
      headers: { "User-Agent": "BentsPricingTracker/1.0 (+decision-support)" },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new AdapterExtractionError(`Bents adapter failed: HTTP ${response.status}`, {
        adapter_attempted: this.name,
        requested_url: input.competitorUrl,
        http_status: response.status
      });
    }

    const html = await response.text();

    const priceContainerMatch = html.match(/<[^>]*class=["'][^"']*productView-price[^"']*["'][^>]*>[\s\S]{0,5000}?<\/[^>]+>/i);
    const priceContainer = priceContainerMatch?.[0] ?? html;

    const checkedSelectors = [
      "[data-product-price-with-tax]",
      ".productView-price .price.price--withTax",
      "button (Add to Bag - £xx.xx)",
      ".productView-price (regex fallback)",
      ".in-stock",
      ".productView-delivery, .deliveryMessage, click-and-collect hints"
    ];

    const currentCandidates: Array<{ selector: string; text: string; parsed: number | null }> = [];
    const selectorFound: Record<string, boolean> = {};

    const currentPatterns = [
      { selector: "[data-product-price-with-tax]", pattern: /<span[^>]*data-product-price-with-tax[^>]*>([\s\S]*?)<\/span>/gi },
      { selector: ".productView-price .price.price--withTax", pattern: /<[^>]*class=["'][^"']*price[^"']*price--withTax[^"']*["'][^>]*>([\s\S]*?)<\//gi }
    ];

    for (const c of currentPatterns) {
      const matches = [...html.matchAll(c.pattern)];
      selectorFound[c.selector] = matches.length > 0;
      for (const m of matches) {
        const text = stripTags(m[1] ?? "");
        const parsed = parseGbpCurrency(text);
        if (text) currentCandidates.push({ selector: c.selector, text, parsed });
      }
    }

    const addToBagMatch = html.match(/add\s*to\s*bag[^£]{0,80}(£\s?(\d{1,3}(,\d{3})*(\.\d{2})?))/i);
    selectorFound["button (Add to Bag - £xx.xx)"] = Boolean(addToBagMatch?.[1]);
    if (addToBagMatch?.[1]) {
      currentCandidates.push({
        selector: "button (Add to Bag - £xx.xx)",
        text: addToBagMatch[0],
        parsed: parseGbpCurrency(addToBagMatch[1])
      });
    }

    const containerRegexTokens = [...priceContainer.matchAll(/£\s?(\d{1,3}(,\d{3})*(\.\d{2})?)/gi)];
    selectorFound[".productView-price (regex fallback)"] = containerRegexTokens.length > 0;
    for (const token of containerRegexTokens) {
      const text = token[0];
      currentCandidates.push({
        selector: ".productView-price (regex fallback)",
        text,
        parsed: parseGbpCurrency(text)
      });
    }

    const acceptedCurrent = currentCandidates.find((c) => c.parsed !== null && c.parsed > 0) ?? null;

    const allPriceTokens = [...priceContainer.matchAll(/(?:£|&pound;|GBP)\s?[\d,.]{1,12}/gi)]
      .map((m) => ({ text: stripTags(m[0]), parsed: parseGbpCurrency(m[0]) }))
      .filter((v) => v.parsed !== null) as Array<{ text: string; parsed: number }>;;
    const sortedUnique = [...new Set(allPriceTokens.map((v) => v.parsed))].sort((a, b) => b - a);

    const current = acceptedCurrent?.parsed ?? null;
    const was = current === null ? null : (sortedUnique.find((v) => v > current) ?? null);
    const promo = current !== null && was !== null && was > current ? current : null;

    const savingsMatch = priceContainer.match(/save\s*(?:£|&pound;|GBP)\s*[\d,.]{1,12}/i);
    const savingsText = savingsMatch ? stripTags(savingsMatch[0]) : null;

    const rrpMatch = priceContainer.match(/(?:rrp|was)\s*(?:£|&pound;|GBP)\s*[\d,.]{1,12}/i);
    const rrpText = rrpMatch ? stripTags(rrpMatch[0]) : null;

    const inStockMatch = html.match(/<[^>]*class=["'][^"']*\bin-stock\b[^"']*["'][^>]*>([\s\S]*?)<\//i);
    selectorFound[".in-stock"] = Boolean(inStockMatch?.[1]);
    const stockText = inStockMatch?.[1] ? stripTags(inStockMatch[1]) : stripTags(priceContainer);
    const stock = /out\s+of\s+stock|sold\s+out|unavailable/i.test(stockText)
      ? "Out of Stock"
      : /in\s+stock|available/i.test(stockText)
        ? "In Stock"
        : "Unknown";

    const availabilityMatches = [...html.matchAll(/(?:click\s*&\s*collect[^<]{0,120}|usually ready[^<]{0,120}|delivery[^<]{0,120})/gi)]
      .slice(0, 6)
      .map((m) => stripTags(m[0]))
      .filter(Boolean);
    selectorFound[".productView-delivery, .deliveryMessage, click-and-collect hints"] = availabilityMatches.length > 0;

    if (current === null) {
      throw new AdapterExtractionError(`Bents adapter could not extract current price. Selectors attempted: ${checkedSelectors.join(", ")}`, {
        adapter_attempted: this.name,
        selectors_checked: checkedSelectors,
        selectors_found: selectorFound,
        candidate_values_found: currentCandidates,
        availability_hints: availabilityMatches,
        requested_url: input.competitorUrl,
        http_status: response.status,
        primary_selector_matched: selectorFound["[data-product-price-with-tax]"] || selectorFound[".productView-price .price.price--withTax"],
        fallback_selector_matched: selectorFound["button (Add to Bag - £xx.xx)"] || selectorFound[".productView-price (regex fallback)"]
      });
    }

    return {
      competitor_current_price: current,
      competitor_promo_price: promo,
      competitor_was_price: was,
      competitor_stock_status: stock,
      match_confidence: "High",
      raw_price_text: acceptedCurrent?.text ?? String(current),
      extraction_source: "bents_dom_adapter",
      metadata: {
        adapter_priority: "first_party",
        extraction_method: "bents_product_page_dom",
        selectors_checked: checkedSelectors,
        selectors_found: selectorFound,
        candidate_values_found: currentCandidates,
        accepted_selector: acceptedCurrent?.selector ?? null,
        requested_url: input.competitorUrl,
        http_status: response.status,
        primary_selector_matched: selectorFound["[data-product-price-with-tax]"] || selectorFound[".productView-price .price.price--withTax"],
        fallback_selector_matched: selectorFound["button (Add to Bag - £xx.xx)"] || selectorFound[".productView-price (regex fallback)"],
        parsed_current_price: current,
        parsed_stock_state: stock,
        parsed_was_price: was,
        parsed_promo_price: promo,
        savings_text: savingsText,
        rrp_text: rrpText,
        availability_messages: availabilityMatches
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
    if (/gatesgardencentre\.co\.uk/i.test(host)) return false;
    if (/charlies\.co\.uk/i.test(host)) return false;
    if (/whitehallgardencentre\.co\.uk|whitehall/i.test(host)) return false;
    if (isRuxleyManorHost(host)) return false;
    if (isScotsdalesHost(host)) return false;
    if (isWebbsHost(host)) return false;
    if (isSquiresHost(host)) return false;
    if (isYorkshireGardenCentresHost(host)) return false;
    if (isBentsHost(host)) return false;
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
  new BentsAdapter(),
  new CharliesAdapter(),
  new WhitehallAdapter(),
  new GardenFurnitureWorldAdapter(),
  new GatesGardenCentreAdapter(),
  new RuxleyManorAdapter(),
  new ScotsdalesAdapter(),
  new WebbsAdapter(),
  new SquiresAdapter(),
  new YorkshireGardenCentresAdapter(),
  new RetailerPlaceholderAdapter("placeholder-bq", /b\&?q|diy/i),
  new RetailerPlaceholderAdapter("placeholder-homebase", /homebase/i),
  new GenericHtmlPriceExtractorAdapter(),
  new MockCompetitorAdapter()
];

export function selectAdapter(competitorUrl: string): CompetitorAdapter {
  return adapters.find((adapter) => adapter.supports(competitorUrl)) ?? new MockCompetitorAdapter();
}
