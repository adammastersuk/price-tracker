import { NextRequest, NextResponse } from "next/server";
import { addProductNotesBulk } from "@/lib/db";
import { WorkflowStatus } from "@/types/pricing";
import { logActivity } from "@/lib/operations";

const allowedStatuses: WorkflowStatus[] = ["Open", "Monitoring", "Reviewed", "No Action", "Closed", "In Review", "Awaiting Supplier", "Resolved"];

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const action = payload?.action as string | undefined;
    const productIds = (payload?.productIds as string[] | undefined)?.filter(Boolean) ?? [];

    if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });
    if (!productIds.length) return NextResponse.json({ error: "Select at least one product." }, { status: 400 });

    if (action === "assign_owner") {
      const owner = (payload?.owner as string | undefined)?.trim();
      if (!owner) return NextResponse.json({ error: "owner is required" }, { status: 400 });
      await addProductNotesBulk(productIds.map((productId) => ({
        product_id: productId,
        note: `Bulk update: owner assigned to ${owner}`,
        owner
      })));
      await logActivity({ event_type: "bulk_action", entity_type: "product", summary: `Bulk owner assignment to ${owner} for ${productIds.length} products.`, metadata: { action, productIds, owner } });
      return NextResponse.json({ data: { updated: productIds.length } });
    }

    if (action === "set_workflow_status") {
      const workflowStatus = payload?.workflowStatus as WorkflowStatus | undefined;
      if (!workflowStatus || !allowedStatuses.includes(workflowStatus)) {
        return NextResponse.json({ error: "A valid workflowStatus is required" }, { status: 400 });
      }
      await addProductNotesBulk(productIds.map((productId) => ({
        product_id: productId,
        note: `Bulk update: workflow status set to ${workflowStatus}`,
        workflow_status: workflowStatus
      })));
      await logActivity({ event_type: "bulk_action", entity_type: "product", summary: `Bulk workflow set to ${workflowStatus} for ${productIds.length} products.`, metadata: { action, productIds, workflowStatus } });
      return NextResponse.json({ data: { updated: productIds.length } });
    }

    if (action === "mark_reviewed") {
      await addProductNotesBulk(productIds.map((productId) => ({
        product_id: productId,
        note: "Bulk update: marked as reviewed",
        workflow_status: "Reviewed"
      })));
      await logActivity({ event_type: "bulk_action", entity_type: "product", summary: `Bulk mark reviewed for ${productIds.length} products.`, metadata: { action, productIds } });
      return NextResponse.json({ data: { updated: productIds.length } });
    }

    return NextResponse.json({ error: "Unsupported bulk action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
