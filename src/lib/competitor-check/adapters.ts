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
      const snippets = [
        ...html.matchAll(/(?:£|&pound;|GBP)\s?([\d,.]{1,12})/gi),
        ...html.matchAll(/"price"\s*[:=]\s*"?([\d.]{1,12})"?/gi),
        ...html.matchAll(/content="([\d.]{1,12})"\s*itemprop="price"/gi)
      ];

      const candidatePrices = snippets
        .map((m) => parseCurrencyLike(m[0] ?? m[1] ?? ""))
        .filter((v): v is number => v !== null)
        .filter((v) => v > 0.1 && v < 10000);

      const uniquePrices = [...new Set(candidatePrices)];
      const current = uniquePrices[0] ?? null;
      const promo = uniquePrices.find((v) => current !== null && v < current) ?? null;
      const was = uniquePrices.find((v) => current !== null && v > current) ?? null;

      return {
        competitor_current_price: current,
        competitor_promo_price: promo,
        competitor_was_price: was,
        competitor_stock_status: /out of stock|sold out/i.test(html) ? "Out of Stock" : "In Stock",
        match_confidence: current ? (promo || was ? "Medium" : "Low") : "Needs review",
        raw_price_text: snippets[0]?.[0]?.slice(0, 120),
        extraction_source: "html_regex",
        metadata: { candidate_count: uniquePrices.length }
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
  new RetailerPlaceholderAdapter("placeholder-bq", /b\&?q|diy/i),
  new RetailerPlaceholderAdapter("placeholder-homebase", /homebase/i),
  new GenericHtmlPriceExtractorAdapter(),
  new MockCompetitorAdapter()
];

export function selectAdapter(competitorUrl: string): CompetitorAdapter {
  return adapters.find((adapter) => adapter.supports(competitorUrl)) ?? new MockCompetitorAdapter();
}
