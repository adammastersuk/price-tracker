import test from "node:test";
import assert from "node:assert/strict";

import { selectAdapter } from "./adapters";
import { classifyAdapterOutcome } from "./classification";

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
  sku: "SKU-BGC",
  competitorUrl: "https://www.britishgardencentres.com/shop/products/ooni-karu-12.html",
  productName: "Ooni Karu 12",
  brand: "Ooni"
};

function pdpBody(content: string): string {
  return `
    <html><body>
      <div id="singleProductInfo">
        <h1>Ooni Karu 12</h1>
        <p class="rrp-price">Was £299.00</p>
        <h2 class="fs-30 text-tertiary lh-1 fw-bold">Now £199.00</h2>
        <form method="POST" name="buyquantity">
          <button id="AddToBasketButton" type="submit"><span>Add to Cart</span></button>
        </form>
        ${content}
      </div>
    </body></html>
  `;
}

test("British Garden Centres: valid in-stock PDP picks current price and in-stock state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: pdpBody(`<div>Available for Home Delivery</div>`)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(adapter.name, "british-garden-centres");
  assert.equal(result.competitor_current_price, 199);
  assert.equal(result.competitor_was_price, 299);
  assert.equal(result.competitor_stock_status, "In Stock");
});

test("British Garden Centres: current price is selected over old price", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: pdpBody(`<div class="pricing">Was £299.00</div>`)
  });

  const result = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  assert.equal(result.competitor_current_price, 199);
  assert.equal(result.competitor_was_price, 299);
});

test("British Garden Centres: large numeric noise is not selected as current product price", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: pdpBody(`
      <div>Finance from £2,000.00 over 48 months</div>
      <div>Order over £1,750.00 for free perks</div>
      <div>Available for Home Delivery</div>
    `)
  });

  const result = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  assert.equal(result.competitor_current_price, 199);
});

test("British Garden Centres: explicit out-of-stock PDP maps to out_of_stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: pdpBody(`
      <div>Out of Stock</div>
      <button id="AddToBasketButton" type="submit" disabled>Add to Cart</button>
    `)
  });

  const fetched = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  const classified = classifyAdapterOutcome(fetched);

  assert.equal(fetched.competitor_stock_status, "Out of Stock");
  assert.equal(classified.runStatus, "success");
  assert.equal(classified.availabilityStatus, "out_of_stock");
});

test("British Garden Centres: redirected non-product page maps to removed/url_unavailable", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://www.britishgardencentres.com/search",
    body: `<html><body><h1>Search</h1><p>No products found</p></body></html>`
  });

  const fetched = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  const classified = classifyAdapterOutcome(fetched);

  assert.equal(fetched.result_status, "removed");
  assert.equal(classified.runStatus, "success");
  assert.equal(classified.availabilityStatus, "url_unavailable");
});

test("British Garden Centres: blocked response is failed/unknown and not url_unavailable", async () => {
  mockFetchOnce({
    status: 403,
    url: baseInput.competitorUrl,
    body: `<html><body><h1>Access Denied</h1><p>Please complete the challenge</p></body></html>`
  });

  const fetched = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  const classified = classifyAdapterOutcome(fetched);

  assert.equal(fetched.result_status, "adapter_error");
  assert.equal(classified.runStatus, "failed");
  assert.equal(classified.availabilityStatus, "unknown");
});

test("British Garden Centres: hidden out-of-stock text does not override visible purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: pdpBody(`
      <div>Available for Home Delivery</div>
      <span hidden>Out of Stock</span>
      <template><p>Out of Stock</p></template>
    `)
  });

  const fetched = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  assert.equal(fetched.competitor_stock_status, "In Stock");
});
