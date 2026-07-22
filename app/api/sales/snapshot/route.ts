import { NextResponse } from "next/server";
import { getBoardSnapshot } from "../../../lib/monday";
import { getConfiguredSalesBoardIds, getLatestSalesMemory } from "../../../lib/sales-memory";

export async function GET() {
  const boardIds = getConfiguredSalesBoardIds();

  if (!boardIds.length) {
    return NextResponse.json(
      {
        mode: "sample",
        message: "Set MONDAY_SALES_BOARD_IDS and MONDAY_API_TOKEN to read live CRM data.",
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
          boards: memory.boards,
          deals: memory.deals,
          summary: memory.summary,
          generatedAt: memory.generatedAt,
        },
      });
    }

    const snapshots = await Promise.all(boardIds.map((boardId) => getBoardSnapshot(boardId)));
    const boards = snapshots.map((snapshot) => snapshot.board).filter(Boolean);
    const deals = snapshots.flatMap((snapshot) => snapshot.deals);

    return NextResponse.json({
      mode: "live",
      source: "monday",
      data: {
        board: boards[0],
        boards,
        deals,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load sales snapshot." },
      { status: 502 },
    );
  }
}
