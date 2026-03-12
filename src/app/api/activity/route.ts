import { NextResponse } from "next/server";
import { getActivity } from "@/lib/operations";

export async function GET() {
  try {
    const data = await getActivity(80);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Unable to load activity." }, { status: 500 });
  }
}
