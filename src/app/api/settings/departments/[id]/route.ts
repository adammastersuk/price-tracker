import { NextRequest, NextResponse } from "next/server";
import { deleteDepartmentSafe, updateDepartment } from "@/lib/db";
import { ensureUniqueSetting } from "@/lib/settings-validation";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await request.json();
    const name = String(payload?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Department name is required" }, { status: 400 });
    await ensureUniqueSetting("department", name, params.id);
    await updateDepartment(params.id, { name });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteDepartmentSafe(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
