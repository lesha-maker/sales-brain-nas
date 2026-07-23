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
  previewOnly = false,
}: {
  chatId?: string;
  sendToChat?: boolean;
  previewOnly?: boolean;
}) {
  const boardIds = getConfiguredSalesBoardIds();
  const snapshot = (await getLatestSalesMemory()) || (boardIds.length ? await crawlSalesMemory(boardIds) : null);

  if (!snapshot) {
    throw new Error("No Sales Brain memory snapshot has been crawled yet.");
  }

  const recentChanges = await getRecentSalesMemoryChanges(180);
  const report = buildCeoSalesReport({ snapshot, recentChanges });

  if (previewOnly) {
    return {
      ok: true,
      document: null,
      boards: snapshot.boards || [snapshot.board],
      reportPreview: report.plainText.slice(0, 8000),
    };
  }

  const document = await createLarkDocument({
    title: report.title,
  });
  let writeMode = "text-blocks";
  let writeError = "";

  if (process.env.SALES_BRAIN_USE_LARK_TABLE_BLOCKS !== "false") {
    try {
      await appendLarkReportBlocks({
        documentId: document.documentId,
        blocks: report.blocks,
      });
      writeMode = "rich-blocks";
    } catch (error) {
      writeError = error instanceof Error ? error.message : "Rich Lark blocks failed.";
      await appendLarkDocumentTextBlocks({
        documentId: document.documentId,
        paragraphs: report.paragraphs,
      });
    }
  } else {
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
    writeMode,
    writeError,
    boards: snapshot.boards || [snapshot.board],
    reportPreview: report.plainText.slice(0, 2000),
  };
}
