import { TrackedProductRow } from "@/types/pricing";

export interface CompetitorAdapter {
  name: string;
  fetchPriceSignal: (sku: string, competitorUrl: string) => Promise<Partial<TrackedProductRow>>;
}

export class MockCompetitorAdapter implements CompetitorAdapter {
  name = "MockAdapter";
  async fetchPriceSignal() {
    return { competitorCurrentPrice: 99.99, competitorStockStatus: "In Stock", matchConfidence: "Medium" };
  }
}
