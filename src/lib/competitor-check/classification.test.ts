import test from "node:test";
import assert from "node:assert/strict";

import { classifyAdapterOutcome, isInStockForComparison, listingSortWeight } from "./classification";

test("classification: valid PDP explicit out-of-stock => success + out_of_stock", () => {
  const classified = classifyAdapterOutcome({
    competitor_current_price: null,
    competitor_promo_price: null,
    competitor_was_price: null,
    competitor_stock_status: "Out of Stock",
    result_status: "out_of_stock",
    match_confidence: "High"
  });

  assert.equal(classified.runStatus, "success");
  assert.equal(classified.availabilityStatus, "out_of_stock");
  assert.equal(classified.competitorStockStatus, "Out of Stock");
});

test("classification: redirect/non-product => success + url_unavailable", () => {
  const classified = classifyAdapterOutcome({
    competitor_current_price: null,
    competitor_promo_price: null,
    competitor_was_price: null,
    competitor_stock_status: "Out of Stock",
    result_status: "removed",
    match_confidence: "High",
    metadata: {
      original_url: "https://example.com/p/product-1",
      final_url: "https://example.com/category",
      final_http_status: 200,
      page_classification: "category"
    }
  });

  assert.equal(classified.runStatus, "success");
  assert.equal(classified.availabilityStatus, "url_unavailable");
  assert.equal(classified.competitorStockStatus, "URL Unavailable");
});

test("classification: 404/410 removed => success + url_unavailable", () => {
  const classified = classifyAdapterOutcome({
    competitor_current_price: null,
    competitor_promo_price: null,
    competitor_was_price: null,
    competitor_stock_status: "URL Unavailable",
    result_status: "removed",
    match_confidence: "High",
    metadata: {
      original_url: "https://example.com/p/product-1",
      final_url: "https://example.com/p/product-1",
      final_http_status: 404,
      page_classification: "not_found"
    }
  });

  assert.equal(classified.runStatus, "success");
  assert.equal(classified.availabilityStatus, "url_unavailable");
});

test("classification: parsing/runtime failure => failed + unknown", () => {
  const classified = classifyAdapterOutcome({
    competitor_current_price: null,
    competitor_promo_price: null,
    competitor_was_price: null,
    competitor_stock_status: "In Stock",
    result_status: "adapter_error",
    match_confidence: "Needs review"
  });

  assert.equal(classified.runStatus, "failed");
  assert.equal(classified.availabilityStatus, "unknown");
  assert.equal(classified.competitorStockStatus, "Unknown");
});

test("comparison eligibility excludes out_of_stock and url_unavailable", () => {
  const base = {
    id: "1",
    competitorName: "Comp",
    competitorProductUrl: "https://example.com",
    competitorPromoPrice: null,
    competitorWasPrice: null,
    lastCheckedAt: new Date().toISOString(),
    checkErrorMessage: "",
    rawPriceText: "",
    extractionSource: "test",
    extractionMetadata: {},
    suspiciousChangeFlag: false,
    priceDifferenceGbp: null,
    priceDifferencePercent: null,
    pricingStatus: "In line with competitor" as const,
    lastCheckStatus: "success" as const
  };

  assert.equal(isInStockForComparison({ ...base, competitorCurrentPrice: 10, competitorStockStatus: "In Stock" }), true);
  assert.equal(isInStockForComparison({ ...base, competitorCurrentPrice: 10, competitorStockStatus: "Out of Stock" }), false);
  assert.equal(isInStockForComparison({ ...base, competitorCurrentPrice: 10, competitorStockStatus: "URL Unavailable" }), false);
});

test("listing order is in_stock -> out_of_stock -> url_unavailable -> unknown/failed", () => {
  const items = [
    { competitorStockStatus: "Unknown", lastCheckStatus: "success" as const },
    { competitorStockStatus: "Out of Stock", lastCheckStatus: "success" as const },
    { competitorStockStatus: "URL Unavailable", lastCheckStatus: "success" as const },
    { competitorStockStatus: "In Stock", lastCheckStatus: "success" as const },
    { competitorStockStatus: "In Stock", lastCheckStatus: "failed" as const }
  ];

  const sorted = [...items].sort((a, b) => listingSortWeight(a as never) - listingSortWeight(b as never));
  assert.deepEqual(sorted.map((s) => `${s.lastCheckStatus}:${s.competitorStockStatus}`), [
    "success:In Stock",
    "success:Out of Stock",
    "success:URL Unavailable",
    "success:Unknown",
    "failed:In Stock"
  ]);
});
