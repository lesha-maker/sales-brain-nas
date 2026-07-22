import { NextRequest, NextResponse } from "next/server";
import { crawlSalesMemory, getConfiguredSalesBoardIds } from "../../../lib/sales-memory";

export async function POST(request: NextRequest) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  const boardIds = getConfiguredSalesBoardIds();

  if (!boardIds.length) {
    return NextResponse.json({ error: "MONDAY_SALES_BOARD_IDS is required." }, { status: 500 });
  }

  try {
    const snapshot = await crawlSalesMemory(boardIds);
    return NextResponse.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      board: snapshot.board,
      boards: snapshot.boards,
      summary: snapshot.summary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to crawl monday memory." },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}

function authorize(request: NextRequest) {
  const expected = process.env.SALES_BRAIN_CRON_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: "SALES_BRAIN_CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization");
  const token = header?.replace(/^Bearer\s+/i, "") || request.nextUrl.searchParams.get("secret");

  if (token !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}
