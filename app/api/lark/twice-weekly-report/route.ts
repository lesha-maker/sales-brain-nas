import { NextRequest, NextResponse } from "next/server";
import { createTwiceWeeklySalesReport } from "../../../lib/twice-weekly-report";

type ReportRequest = {
  chatId?: string;
  sendToChat?: boolean;
  previewOnly?: boolean;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ReportRequest;

  try {
    const result = await createTwiceWeeklySalesReport({
      chatId: body.chatId,
      sendToChat: body.sendToChat !== false,
      previewOnly: body.previewOnly === true,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to create twice-weekly sales report.",
      },
      { status: 502 },
    );
  }
}
