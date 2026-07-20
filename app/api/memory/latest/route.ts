import { NextResponse } from "next/server";
import { getLatestSalesMemory, getRecentSalesMemoryChanges } from "../../../lib/sales-memory";

export async function GET() {
  const snapshot = await getLatestSalesMemory();

  if (!snapshot) {
    return NextResponse.json(
      {
        mode: "empty",
        message: "No Sales Brain memory snapshot has been crawled yet.",
      },
      { status: 200 },
    );
  }

  const changes = await getRecentSalesMemoryChanges(100);

  return NextResponse.json({
    mode: "memory",
    snapshot,
    recentChanges: changes,
  });
}
