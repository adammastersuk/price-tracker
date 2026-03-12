import { NextRequest, NextResponse } from "next/server";
import { deleteBuyerSafe, updateBuyer } from "@/lib/db";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await request.json();
    await updateBuyer(params.id, {
      name: typeof payload?.name === "string" ? payload.name.trim() : undefined,
      is_active: typeof payload?.isActive === "boolean" ? payload.isActive : undefined,
      department_ids: Array.isArray(payload?.departmentIds) ? payload.departmentIds.map((v: unknown) => String(v)) : undefined
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteBuyerSafe(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
