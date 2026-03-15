import { NextRequest, NextResponse } from "next/server";
import { createProduct, deleteProduct, findProductBySku, getProductById, getProducts, mergeProducts, updateProduct } from "@/lib/db";
import { normalizeBuyerDepartmentAndCompetitor } from "@/lib/settings-normalizers";
import { logActivity } from "@/lib/operations";
import { calculateBentsMarginPercent } from "@/lib/pricing";

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
    await logActivity({ event_type: "product_created", entity_type: "product", entity_id: created[0]?.id, summary: `Product created: ${created[0]?.sku ?? ""}` });
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
    const normalized = await normalizeBuyerDepartmentAndCompetitor({
      buyer: typeof updates.buyer === "string" ? updates.buyer : undefined,
      department: typeof updates.department === "string" ? updates.department : undefined
    });

    const cost = updates.cost_price === null
      ? null
      : Number.isFinite(updates.cost_price)
        ? Number(updates.cost_price)
        : existing.costPrice;
    const marginPercent = calculateBentsMarginPercent(bents, cost);

    const updated = await updateProduct(payload.id, { ...updates, buyer: normalized.buyer, department: normalized.department, sku: requestedSku, margin_percent: marginPercent });
    await logActivity({ event_type: "product_updated", entity_type: "product", entity_id: payload.id, summary: `Product updated: ${requestedSku}` });
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
    await logActivity({ event_type: "product_merged", entity_type: "product", entity_id: sourceProductId, summary: `Merged product ${sourceProductId} into ${targetProductId}.`, metadata: summary as unknown as Record<string, unknown> });
    return NextResponse.json({ data: summary });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const productId = request.nextUrl.searchParams.get("id");
    if (!productId) {
      return NextResponse.json({ error: "Product id is required" }, { status: 400 });
    }

    const existing = await getProductById(productId);
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    await deleteProduct(productId);
    await logActivity({ event_type: "product_deleted", entity_type: "product", entity_id: productId, summary: `Product deleted: ${existing.internalSku}` });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete product. Please try again." }, { status: 500 });
  }
}
