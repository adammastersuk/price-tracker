import { NextRequest, NextResponse } from "next/server";
import { deleteCompetitorSafe, updateCompetitor } from "@/lib/db";

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof payload?.name === "string") updates.name = payload.name.trim();
    if (typeof payload?.baseUrl === "string") updates.base_url = payload.baseUrl.trim();
    if (typeof payload?.domain === "string") updates.domain = payload.domain.trim();
    if (typeof payload?.adapterKey === "string") updates.adapter_key = payload.adapterKey.trim();
    if (typeof payload?.isEnabled === "boolean") updates.is_enabled = payload.isEnabled;
    await updateCompetitor(params.id, updates);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteCompetitorSafe(params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
