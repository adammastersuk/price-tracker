import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "./parse";

test("import parse: Bents-only row succeeds when competitor fields are blank", () => {
  const csv = [
    "SKU,product_name,Bents_price,Bents_URL,competitor_name,competitor_URL,cost",
    "STOWAT0125,Smart Solar Genoa Cascade Solar Water Feature,89.99,https://www.bents.co.uk/p/stowat0125,,,42.00"
  ].join("\n");

  const parsed = parseCsv(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].sku, "STOWAT0125");
});

test("import parse: missing required Bents field fails validation", () => {
  const csv = [
    "SKU,product_name,Bents_price,Bents_URL",
    "STOWAT0125,Smart Solar Genoa Cascade Solar Water Feature,,https://www.bents.co.uk/p/stowat0125"
  ].join("\n");

  const parsed = parseCsv(csv);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.skipped, 1);
  assert.match(parsed.errors[0] ?? "", /Bents_price/);
});
