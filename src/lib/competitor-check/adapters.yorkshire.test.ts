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
  sku: "SKU-2",
  competitorUrl: "https://www.yorkshiregardencentres.co.uk/products/sample-product",
  productName: "Sample Product",
  brand: "Sample Brand"
};

function buildBody(content: string): string {
  return `
    <html>
      <body>
        <div class="price__regular">
          <span class="price-item price-item--regular">£29.99</span>
        </div>
        ${content}
      </body>
    </html>
  `;
}

test("Yorkshire: low stock badge + enabled add-to-cart is not out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <p class="product_inventory-low-stock-text">LOW STOCK</p>
      <button type="submit">Add to cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.competitor_stock_status, "Low Stock");
});

test("Yorkshire: in-stock delivery text + enabled add-to-cart is not out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <p>IN STOCK FOR HOME DELIVERY IN 3–5 WORKING DAYS</p>
      <button type="submit">Add to cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Yorkshire: explicit out-of-stock text + disabled add-to-cart is out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <p>Out of stock</p>
      <button type="submit" disabled>Add to cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
});

test("Yorkshire: conflicting signals favor purchasable state when add-to-cart is enabled", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <p>Out of stock</p>
      <p>IN STOCK FOR HOME DELIVERY IN 3–5 WORKING DAYS</p>
      <button type="submit">Add to cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.competitor_stock_status, "In Stock");
});
