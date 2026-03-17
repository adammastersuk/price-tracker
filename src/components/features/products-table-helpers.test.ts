import assert from "node:assert/strict";
import test from "node:test";

import {
  checkedAtPill,
  shouldShowCompetitorInlineNote,
} from "./products-table-helpers.js";

test("shows in-line competitor note when competitor data exists", () => {
  const visible = shouldShowCompetitorInlineNote("In line with competitor", [
    { competitorName: "Comp A" },
  ]);

  assert.equal(visible, true);
});

test("hides in-line competitor note when competitor data is absent and keeps checked badge", () => {
  const visibleWithoutNull = shouldShowCompetitorInlineNote("In line with competitor", null);
  const visibleWithoutUndefined = shouldShowCompetitorInlineNote("In line with competitor", undefined);
  const visibleWithoutArray = shouldShowCompetitorInlineNote("In line with competitor", []);
  const visibleWithoutObject = shouldShowCompetitorInlineNote("In line with competitor", {});
  const checkedBadge = checkedAtPill("2026-03-10T10:00:00.000Z");

  assert.equal(visibleWithoutNull, false);
  assert.equal(visibleWithoutUndefined, false);
  assert.equal(visibleWithoutArray, false);
  assert.equal(visibleWithoutObject, false);
  assert.ok(checkedBadge);
  assert.match(checkedBadge.label, /^Checked /);
});
