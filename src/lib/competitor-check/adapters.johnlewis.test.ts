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
  sku: "SKU-JL-1",
  competitorUrl: "https://www.johnlewis.com/acme-lamp/p1234567",
  productName: "Acme Lamp",
  brand: "Acme"
};

test("John Lewis: valid PDP with visible in-stock purchase area extracts price and stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Acme Lamp</h1>
          <div data-testid="product:basket:price">£299.00</div>
          <div data-testid="product:basket:stock">Currently in stock online</div>
          <button>Add to basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_current_price, 299);
  assert.equal(result.competitor_stock_status, "In Stock");
  assert.equal(result.result_status, "ok");
});

test("John Lewis: explicit out-of-stock + disabled CTA maps out_of_stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <div data-testid="product:basket:price">£299.00</div>
          <div data-testid="product:basket:stock">Out of stock</div>
          <button disabled>Add to basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.result_status, "out_of_stock");
});

test("John Lewis: redirected removed URL to non-product page maps removed/url_unavailable", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://www.johnlewis.com/search?text=lamp",
    body: "<html><body><h1>Search results</h1></body></html>"
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "removed");
  assert.equal(result.competitor_stock_status, "URL Unavailable");
});

test("John Lewis: same-product redirect remains valid product", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://johnlewis.com/acme-lamp/p1234567",
    body: `
      <html>
        <body>
          <div data-testid="product:basket:price">£199.99</div>
          <div data-testid="product:basket:stock">Currently in stock online</div>
          <button>Add to basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "ok");
  assert.equal(result.competitor_current_price, 199.99);
});

test("John Lewis: prefers purchase-area test-id price over stray text", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <div>Finance from £9.99 per month</div>
          <div data-testid="product:basket:price">£299.00</div>
          <div data-testid="product:basket:stock">Currently in stock online</div>
          <button>Add to basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_current_price, 299);
  assert.equal(result.raw_price_text, "£299.00");
});

test("John Lewis: hidden irrelevant out-of-stock text does not override visible purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <div data-testid="product:basket:price">£299.00</div>
          <div data-testid="product:basket:stock">Currently in stock online</div>
          <template><div>Out of stock</div><button disabled>Add to basket</button></template>
          <span hidden>Out of stock</span>
          <button>Add to basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
  assert.equal(result.result_status, "ok");
});
