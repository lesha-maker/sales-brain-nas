import { NextResponse } from "next/server";
import { getBoardSnapshot } from "../../../lib/monday";

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
    const data = await getBoardSnapshot(boardId);
    return NextResponse.json({ mode: "live", data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load sales snapshot." },
      { status: 502 },
    );
  }
}
