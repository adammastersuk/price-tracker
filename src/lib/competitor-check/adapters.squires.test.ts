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
  sku: "SKU-SQ",
  competitorUrl: "https://www.squiresgardencentres.co.uk/products/sample-product",
  productName: "Sample Product",
  brand: "Sample Brand"
};

function buildBody(content: string): string {
  return `
    <html>
      <body>
        <div class="price-container">
          <span class="special-price"><span class="price">£29.99</span></span>
        </div>
        ${content}
      </body>
    </html>
  `;
}

test("Squires: visible in-stock + enabled add-to-basket resolves in stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="availability in-stock">In Stock</div>
      <form class="product-form available">
        <input type="number" name="qty" value="1" />
        <button type="submit">Add to Basket</button>
      </form>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Squires: enabled add-to-basket fallback is not out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="purchase-actions">
        <button type="submit">Add to Basket</button>
      </div>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.notEqual(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Squires: explicit out-of-stock + disabled CTA resolves out of stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="availability out-of-stock">Out of Stock</div>
      <form data-available="false">
        <button type="submit" disabled>Add to Basket</button>
      </form>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
});

test("Squires: hidden/commented unavailable markup does not override purchasable state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <div class="availability in-stock">  In   Stock  </div>
      <!-- <div class="availability out-of-stock">Out of Stock</div> -->
      <div hidden>Unavailable</div>
      <template><p>Out of Stock</p></template>
      <form class="basket-form available">
        <input type="number" id="quantity" value="1" />
        <button type="submit">Add to Basket</button>
      </form>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
});

test("Squires: valid PDP with visible availability and active buy controls is in stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: buildBody(`
      <h1>Sample Product</h1>
      <div class="availability in-stock">In Stock</div>
      <div class="home-delivery">Home Delivery</div>
      <form class="basket-form available">
        <select name="quantity"><option>1</option></select>
        <button type="submit">Add to Basket</button>
      </form>
    `)
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
  assert.equal(result.result_status, "ok");
});
