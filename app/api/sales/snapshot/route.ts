import { NextResponse } from "next/server";
import { getBoardSnapshot } from "../../../lib/monday";
import { getLatestSalesMemory } from "../../../lib/sales-memory";

export async function GET() {
  const boardId = process.env.MONDAY_SALES_BOARD_ID;

  if (!boardId) {
    return NextResponse.json(
      {
        mode: "sample",
        message: "Set MONDAY_SALES_BOARD_ID and MONDAY_API_TOKEN to read live CRM data.",
      },
      { status: 200 },
    );
  }

  try {
    const memory = await getLatestSalesMemory();

    if (memory?.deals.length) {
      return NextResponse.json({
        mode: "live",
        source: "memory",
        data: {
          board: memory.board,
          deals: memory.deals,
          summary: memory.summary,
          generatedAt: memory.generatedAt,
        },
      });
    }

    const data = await getBoardSnapshot(boardId);
    return NextResponse.json({ mode: "live", source: "monday", data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load sales snapshot." },
      { status: 502 },
    );
  }
}
