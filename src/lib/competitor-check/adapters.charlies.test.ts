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
  sku: "SKU-CH",
  competitorUrl: "https://www.charlies.co.uk/sample-product/",
  productName: "Sample Product",
  brand: "Sample Brand"
};

function buildBody(content: string): string {
  return `
    <html>
      <body>
        <h1>Sample Product</h1>
        <span data-test-id="product-grid-product-price" data-product-price-with-tax>£49.99</span>
        ${content}
      </body>
    </html>
  `;
}

test("Charlies: visible In stock + enabled ADD TO BASKET resolves in stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-message"> In   stock </div>
      <input id="form-action-addToCart" type="submit" value="ADD TO BASKET" />
      <input id="qty[]" name="qty[]" type="number" value="1" />
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Charlies: enabled add-to-cart fallback should not be unknown", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="purchase-area">
        <input id="form-action-addToCart" type="submit" value="ADD TO BASKET" />
      </div>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Unknown");
  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Charlies: explicit visible Out of stock + disabled CTA resolves out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-message">Out of stock</div>
      <input id="form-action-addToCart" type="submit" value="ADD TO BASKET" disabled />
      <form data-available="false"></form>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
});

test("Charlies: hidden or aria-hidden alternate text does not override visible purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-message">In stock</div>
      <div hidden>Out of stock</div>
      <p aria-hidden="true">Unavailable</p>
      <input id="form-action-addToCart" type="submit" value="ADD TO BASKET" />
      <input id="qty[]" name="qty[]" type="number" value="1" />
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Charlies: valid PDP with visible stock message + active buy controls resolves in stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-message">In stock</div>
      <form class="productView-details" data-available="true">
        <input id="qty[]" name="qty[]" type="number" value="1" />
        <input id="form-action-addToCart" type="submit" value="ADD TO BASKET" />
      </form>
      <span class="help-text" aria-hidden="true">Currently unavailable</span>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});
