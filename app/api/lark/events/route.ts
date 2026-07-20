import { NextRequest, NextResponse } from "next/server";
import { getBoardSnapshot } from "../../../lib/monday";
import { replyToLarkMessage } from "../../../lib/lark";
import { answerSalesQuestion } from "../../../lib/sales-brain";
import {
  appendConversationMemory,
  getConversationMemory,
  getLatestSalesMemory,
} from "../../../lib/sales-memory";

type LarkEventPayload = {
  challenge?: string;
  token?: string;
  type?: string;
  header?: {
    event_type?: string;
    token?: string;
  };
  event?: {
    message?: {
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
      chat_type?: string;
    };
  };
};

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as LarkEventPayload;
  const expectedToken = process.env.LARK_VERIFICATION_TOKEN;
  const receivedToken = payload.token || payload.header?.token;

  if (!expectedToken) {
    return NextResponse.json(
      { error: "LARK_VERIFICATION_TOKEN is not configured." },
      { status: 500 },
    );
  }

  if (receivedToken !== expectedToken) {
    return NextResponse.json({ error: "Invalid Lark verification token." }, { status: 401 });
  }

  if (payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const eventType = payload.header?.event_type || payload.type;

  if (eventType !== "im.message.receive_v1") {
    return NextResponse.json({ ok: true, ignored: eventType ?? "unknown" });
  }

  const message = payload.event?.message;
  const messageId = message?.message_id;

  if (!messageId || message?.message_type !== "text") {
    return NextResponse.json({ ok: true, ignored: "non-text-message" });
  }

  const question = parseTextContent(message.content);
  const threadId = conversationThreadId(message);
  const conversation = await getConversationMemory(threadId);
  const answer = await answerFromSalesBoard(question, conversation);

  await replyToLarkMessage({
    messageId,
    text: answer,
  });

  await appendConversationMemory({
    threadId,
    userMessage: question,
    assistantMessage: answer,
  });

  return NextResponse.json({ ok: true });
}

function parseTextContent(content?: string) {
  if (!content) return "";

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.replace(/@\S+\s*/g, "").trim() ?? "";
  } catch {
    return content.trim();
  }
}

function conversationThreadId(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  return (
    message?.root_id ||
    message?.parent_id ||
    message?.chat_id ||
    message?.message_id ||
    "lark-default-thread"
  );
}

async function answerFromSalesBoard(
  question: string,
  conversation: Awaited<ReturnType<typeof getConversationMemory>>,
) {
  const boardId = process.env.MONDAY_SALES_BOARD_ID;

  if (!boardId) {
    return "Sales Brain is missing MONDAY_SALES_BOARD_ID, so I cannot read the CRM yet.";
  }

  const memory = await getLatestSalesMemory();

  if (memory?.deals.length) {
    return answerSalesQuestion({ question, deals: memory.deals, conversation });
  }

  const { deals } = await getBoardSnapshot(boardId);
  return answerSalesQuestion({ question, deals, conversation });
}
