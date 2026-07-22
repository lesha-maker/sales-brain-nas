import {
  appendLarkDocumentTextBlocks,
  appendLarkReportBlocks,
  createLarkDocument,
  sendLarkTextReport,
} from "./lark";
import { buildCeoSalesReport } from "./ceo-report";
import {
  crawlSalesMemory,
  getConfiguredSalesBoardIds,
  getLatestSalesMemory,
  getRecentSalesMemoryChanges,
} from "./sales-memory";

export async function createTwiceWeeklySalesReport({
  chatId,
  sendToChat = true,
}: {
  chatId?: string;
  sendToChat?: boolean;
}) {
  const boardIds = getConfiguredSalesBoardIds();
  const snapshot = boardIds.length
    ? await crawlSalesMemory(boardIds)
    : await getLatestSalesMemory();

  if (!snapshot) {
    throw new Error("No Sales Brain memory snapshot has been crawled yet.");
  }

  const recentChanges = await getRecentSalesMemoryChanges(180);
  const report = buildCeoSalesReport({ snapshot, recentChanges });
  const document = await createLarkDocument({
    title: `Sales Pulse - ${report.title.replace(/^CEO Sales Brief -\s*/, "")}`,
  });

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

  const targetChatId =
    chatId || process.env.LARK_SALES_REPORT_CHAT_ID || process.env.LARK_SALES_CHAT_ID;

  if (sendToChat && targetChatId) {
    await sendLarkTextReport({
      chatId: targetChatId,
      text: `I created the Sales Pulse report in Lark Docs: ${document.url}`,
    });
  }

  return {
    ok: true,
    document,
    boards: snapshot.boards || [snapshot.board],
    reportPreview: report.plainText.slice(0, 2000),
  };
}
