import { NextRequest, NextResponse } from "next/server";
import { createProduct, findProductBySku, getProductById, getProducts, mergeProducts, updateProduct } from "@/lib/db";

function isDuplicateKeyError(errorMessage: string): boolean {
  return errorMessage.includes("duplicate key") || errorMessage.includes("23505");
}

export async function GET(request: NextRequest) {
  try {
    const productId = request.nextUrl.searchParams.get("productId");
    if (productId) {
      const product = await getProductById(productId);
      return NextResponse.json({ data: product });
    }
    const products = await getProducts();
    return NextResponse.json({ data: products });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const created = await createProduct(payload);
    return NextResponse.json({ data: created[0] }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json();
    if (!payload?.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const existing = await getProductById(payload.id);
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    const updates = payload.updates ?? {};

    const requestedSku = typeof updates.sku === "string" ? updates.sku.trim() : existing.internalSku;
    const normalizedCurrentSku = existing.internalSku.trim();
    if (requestedSku && requestedSku !== normalizedCurrentSku) {
      const duplicateTarget = await findProductBySku(requestedSku);
      if (duplicateTarget && duplicateTarget.id !== payload.id) {
        return NextResponse.json({
          error: `SKU ${requestedSku} already exists. You can merge this product into the existing SKU instead.`,
          code: "DUPLICATE_SKU",
          duplicate: {
            sourceProductId: payload.id,
            targetProductId: duplicateTarget.id,
            targetSku: duplicateTarget.sku,
            targetName: duplicateTarget.name
          }
        }, { status: 409 });
      }
    }

    const bents = Number.isFinite(updates.bents_price) ? Number(updates.bents_price) : existing.bentsRetailPrice;
    const cost = updates.cost_price === null
      ? null
      : Number.isFinite(updates.cost_price)
        ? Number(updates.cost_price)
        : existing.costPrice;
    const marginPercent = cost === null || bents <= 0
      ? null
      : Number((((bents - cost) / bents) * 100).toFixed(2));

    const updated = await updateProduct(payload.id, { ...updates, sku: requestedSku, margin_percent: marginPercent });
    return NextResponse.json({ data: updated[0] });
  } catch (error) {
    const message = (error as Error).message;
    if (isDuplicateKeyError(message)) {
      return NextResponse.json({
        error: "This SKU already exists on another product. Use merge to reassign competitor listings.",
        code: "DUPLICATE_SKU"
      }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = await request.json();
    const sourceProductId = payload?.sourceProductId as string | undefined;
    const targetProductId = payload?.targetProductId as string | undefined;

    if (!sourceProductId || !targetProductId) {
      return NextResponse.json({ error: "sourceProductId and targetProductId are required" }, { status: 400 });
    }

    if (sourceProductId === targetProductId) {
      return NextResponse.json({ error: "Source and target products must be different" }, { status: 400 });
    }

    const sourceProduct = await getProductById(sourceProductId);
    const targetProduct = await getProductById(targetProductId);

    if (!sourceProduct || !targetProduct) {
      return NextResponse.json({ error: "Source or target product not found" }, { status: 404 });
    }

    const summary = await mergeProducts(sourceProductId, targetProductId);
    return NextResponse.json({ data: summary });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
