import { NextRequest, NextResponse } from "next/server";
import {
  appendLarkReportBlocks,
  appendLarkDocumentTextBlocks,
  createLarkDocument,
  sendLarkTextReport,
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
    const document = await createLarkDocument({ title: report.title });

    try {
      await appendLarkReportBlocks({
        documentId: document.documentId,
        blocks: report.blocks,
      });
    } catch {
      await appendLarkDocumentTextBlocks({
        documentId: document.documentId,
        paragraphs: report.paragraphs,
      });
    }

    const chatId = body.chatId || process.env.LARK_SALES_CHAT_ID;

    if (body.sendToChat !== false && chatId) {
      await sendLarkTextReport({
        chatId,
        text: `I created the CEO Sales Snapshot in Lark Docs: ${document.url}`,
      });
    }

    return NextResponse.json({
      ok: true,
      document,
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
