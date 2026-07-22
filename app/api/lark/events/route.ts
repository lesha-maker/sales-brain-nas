import { NextRequest, NextResponse } from "next/server";
import {
  changeDealColumns,
  createDealUpdate,
  getBoardSnapshot,
  type SalesDeal,
} from "../../../lib/monday";
import { replyToLarkMessage, sendLarkTextReport } from "../../../lib/lark";
import { answerSalesQuestion } from "../../../lib/sales-brain";
import {
  appendConversationMemory,
  clearPendingMondayAction,
  getConversationMemory,
  getLatestSalesMemory,
  getPendingMondayAction,
  registerLarkMessageDelivery,
  setPendingMondayAction,
  type ConversationMessage,
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

const FINAL_VERDICT_COLUMN_ID = "color_mm594jh8";

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

  const isFirstDelivery = await registerLarkMessageDelivery(messageId);

  if (!isFirstDelivery) {
    return NextResponse.json({ ok: true, ignored: "duplicate-message" });
  }

  const question = parseTextContent(message.content);
  const threadId = conversationThreadId(message);
  const conversation = await getConversationMemory(threadId);
  const boardData = await loadSalesBoardDeals();
  const answer =
    (await maybeHandleMondayWrite({
      question,
      threadId,
      boardId: boardData.boardId,
      deals: boardData.deals,
      conversation,
    })) ||
    (await answerSalesQuestion({
      question,
      deals: boardData.deals,
      conversation,
    }));

  if (message.chat_id) {
    await sendLarkTextReport({
      chatId: message.chat_id,
      text: answer,
    });
  } else {
    await replyToLarkMessage({
      messageId,
      text: answer,
      replyInThread: false,
    });
  }

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

async function loadSalesBoardDeals() {
  const boardId = process.env.MONDAY_SALES_BOARD_ID;

  if (!boardId) {
    throw new Error("Sales Brain is missing MONDAY_SALES_BOARD_ID, so I cannot read the CRM yet.");
  }

  const memory = await getLatestSalesMemory();

  if (memory?.deals.length && memory.deals.some((deal) => deal.group)) {
    return { boardId, deals: memory.deals };
  }

  const { deals } = await getBoardSnapshot(boardId);
  return { boardId, deals };
}

async function maybeHandleMondayWrite({
  question,
  threadId,
  boardId,
  deals,
  conversation,
}: {
  question: string;
  threadId: string;
  boardId: string;
  deals: SalesDeal[];
  conversation: ConversationMessage[];
}) {
  if (isConfirmation(question)) {
    const action = await getPendingMondayAction(threadId);

    if (!action) {
      return "";
    }

    await changeDealColumns({
      boardId: action.boardId,
      itemId: action.itemId,
      columnValues: action.columnValues,
    });

    await createDealUpdate({
      itemId: action.itemId,
      body: `Sales Brain updated ${action.description} after explicit Lark approval.`,
    });

    await clearPendingMondayAction(threadId);

    const email = action.email ? ` (${action.email})` : "";
    return `Done - I updated ${action.account}${email} in monday: ${action.description}.`;
  }

  if (!isAgreementStageUpdateIntent(question, conversation)) {
    return "";
  }

  const matches = findDealMatches({ question, conversation, deals }).slice(0, 5);

  if (!matches.length) {
    await clearPendingMondayAction(threadId);
    return "";
  }

  if (matches.length > 1) {
    await clearPendingMondayAction(threadId);
    const names = matches.map(formatDealOption).join("; ");
    return `I found multiple matching records: ${names}. Which one should I update?`;
  }

  const deal = matches[0];
  const description = "moved Final verdict to Agreement Stage";

  await setPendingMondayAction(threadId, {
    id: `${Date.now()}-${deal.id}`,
    createdAt: new Date().toISOString(),
    boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description,
    columnValues: {
      [FINAL_VERDICT_COLUMN_ID]: { label: "Agreement Stage" },
    },
  });

  const currentStage = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(", ");
  const email = deal.email ? ` (${deal.email})` : "";
  const stageText = currentStage ? ` It is currently at ${currentStage}.` : "";

  return `I found ${deal.account}${email}.${stageText} Reply yes to confirm, and I'll move it to Agreement Stage in monday.`;
}

function isConfirmation(question: string) {
  const normalized = question.trim().toLowerCase();
  return /^(yes|yes pls|yes please|yep|yeah|confirm|approved|approve|do it|go ahead|ok|okay)$/i.test(
    normalized,
  );
}

function isAgreementStageUpdateIntent(
  question: string,
  conversation: ConversationMessage[],
) {
  const normalized = question.toLowerCase();

  if (isReadOnlySalesQuestion(normalized)) {
    return false;
  }

  const recentUserText = conversation
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.text)
    .join(" ")
    .toLowerCase();

  const combined = `${recentUserText} ${normalized}`;
  const mentionsAgreement = combined.includes("agreement");
  const currentMessageHasUpdateVerb = /\b(move|update|change|set|put)\b/.test(normalized);
  const recentMessageHadUpdateVerb = /\b(move|update|change|set|put)\b/.test(recentUserText);
  const currentMessageLooksLikeSelection = searchTokens(normalized).length > 0;
  const currentMessageLooksShort = searchTokens(normalized).length <= 3;

  return (
    mentionsAgreement &&
    (currentMessageHasUpdateVerb ||
      (recentMessageHadUpdateVerb && currentMessageLooksLikeSelection && currentMessageLooksShort))
  );
}

function isReadOnlySalesQuestion(normalized: string) {
  const asksForAnswer =
    /\b(how many|what|which|who|where|when|why|list|show|tell|give|get|report|count|summary|update on)\b/.test(
      normalized,
    );
  const asksAboutSales =
    /\b(lead|leads|sql|qualified|inbound|outbound|call|calls|meeting|meetings|pipeline|crm|sales)\b/.test(
      normalized,
    );

  return asksForAnswer && asksAboutSales;
}

function findDealMatches({
  question,
  conversation,
  deals,
}: {
  question: string;
  conversation: ConversationMessage[];
  deals: SalesDeal[];
}) {
  const recentUserMessages = conversation
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.text);
  const directTokens = searchTokens(question);
  const contextTokens = searchTokens([...recentUserMessages, question].join(" "));
  const tokens = directTokens.length ? directTokens : contextTokens;

  if (!tokens.length) return [];

  return deals
    .map((deal) => {
      const directScore = relevanceScore(deal, tokens);
      const contextBonus = directScore > 0 ? relevanceScore(deal, contextTokens) * 0.25 : 0;

      return {
        deal,
        score: directScore + contextBonus,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.deal);
}

function relevanceScore(deal: SalesDeal, tokens: string[]) {
  const account = normalizeSearch(deal.account);
  const email = normalizeSearch(deal.email);
  const firstName = normalizeSearch(deal.firstName);
  const lastName = normalizeSearch(deal.lastName);
  const website = normalizeSearch(deal.website);
  const searchable = `${account} ${email} ${firstName} ${lastName} ${website}`;
  let score = 0;

  for (const token of tokens) {
    if (email && email.includes(token)) score += 80;
    if (firstName && firstName === token) score += 70;
    if (lastName && lastName === token) score += 70;
    if (account && account === token) score += 100;
    else if (account && (account.includes(token) || token.includes(account))) score += 40;
    else if (searchable.includes(token)) score += 12;
  }

  return score;
}

function searchTokens(text: string) {
  const stopWords = new Set([
    "agreement",
    "called",
    "confirm",
    "monday",
    "move",
    "please",
    "stage",
    "status",
    "update",
  ]);

  return [
    ...new Set(
      text
        .split(/[^a-zA-Z0-9@._-]+/)
        .map((token) => normalizeSearch(token))
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    ),
  ];
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatDealOption(deal: SalesDeal) {
  const email = deal.email ? `, ${deal.email}` : "";
  const status = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(", ");

  return `${deal.account}${email}${status ? ` (${status})` : ""}`;
}
