import { NextRequest, NextResponse } from "next/server";
import { changeDealColumns, createDealUpdate } from "../../../lib/monday";

type WriteRequest = {
  boardId?: string;
  itemId?: string;
  columnValues?: Record<string, unknown>;
  updateBody?: string;
  approved?: boolean;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as WriteRequest;

  if (!body.approved) {
    return NextResponse.json(
      { error: "monday writes require explicit approval." },
      { status: 400 },
    );
  }

  if (!body.itemId) {
    return NextResponse.json({ error: "itemId is required." }, { status: 400 });
  }

  try {
    const results: Record<string, unknown> = {};

    if (body.columnValues && body.boardId) {
      results.columns = await changeDealColumns({
        boardId: body.boardId,
        itemId: body.itemId,
        columnValues: body.columnValues,
      });
    }

    if (body.updateBody) {
      results.update = await createDealUpdate({
        itemId: body.itemId,
        body: body.updateBody,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "monday write failed." },
      { status: 502 },
    );
  }
}
