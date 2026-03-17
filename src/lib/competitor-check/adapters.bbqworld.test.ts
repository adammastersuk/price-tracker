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
  sku: "SKU-BBQ-1",
  competitorUrl: "https://www.bbqworld.co.uk/ooni-karu-12-multi-fuel-pizza-oven.asp",
  productName: "Ooni Karu 12 Multi-Fuel Pizza Oven",
  brand: "Ooni"
};

test("BBQ World: valid in-stock PDP extracts current price and stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <h1>Ooni Karu 12 Multi-Fuel Pizza Oven</h1>
          <table>
            <tr>
              <td><strong><font color="red">£229.00</font></strong></td>
            </tr>
            <tr><td>In Stock : Yes</td></tr>
            <tr><td>Currently in stock online - More than 50 available</td></tr>
          </table>
          <button>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_current_price, 229);
  assert.equal(result.competitor_stock_status, "In Stock");
  assert.equal(result.result_status, "ok");
});

test("BBQ World: valid PDP with explicit out-of-stock messaging maps out_of_stock", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <h1>Ooni Karu 12 Multi-Fuel Pizza Oven</h1>
          <table>
            <tr><td><strong><font color="red">£229.00</font></strong></td></tr>
            <tr><td>In Stock : No</td></tr>
            <tr><td>Out of stock</td></tr>
          </table>
          <button disabled>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "Out of Stock");
  assert.equal(result.result_status, "out_of_stock");
});

test("BBQ World: redirected removed URL to non-product page maps removed/url_unavailable", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://www.bbqworld.co.uk/search-results.asp?search=ooni",
    body: "<html><body><h1>Search results</h1></body></html>"
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "removed");
  assert.equal(result.competitor_stock_status, "URL Unavailable");
});

test("BBQ World: same-product redirect remains valid product", async () => {
  mockFetchOnce({
    status: 200,
    url: "https://bbqworld.co.uk/ooni-karu-12-multi-fuel-pizza-oven.asp",
    body: `
      <html>
        <body>
          <h1>Ooni Karu 12 Multi-Fuel Pizza Oven</h1>
          <table>
            <tr><td><strong><font color="red">£229.00</font></strong></td></tr>
            <tr><td>In Stock : Yes</td></tr>
          </table>
          <button>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.result_status, "ok");
  assert.equal(result.competitor_current_price, 229);
});

test("BBQ World: price extraction prefers live sale/current price over RRP", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <div>RRP £399.00</div>
          <table>
            <tr><td><strong><font color="red">£229.00</font></strong></td></tr>
            <tr><td>In Stock : Yes</td></tr>
          </table>
          <button>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_current_price, 229);
});

test("BBQ World: hidden irrelevant out-of-stock text does not override visible purchase-area stock state", async () => {
  mockFetchOnce({
    status: 200,
    url: baseInput.competitorUrl,
    body: `
      <html>
        <body>
          <table>
            <tr><td><strong><font color="red">£229.00</font></strong></td></tr>
            <tr><td>In Stock : Yes</td></tr>
          </table>
          <template><div>In Stock : No</div><button disabled>Add to Basket</button></template>
          <span hidden>Out of stock</span>
          <button>Add to Basket</button>
        </body>
      </html>
    `
  });

  const adapter = selectAdapter(baseInput.competitorUrl);
  const result = await adapter.fetchPriceSignal(baseInput);

  assert.equal(result.competitor_stock_status, "In Stock");
  assert.equal(result.result_status, "ok");
});

test("John Lewis is no longer selected; BBQ World is selected for bbqworld host", () => {
  const bbqAdapter = selectAdapter("https://www.bbqworld.co.uk/sample-product.asp");
  assert.equal(bbqAdapter.name, "bbq-world");

  const johnLewisAdapter = selectAdapter("https://www.johnlewis.com/acme/p123");
  assert.notEqual(johnLewisAdapter.name, "john-lewis");
});
