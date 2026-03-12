import { NextRequest, NextResponse } from "next/server";
import { createSavedView, listSavedViews, logActivity } from "@/lib/operations";

export async function GET() {
  try {
    const data = await listSavedViews("products");
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Unable to load saved views." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const name = String(payload?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const state = payload?.state;
    if (!state || typeof state !== "object") return NextResponse.json({ error: "state is required" }, { status: 400 });
    const data = await createSavedView({ name, state, page: "products" });
    await logActivity({ event_type: "saved_view_created", entity_type: "saved_view", entity_id: (data[0] as { id: string })?.id, summary: `Saved view created: ${name}` });
    return NextResponse.json({ data: data[0] }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create saved view." }, { status: 500 });
  }
}
