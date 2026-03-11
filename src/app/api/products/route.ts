import { NextRequest, NextResponse } from "next/server";
import { createProduct, getProductById, getProducts, updateProduct } from "@/lib/db";

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
    const bents = Number.isFinite(updates.bents_price) ? Number(updates.bents_price) : existing.bentsRetailPrice;
    const cost = updates.cost_price === null
      ? null
      : Number.isFinite(updates.cost_price)
        ? Number(updates.cost_price)
        : existing.costPrice;
    const marginPercent = cost === null || bents <= 0
      ? null
      : Number((((bents - cost) / bents) * 100).toFixed(2));

    const updated = await updateProduct(payload.id, { ...updates, margin_percent: marginPercent });
    return NextResponse.json({ data: updated[0] });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
