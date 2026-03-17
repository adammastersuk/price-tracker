import test from "node:test";
import assert from "node:assert/strict";

import { shouldOverrideSuspiciousRetention } from "./runner";
import type { AdapterResult } from "./adapters";

function makeResult(input: Partial<AdapterResult>): AdapterResult {
  return {
    competitor_current_price: 199,
    competitor_promo_price: null,
    competitor_was_price: 299,
    competitor_stock_status: "In Stock",
    result_status: "ok",
    match_confidence: "High",
    raw_price_text: "Now £199.00",
    extraction_source: "british_garden_centres_adapter",
    metadata: {
      selected_price_reason: "now_label_near_purchase_controls",
      selected_price_candidate: { value: 199 },
      rejected_price_candidates: [{ value: 2000, rejectionReason: "finance_or_payment_context" }]
    },
    ...input
  };
}

test("override: previous suspicious baseline + high-confidence BGC extraction clears large-delta rejection", () => {
  const decision = shouldOverrideSuspiciousRetention({
    reasons: ["Large delta vs previous checked competitor price."],
    fetched: makeResult({ competitor_current_price: 199 }),
    previousLastCheckStatus: "suspicious",
    previousSuspiciousFlag: true,
    previousExtractionMetadata: { trust_rejected: true }
  });

  assert.equal(decision.override, true);
  assert.deepEqual(decision.filteredReasons, []);
});

test("override: does not apply when new extraction is low confidence", () => {
  const decision = shouldOverrideSuspiciousRetention({
    reasons: ["Large delta vs previous checked competitor price."],
    fetched: makeResult({ match_confidence: "Low" }),
    previousLastCheckStatus: "suspicious",
    previousSuspiciousFlag: true,
    previousExtractionMetadata: { trust_rejected: true }
  });

  assert.equal(decision.override, false);
  assert.equal(decision.filteredReasons.length, 1);
});

test("override: does not apply when previous baseline was not suspicious", () => {
  const decision = shouldOverrideSuspiciousRetention({
    reasons: ["Large delta vs previous checked competitor price."],
    fetched: makeResult({}),
    previousLastCheckStatus: "success",
    previousSuspiciousFlag: false,
    previousExtractionMetadata: { trust_rejected: false }
  });

  assert.equal(decision.override, false);
  assert.equal(decision.filteredReasons.length, 1);
});

test("override: keeps non-delta suspicious reasons in place", () => {
  const decision = shouldOverrideSuspiciousRetention({
    reasons: [
      "Large delta vs previous checked competitor price.",
      "Extracted value is implausible against Bents product price context."
    ],
    fetched: makeResult({}),
    previousLastCheckStatus: "suspicious",
    previousSuspiciousFlag: true,
    previousExtractionMetadata: { trust_rejected: true }
  });

  assert.equal(decision.override, false);
  assert.deepEqual(decision.filteredReasons, ["Extracted value is implausible against Bents product price context."]);
});
