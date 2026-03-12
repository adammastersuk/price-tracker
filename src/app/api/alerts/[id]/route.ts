import { NextRequest, NextResponse } from "next/server";
import { logActivity, updateAlertStatus } from "@/lib/operations";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const payload = await request.json();
    const status = payload?.status as "new" | "acknowledged" | "resolved" | undefined;
    if (!status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const data = await updateAlertStatus(params.id, status);
    await logActivity({ event_type: "alert_status_changed", entity_type: "alert", entity_id: params.id, summary: `Alert marked ${status}.`, metadata: { status } });
    return NextResponse.json({ data: data[0] });
  } catch {
    return NextResponse.json({ error: "Unable to update alert." }, { status: 500 });
  }
}
