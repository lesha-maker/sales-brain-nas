const LARK_BASE_URL = "https://open.larksuite.com/open-apis";

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
