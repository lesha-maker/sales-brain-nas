const LARK_BASE_URL = "https://open.larksuite.com/open-apis";

type LarkApiPayload<T> = {
  code: number;
  msg: string;
  data?: T;
};

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

export async function appendLarkDocumentTextBlocks({
  documentId,
  paragraphs,
}: {
  documentId: string;
  paragraphs: string[];
}) {
  const chunks = chunk(paragraphs.filter(Boolean), 40);
  let index = 0;

  for (const paragraphsChunk of chunks) {
    await larkRequest(
      `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
      {
        method: "POST",
        body: JSON.stringify({
          index,
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

    index += paragraphsChunk.length;
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

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
