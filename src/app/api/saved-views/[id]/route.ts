import { NextRequest, NextResponse } from "next/server";
import { deleteSavedView, logActivity, updateSavedView } from "@/lib/operations";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof payload?.name === "string") updates.name = payload.name.trim();
    if (payload?.state && typeof payload.state === "object") updates.state = payload.state;
    const data = await updateSavedView(params.id, updates);
    await logActivity({ event_type: "saved_view_updated", entity_type: "saved_view", entity_id: params.id, summary: "Saved view updated.", metadata: updates as Record<string, unknown> });
    return NextResponse.json({ data: data[0] });
  } catch {
    return NextResponse.json({ error: "Unable to update saved view." }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteSavedView(params.id);
    await logActivity({ event_type: "saved_view_deleted", entity_type: "saved_view", entity_id: params.id, summary: "Saved view deleted." });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to delete saved view." }, { status: 500 });
  }
}
