import test from "node:test";
import assert from "node:assert/strict";

import { selectAdapter } from "./adapters";

type MockResponseInit = {
  status: number;
  url: string;
  body?: string;
};

function mockFetchOnce(responseInit: MockResponseInit) {
  globalThis.fetch = (async () => {
    const body = responseInit.body ?? "";
    return {
      ok: responseInit.status >= 200 && responseInit.status < 300,
      status: responseInit.status,
      url: responseInit.url,
      text: async () => body
    } as Response;
  }) as typeof fetch;
}

const baseInput = {
  sku: "SKU-1",
  competitorUrl: "https://www.webbsdirect.co.uk/smart-garden-water-feature-omega-cascade/",
  productName: "Omega Cascade",
  brand: "Smart Garden"
};

test("Webbs: redirect from product URL to category is classified as removed", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://www.webbsdirect.co.uk/garden-water-features/",
    body: "<html><head><title>Garden Water Features</title></head><body><h1>Garden Water Features</h1></body></html>"
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "removed");
  assert.equal(result.extraction_source, "webbs_removed_product");
});

test("Webbs: 404/410 is classified as removed", async () => {
  mockFetchOnce({
    status: 404,
    url: baseInput.competitorUrl,
    body: "<html><body>Not found</body></html>"
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "removed");
});

test("Webbs: harmless redirect to same product URL still scrapes", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://webbsdirect.co.uk/smart-garden-water-feature-omega-cascade/",
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <span data-bind="text: price">£199.99</span>
          <button>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "ok");
  assert.equal(result.competitor_current_price, 199.99);
});

test("Webbs: product-like page with missing selector data throws adapter extraction error", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <button>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  await assert.rejects(async () => {
    await adapter.fetchPriceSignal(baseInput);
  }, /Webbs price extraction failed/);
});
