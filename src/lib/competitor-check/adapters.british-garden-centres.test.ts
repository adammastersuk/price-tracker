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

test("British Garden Centres: old Was price does not override current price", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: pdpBody(`<div class="pricing">Was £299.00</div>`)
  });

  const result = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  assert.equal(result.competitor_current_price, 199);
  assert.equal(result.competitor_was_price, 299);
});

test("British Garden Centres: visible product price beats PayPal threshold £2000", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://www.britishgardencentres.com/shop/products/ooni-karu-2.html",
    body: `
      <html><body>
        <div id="singleProductInfo">
          <h1>Ooni Karu 2</h1>
          <h2 class="fs-30 text-tertiary lh-1 fw-bold">£349.00</h2>
          <form method="POST" name="buyquantity">
            <button id="AddToBasketButton" type="submit"><span>Add to Cart</span></button>
          </form>
          <div class="paypal-message">Interest free payments available on orders between £30 - £2000 with PayPal</div>
          <div>Available for Home Delivery</div>
        </div>
      </body></html>
    `
  });

  const result = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  const rejected = (result.metadata?.rejected_price_candidates as Array<{ value: number; rejectionReason: string }> | undefined) ?? [];

  assert.equal(result.competitor_current_price, 349);
  assert.ok(rejected.some((candidate) => candidate.value === 2000));
});

test("British Garden Centres: finance-only numeric noise must not be selected", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html><body>
        <div id="singleProductInfo">
          <h1>Ooni Karu 12</h1>
          <form method="POST" name="buyquantity">
            <button id="AddToBasketButton" type="submit"><span>Add to Cart</span></button>
          </form>
          <div class="paypal-message">Interest free payments available on orders between £30 - £2000 with PayPal</div>
        </div>
      </body></html>
    `
  });

  await assert.rejects(async () => selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput), /price extraction failed/i);
});

test("British Garden Centres: broader fallback still rejects finance threshold context", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html><body>
        <h1>Ooni Karu 12</h1>
        <div class="summary">Our price is £349.00</div>
        <div class="paypal-message">Interest free payments available on orders between £30 - £2000 with PayPal</div>
        <button>Add to Cart</button>
      </body></html>
    `
  });

  const result = await selectAdapter(baseInput.competitorUrl).fetchPriceSignal(baseInput);
  assert.equal(result.competitor_current_price, 349);
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
