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
  sku: "SKU-WH",
  competitorUrl: "https://www.whitehallgardencentre.co.uk/products/sample-product",
  productName: "Sample Product",
  brand: "Sample Brand"
};

function buildBody(content: string): string {
  return `
    <html>
      <body>
        <p class="product-details-price__regular-price--sale">£29.99</p>
        <s class="product-details-price__sale-full-price">£39.99</s>
        ${content}
      </body>
    </html>
  `;
}

test("Whitehall: visible in stock + enabled add-to-cart resolves in stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-display">In Stock</div>
      <button type="submit">Add to Cart</button>
      <span hidden>Out Of Stock</span>
      <button data-oos-text="Out Of Stock" data-pre-order-text="pre-order available">Add to Cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Whitehall: enabled add-to-cart fallback should not be unknown", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="product-form">
        <button type="submit">Add to Cart</button>
      </div>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Unknown");
  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Whitehall: explicit out-of-stock + disabled add-to-cart resolves out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-display">Out of Stock</div>
      <button type="submit" disabled>Add to Cart</button>
      <form data-product-in-stock="false"></form>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
});

test("Whitehall: conflicting signals favor visible purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="stock-display">In Stock</div>
      <span hidden>Out Of Stock</span>
      <template><p>Out Of Stock</p></template>
      <button type="submit">Add to Cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Whitehall: attribute-only oos strings do not override purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <form data-product-in-stock="true"></form>
      <button type="submit" data-unavailable-text="Out Of Stock" data-oos-text="Out Of Stock">Add to Cart</button>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});
