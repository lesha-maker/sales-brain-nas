import { NextRequest, NextResponse } from "next/server";
import {
  createLarkSpreadsheet,
  sendLarkTextReport,
  writeLarkSpreadsheetValues,
} from "../../../lib/lark";
import { buildCeoSalesReport } from "../../../lib/ceo-report";
import { getLatestSalesMemory, getRecentSalesMemoryChanges } from "../../../lib/sales-memory";

type ReportRequest = {
  chatId?: string;
  sendToChat?: boolean;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ReportRequest;
  const snapshot = await getLatestSalesMemory();

  if (!snapshot) {
    return NextResponse.json(
      { error: "No Sales Brain memory snapshot has been crawled yet." },
      { status: 400 },
    );
  }

  try {
    const recentChanges = await getRecentSalesMemoryChanges(100);
    const report = buildCeoSalesReport({ snapshot, recentChanges });
    const spreadsheet = await createLarkSpreadsheet({ title: report.title });

    await writeLarkSpreadsheetValues({
      spreadsheetToken: spreadsheet.spreadsheetToken,
      values: report.sheetValues,
    });

    const chatId = body.chatId || process.env.LARK_SALES_CHAT_ID;

    if (body.sendToChat !== false && chatId) {
      await sendLarkTextReport({
        chatId,
        text: `I created the CEO Sales Snapshot in Lark: ${spreadsheet.url}`,
      });
    }

    return NextResponse.json({
      ok: true,
      spreadsheet,
      reportPreview: report.plainText.slice(0, 2000),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create CEO sales report.",
      },
      { status: 502 },
    );
  }
}
