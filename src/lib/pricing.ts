const DEFAULT_VAT_RATE = 0.2;

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo2(value: number): number {
  return Number(value.toFixed(2));
}

export function calculateExVatPrice(sellingPriceIncVat: number | null | undefined, vatRate = DEFAULT_VAT_RATE): number | null {
  const priceIncVat = toFiniteNumber(sellingPriceIncVat);
  const rate = toFiniteNumber(vatRate);

  if (priceIncVat === null || rate === null || rate <= -1) return null;

  const exVatPrice = priceIncVat / (1 + rate);
  if (!Number.isFinite(exVatPrice) || exVatPrice <= 0) return null;

  return roundTo2(exVatPrice);
}

export function calculateBentsMarginPercent(
  sellingPriceIncVat: number | null | undefined,
  costPrice: number | null | undefined,
  vatRate = DEFAULT_VAT_RATE
): number | null {
  const cost = toFiniteNumber(costPrice);
  if (cost === null) return null;

  const sellingPriceExVat = calculateExVatPrice(sellingPriceIncVat, vatRate);
  if (sellingPriceExVat === null || sellingPriceExVat <= 0) return null;

  const profit = roundTo2(sellingPriceExVat - cost);
  const marginPercent = (profit / sellingPriceExVat) * 100;
  if (!Number.isFinite(marginPercent)) return null;

  return roundTo2(marginPercent);
}

export { DEFAULT_VAT_RATE };
