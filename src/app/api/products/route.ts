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
    const updated = await updateProduct(payload.id, payload.updates ?? {});
    return NextResponse.json({ data: updated[0] });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
