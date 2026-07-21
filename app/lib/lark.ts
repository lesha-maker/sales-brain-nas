const LARK_BASE_URL = "https://open.larksuite.com/open-apis";

type LarkApiPayload<T> = {
  code: number;
  msg: string;
  data?: T;
};

export type LarkDocumentContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "table"; rows: string[][]; columnWidths?: number[] };

export type LarkReportBlock =
  | { type: "heading1"; text: string }
  | { type: "heading2"; text: string }
  | { type: "text"; text: string }
  | { type: "table"; rows: string[][]; columnWidths?: number[] }
  | { type: "divider" };

async function getTenantAccessToken() {
  const appId = process.env.LARK_APP_ID;
  const appSecret = process.env.LARK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("LARK_APP_ID and LARK_APP_SECRET are not configured.");
  }

  const response = await fetch(`${LARK_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  const payload = (await response.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
  };

  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(payload.msg || "Unable to get Lark tenant access token.");
  }

  return payload.tenant_access_token;
}

export async function sendLarkTextReport({
  chatId,
  text,
}: {
  chatId: string;
  text: string;
}) {
  const token = await getTenantAccessToken();
  const response = await fetch(
    `${LARK_BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
    },
  );

  const payload = (await response.json()) as { code: number; msg: string };

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || "Unable to send Lark report.");
  }

  return payload;
}

export async function createLarkDocument({ title }: { title: string }) {
  const payload = await larkRequest<{
    document?: {
      document_id: string;
      revision_id?: number;
      title?: string;
      url?: string;
    };
  }>("/docx/v1/documents", {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  const document = payload.document;

  if (!document?.document_id) {
    throw new Error("Lark created no document_id.");
  }

  return {
    documentId: document.document_id,
    revisionId: document.revision_id,
    title: document.title || title,
    url: document.url || larkDocumentUrl(document.document_id),
  };
}

export async function createLarkSpreadsheet({ title }: { title: string }) {
  const payload = await larkRequest<{
    spreadsheet?: {
      title?: string;
      url?: string;
      spreadsheet_token?: string;
    };
  }>("/sheets/v3/spreadsheets", {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  const spreadsheet = payload.spreadsheet;

  if (!spreadsheet?.spreadsheet_token) {
    throw new Error("Lark created no spreadsheet_token.");
  }

  return {
    spreadsheetToken: spreadsheet.spreadsheet_token,
    title: spreadsheet.title || title,
    url: spreadsheet.url || larkSpreadsheetUrl(spreadsheet.spreadsheet_token),
  };
}

export async function writeLarkSpreadsheetValues({
  spreadsheetToken,
  values,
}: {
  spreadsheetToken: string;
  values: string[][];
}) {
  const sheetId = await getFirstSheetId(spreadsheetToken);
  const columnCount = Math.max(...values.map((row) => row.length), 1);
  const range = `${sheetId}!A1:${columnName(columnCount)}${values.length}`;

  await larkRequest(`/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_update`, {
    method: "POST",
    body: JSON.stringify({
      valueRanges: [
        {
          range,
          values,
        },
      ],
    }),
  });
}

export async function appendLarkDocumentTextBlocks({
  documentId,
  paragraphs,
}: {
  documentId: string;
  paragraphs: string[];
}) {
  await appendParagraphsAtIndex({
    documentId,
    parentBlockId: documentId,
    paragraphs,
    index: 0,
  });
}

export async function appendLarkReportBlocks({
  documentId,
  blocks,
}: {
  documentId: string;
  blocks: LarkReportBlock[];
}) {
  let index = 0;

  for (const block of blocks) {
    if (block.type === "table") {
      await appendLarkTable({
        documentId,
        rows: block.rows,
        columnWidths: block.columnWidths,
        index,
      });
      index += 1;
      continue;
    }

    await larkRequest(
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          index,
          children: [toLarkBlock(block)],
        }),
      },
    );

    index += 1;
  }
}

async function appendParagraphsAtIndex({
  documentId,
  parentBlockId,
  paragraphs,
  index,
}: {
  documentId: string;
  parentBlockId: string;
  paragraphs: string[];
  index: number;
}) {
  const chunks = chunk(paragraphs.filter(Boolean), 40);
  let nextIndex = index;

  for (const paragraphsChunk of chunks) {
    await larkRequest(
      `/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          index: nextIndex,
          children: paragraphsChunk.map((paragraph) => ({
            block_type: 2,
            text: {
              elements: [
                {
                  text_run: {
                    content: paragraph,
                    text_element_style: {},
                  },
                },
              ],
              style: {},
            },
          })),
        }),
      },
    );

    nextIndex += paragraphsChunk.length;
  }
}

function toLarkBlock(block: LarkReportBlock) {
  if (block.type === "divider") {
    return { block_type: 22, divider: {} };
  }

  if (block.type === "heading1") {
    return {
      block_type: 3,
      heading1: textPayload(block.text),
    };
  }

  if (block.type === "heading2") {
    return {
      block_type: 4,
      heading2: textPayload(block.text),
    };
  }

  return {
    block_type: 2,
    text: textPayload(block.text),
  };
}

function textPayload(content: string) {
  return {
    elements: [
      {
        text_run: {
          content,
          text_element_style: {},
        },
      },
    ],
    style: {},
  };
}

export async function appendLarkDocumentBlocks({
  documentId,
  blocks,
}: {
  documentId: string;
  blocks: LarkDocumentContentBlock[];
}) {
  let index = 0;

  for (const block of blocks) {
    if (block.type === "paragraph") {
      await appendParagraphsAtIndex({
        documentId,
        parentBlockId: documentId,
        paragraphs: [block.text],
        index,
      });
      index += 1;
      continue;
    }

    await appendLarkTable({
      documentId,
      rows: block.rows,
      columnWidths: block.columnWidths,
      index,
    });
    index += 1;
  }
}

async function appendLarkTable({
  documentId,
  rows,
  index,
}: {
  documentId: string;
  rows: string[][];
  columnWidths?: number[];
  index: number;
}) {
  if (!rows.length || !rows[0]?.length) return;

  const rowSize = rows.length;
  const columnSize = rows[0].length;
  const createPayload = await larkRequest<{
    children?: Array<{
      block_id?: string;
      block_type?: number;
      table?: {
        cells?: string[];
      };
    }>;
  }>(`/docx/v1/documents/${documentId}/blocks/${documentId}/children`, {
    method: "POST",
    body: JSON.stringify({
      index,
      children: [
        {
          block_type: 31,
          table: {
            property: {
              row_size: rowSize,
              column_size: columnSize,
            },
          },
        },
      ],
    }),
  });

  const tableBlock = createPayload.children?.find((child) => child.block_type === 31);
  const tableBlockId = tableBlock?.block_id;

  if (!tableBlockId) {
    throw new Error("Lark created no table block_id.");
  }

  const table = await getLarkDocumentBlock(documentId, tableBlockId);
  const cells = table.table?.cells || tableBlock.table?.cells || [];

  if (cells.length < rowSize * columnSize) {
    throw new Error("Lark table did not return enough cell IDs to write values.");
  }

  const writes: Array<Promise<void>> = [];

  for (let row = 0; row < rowSize; row += 1) {
    for (let column = 0; column < columnSize; column += 1) {
      const cellId = cells[row * columnSize + column];
      const value = rows[row]?.[column] || "";

      if (!cellId || !value) continue;

      writes.push(appendTextToBlock({ documentId, blockId: cellId, text: value }));
    }
  }

  for (const writesChunk of chunk(writes, 8)) {
    await Promise.all(writesChunk);
  }
}

export async function replyToLarkMessage({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${LARK_BASE_URL}/im/v1/messages/${messageId}/reply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({ text }),
      reply_in_thread: true,
    }),
  });

  const payload = (await response.json()) as { code: number; msg: string };

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || "Unable to reply to Lark message.");
  }

  return payload;
}

async function getLarkDocumentBlock(documentId: string, blockId: string) {
  const payload = await larkRequest<{
    block?: {
      block_id?: string;
      block_type?: number;
      table?: {
        cells?: string[];
      };
    };
  }>(`/docx/v1/documents/${documentId}/blocks/${blockId}`);

  if (!payload.block) {
    throw new Error("Lark returned no block data.");
  }

  return payload.block;
}

async function appendTextToBlock({
  documentId,
  blockId,
  text,
}: {
  documentId: string;
  blockId: string;
  text: string;
}) {
  await appendParagraphsAtIndex({
    documentId,
    parentBlockId: blockId,
    paragraphs: [text.slice(0, 1800)],
    index: 0,
  });
}

async function larkRequest<T>(
  path: string,
  init: RequestInit = {},
) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${LARK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

  const payload = (await response.json()) as LarkApiPayload<T>;

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || `Lark API request failed: ${path}`);
  }

  return payload.data as T;
}

function larkDocumentUrl(documentId: string) {
  const baseUrl = process.env.LARK_DOCS_BASE_URL?.replace(/\/$/, "");
  return baseUrl ? `${baseUrl}/docx/${documentId}` : `https://www.larksuite.com/docx/${documentId}`;
}

function larkSpreadsheetUrl(spreadsheetToken: string) {
  const baseUrl = process.env.LARK_DOCS_BASE_URL?.replace(/\/$/, "");
  return baseUrl
    ? `${baseUrl}/sheets/${spreadsheetToken}`
    : `https://www.larksuite.com/sheets/${spreadsheetToken}`;
}

async function getFirstSheetId(spreadsheetToken: string) {
  const payload = await larkRequest<{
    sheets?: Array<{ sheetId?: string; sheet_id?: string }>;
  }>(`/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`);

  const firstSheet = payload.sheets?.[0];
  const sheetId = firstSheet?.sheetId || firstSheet?.sheet_id;

  if (!sheetId) {
    throw new Error("Lark spreadsheet returned no sheet id.");
  }

  return sheetId;
}

function columnName(columnNumber: number) {
  let name = "";
  let current = columnNumber;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
