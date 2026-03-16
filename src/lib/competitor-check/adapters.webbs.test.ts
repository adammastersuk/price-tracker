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


test("Webbs: visible In Stock + enabled Add To Basket resolves in stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <span data-bind="text: price">£199.99</span>
          <div class="stock-label"> In   Stock </div>
          <div class="purchase-block"><input name="quantity" value="1" /><button>Add To Basket</button></div>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Webbs: enabled purchase CTA fallback should not be out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <span data-bind="text: price">£159.00</span>
          <button type="submit">Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Webbs: visible Out of Stock + disabled purchase CTA resolves out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <span data-bind="text: price">£120.00</span>
          <div class="stock-display">Out of Stock</div>
          <button disabled>Add To Basket</button>
          <form data-available="false"></form>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
});

test("Webbs: conflicting DOM text favors visible purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <span data-bind="text: price">£131.00</span>
          <div class="stock-display">In Stock</div>
          <template><div>Out of Stock</div></template>
          <span hidden>Out of Stock</span>
          <button>Add To Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Webbs: hidden alternate buy-state containers do not override active state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <head><script type="application/ld+json">{"@type":"Product"}</script></head>
        <body>
          <h1>Omega Cascade</h1>
          <span data-bind="text: price">£101.00</span>
          <div class="stock-label">In Stock</div>
          <div style="display:none" class="out-of-stock">Out of Stock <button disabled>Add To Basket</button></div>
          <div class="buy-live"><input id="qty" value="1" /><button>Add To Basket</button></div>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});
