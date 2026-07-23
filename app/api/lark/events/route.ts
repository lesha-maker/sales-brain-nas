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
  appendSalesContextNote,
  clearPendingMondayAction,
  getConversationMemory,
  getConfiguredSalesBoardIds,
  getLatestSalesMemory,
  getPendingMondayAction,
  getSalesContextNotes,
  registerLarkMessageDelivery,
  setPendingMondayAction,
  type ConversationMessage,
  type PendingMondayAction,
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
    sender?: {
      sender_id?: {
        open_id?: string;
        union_id?: string;
        user_id?: string;
      };
      sender_type?: string;
      tenant_key?: string;
    };
    message?: {
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      chat_id?: string;
      message_type?: string;
      content?: string;
      chat_type?: string;
      mentions?: Array<{
        key?: string;
        name?: string;
        id?: {
          open_id?: string;
          union_id?: string;
          user_id?: string;
        };
      }>;
    };
  };
};

const FINAL_VERDICT_COLUMN_ID = "color_mm594jh8";
const CALL_STAGE_COLUMN_ID = "color_mm4j8pct";
const CMO_DINNER_FINAL_VERDICT_COLUMN_ID = "color_mm5grmg3";
const CMO_DINNER_AFTER_DINNER_STATUS_COLUMN_ID = "color_mm5gctyq";

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

  if (!shouldAnswerLarkMessage(message)) {
    return NextResponse.json({ ok: true, ignored: "group-message-without-mention" });
  }

  const isFirstDelivery = await registerLarkMessageDelivery(messageId);

  if (!isFirstDelivery) {
    return NextResponse.json({ ok: true, ignored: "duplicate-message" });
  }

  const question = parseTextContent(message.content);
  const threadId = conversationThreadId(message);
  const conversation = await getConversationMemory(threadId);
  const boardData = await loadSalesBoardDeals();
  const contextNotes = await getSalesContextNotes();
  const answer =
    (await maybeHandleMondayWrite({
      question,
      threadId,
      boardId: boardData.boardId,
      deals: boardData.deals,
      conversation,
    })) ||
    (await maybeHandleSalesMemoryCapture({
      question,
      threadId,
      boardId: boardData.boardId,
      deals: boardData.deals,
    })) ||
    (await answerSalesQuestion({
      question,
      deals: boardData.deals,
      conversation,
      contextNotes,
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

  if (isDirectMessage(message)) {
    await notifyDmMonitor({
      message,
      sender: payload.event?.sender,
      question,
      answer,
    });
  }

  return NextResponse.json({ ok: true });
}

function parseTextContent(content?: string) {
  if (!content) return "";

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return removeBotMentions(parsed.text ?? "");
  } catch {
    return removeBotMentions(content);
  }
}

function shouldAnswerLarkMessage(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  if (!isGroupChat(message?.chat_type)) return true;

  return isBotMentioned(message);
}

function isGroupChat(chatType?: string) {
  const normalized = chatType?.toLowerCase() ?? "";
  return normalized.includes("group") || normalized === "chat";
}

function isDirectMessage(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  const normalized = message?.chat_type?.toLowerCase() ?? "";
  return ["p2p", "private", "direct", "single"].some((type) => normalized.includes(type));
}

function isBotMentioned(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  const mentions = message?.mentions ?? [];

  if (
    mentions.some((mention) => {
      const label = `${mention.name ?? ""} ${mention.key ?? ""}`.toLowerCase();
      return label.includes("harry") || label.includes("sales agent");
    })
  ) {
    return true;
  }

  const rawContent = message?.content ?? "";
  return /<at\b/i.test(rawContent) && /\b(harry|sales agent)\b/i.test(rawContent);
}

function removeBotMentions(text: string) {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/gi, " ")
    .replace(/@\s*Harry the sales agent\b/gi, " ")
    .replace(/@\s*Harry\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function conversationThreadId(message: NonNullable<LarkEventPayload["event"]>["message"]) {
  // Keep group replies and the main room in one memory stream.
  return (
    message?.chat_id ||
    message?.root_id ||
    message?.parent_id ||
    message?.message_id ||
    "lark-default-thread"
  );
}

async function notifyDmMonitor({
  message,
  sender,
  question,
  answer,
}: {
  message: NonNullable<LarkEventPayload["event"]>["message"];
  sender?: NonNullable<LarkEventPayload["event"]>["sender"];
  question: string;
  answer: string;
}) {
  const monitorChatId =
    process.env.LARK_DM_MONITOR_CHAT_ID ||
    process.env.LARK_SALES_REPORT_CHAT_ID ||
    process.env.LARK_SALES_CHAT_ID;

  if (!monitorChatId || monitorChatId === message?.chat_id) return;

  const senderId =
    sender?.sender_id?.user_id ||
    sender?.sender_id?.open_id ||
    sender?.sender_id?.union_id ||
    "unknown sender";

  try {
    await sendLarkTextReport({
      chatId: monitorChatId,
      text: [
        "Harry DM monitor",
        `From: ${senderId}`,
        `Question: ${truncateForMonitor(question)}`,
        `Harry: ${truncateForMonitor(answer)}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Unable to send Harry DM monitor notification", error);
  }
}

function truncateForMonitor(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1197)}...` : normalized;
}

async function loadSalesBoardDeals() {
  const boardIds = getConfiguredSalesBoardIds();

  if (!boardIds.length) {
    throw new Error("Sales Brain is missing MONDAY_SALES_BOARD_IDS, so I cannot read the CRM yet.");
  }

  const memory = await getLatestSalesMemory();

  if (memory?.deals.length && memory.deals.some((deal) => deal.group)) {
    return { boardId: boardIds[0], deals: memory.deals };
  }

  const snapshots = await Promise.all(boardIds.map((boardId) => getBoardSnapshot(boardId)));
  return {
    boardId: boardIds[0],
    deals: snapshots.flatMap((snapshot) => snapshot.deals),
  };
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
    const action =
      (await getPendingMondayAction(threadId)) ||
      recoverPendingMondayAction({ conversation, boardId, deals });

    if (!action) {
      return "";
    }

    return executePendingMondayAction({ threadId, action });
  }

  const updateIntent = mondayUpdateIntent(question, conversation);

  if (!updateIntent) {
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
  const action = {
    id: `${Date.now()}-${deal.id}`,
    createdAt: new Date().toISOString(),
    boardId: deal.boardId || boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description: updateIntent.description,
    columnValues: columnValuesForUpdateIntent(updateIntent, deal),
  } satisfies PendingMondayAction;

  if (hasApprovalLanguage(question)) {
    return executePendingMondayAction({ threadId, action });
  }

  await setPendingMondayAction(threadId, action);

  const currentStage = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(", ");
  const stageText = currentStage ? ` It is currently at ${currentStage}.` : "";

  return `I found ${formatSelectedDeal(deal)}.${stageText} Reply yes to confirm, and I'll ${updateIntent.confirmationText}.`;
}

async function executePendingMondayAction({
  threadId,
  action,
}: {
  threadId: string;
  action: PendingMondayAction;
}) {
  if (action.columnValues && Object.keys(action.columnValues).length) {
    await changeDealColumns({
      boardId: action.boardId,
      itemId: action.itemId,
      columnValues: action.columnValues,
    });
  }

  await createDealUpdate({
    itemId: action.itemId,
    body:
      action.updateBody ||
      `Sales Brain updated ${action.description} after explicit Lark approval.`,
  });

  await clearPendingMondayAction(threadId);

  const email = action.email ? ` (${action.email})` : "";
  return `Done - I updated ${action.account}${email} in monday: ${action.description}.`;
}

function recoverPendingMondayAction({
  conversation,
  boardId,
  deals,
}: {
  conversation: ConversationMessage[];
  boardId: string;
  deals: SalesDeal[];
}) {
  const latestUpdateRequest = [...conversation]
    .reverse()
    .filter((message) => message.role === "user")
    .map((message) => message.text)
    .find((message) => mondayUpdateIntent(message, []));

  if (!latestUpdateRequest) return null;

  const updateIntent = mondayUpdateIntent(latestUpdateRequest, []);
  if (!updateIntent) return null;

  const matches = findDealMatches({
    question: latestUpdateRequest,
    conversation,
    deals,
  }).slice(0, 2);

  if (matches.length !== 1) return null;

  const deal = matches[0];

  return {
    id: `${Date.now()}-${deal.id}`,
    createdAt: new Date().toISOString(),
    boardId: deal.boardId || boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description: updateIntent.description,
    columnValues: columnValuesForUpdateIntent(updateIntent, deal),
  } satisfies PendingMondayAction;
}

async function maybeHandleSalesMemoryCapture({
  question,
  threadId,
  boardId,
  deals,
}: {
  question: string;
  threadId: string;
  boardId: string;
  deals: SalesDeal[];
}) {
  if (!isSalesMemoryCaptureIntent(question)) return "";

  const matches = findDealMatches({ question, conversation: [], deals }).slice(0, 5);
  const note = extractSalesMemoryNote(question);

  if (!matches.length) {
    await appendSalesContextNote({
      threadId,
      source: "lark",
      rawText: question,
      note,
    });

    return "Got it - I saved this in Sales Brain memory, but I could not confidently match it to a monday lead yet. Add the company name or email if you want me to attach it to a CRM record.";
  }

  if (matches.length > 1) {
    const names = matches.map(formatDealOption).join("; ");
    return `I found multiple possible CRM records for this note: ${names}. Which one should I attach it to?`;
  }

  const deal = matches[0];
  const saved = await appendSalesContextNote({
    threadId,
    source: "lark",
    rawText: question,
    note,
    account: deal.account,
    itemId: deal.id,
    email: deal.email,
  });

  await setPendingMondayAction(threadId, {
    id: saved.id,
    createdAt: saved.createdAt,
    boardId: deal.boardId || boardId,
    itemId: deal.id,
    account: deal.account,
    email: deal.email,
    description: "added Sales Brain context note to monday",
    updateBody: `Sales Brain context from Lark:\n\n${note}`,
  });

  const email = deal.email ? ` (${deal.email})` : "";
  return `Got it - I saved this to Sales Brain memory for ${deal.account}${email}. Reply yes if you also want me to add it as a monday update.`;
}

function isConfirmation(question: string) {
  const normalized = question.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);

  if (!normalized || words.length > 6) return false;
  if (/\b(no|nope|not|don't|dont|stop|cancel|wait)\b/.test(normalized)) return false;
  if (/\b(can you|how many|what|which|who|list|show|tell|give)\b/.test(normalized)) {
    return false;
  }

  return hasApprovalLanguage(normalized);
}

function hasApprovalLanguage(question: string) {
  return /\b(yes|yep|yeah|confirm|approved|approve|do it|go ahead|ok|okay|please do it|pls do it)\b/i.test(
    question,
  );
}

function isSalesMemoryCaptureIntent(question: string) {
  const normalized = question.toLowerCase();
  const hasMemoryVerb =
    /\b(remember|note|memorize|save|store|context|add to sales brain|add to crm|update crm|crm note|sales note)\b/.test(
      normalized,
    );
  const hasSalesSubject =
    /\b(lead|client|customer|deal|sales|crm|monday|proposal|pricing|budget|decision maker|objection|next step|follow up|agreement|close|closing)\b/.test(
      normalized,
    );

  return hasMemoryVerb && hasSalesSubject;
}

function extractSalesMemoryNote(question: string) {
  return question
    .replace(
      /^\s*(remember|note|memorize|save|store|context|add to sales brain|add to crm|update crm|crm note|sales note)\s*(this|that|for)?\s*[:,-]?\s*/i,
      "",
    )
    .trim();
}

function mondayUpdateIntent(
  question: string,
  conversation: ConversationMessage[],
) {
  const normalized = question.toLowerCase();

  if (isReadOnlySalesQuestion(normalized)) {
    return null;
  }

  const recentUserText = conversation
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => message.text)
    .join(" ")
    .toLowerCase();

  const combined = `${recentUserText} ${normalized}`;
  const mentionsAgreement = combined.includes("agreement");
  const mentionsMeetingBooked =
    /\b(meeting\s+booked|booked\s+(?:a\s+)?meeting)\b/.test(combined);
  const currentMessageHasUpdateVerb = /\b(move|update|change|set|put|make)\b/.test(normalized);
  const recentMessageHadUpdateVerb = /\b(move|update|change|set|put|make)\b/.test(recentUserText);
  const currentMessageLooksLikeSelection = searchTokens(normalized).length > 0;
  const currentMessageLooksShort = searchTokens(normalized).length <= 3;
  const isUpdate =
    currentMessageHasUpdateVerb ||
    (recentMessageHadUpdateVerb && currentMessageLooksLikeSelection && currentMessageLooksShort);

  if (!isUpdate) return null;

  if (mentionsMeetingBooked) {
    return {
      kind: "meeting-booked",
      description: "moved Call Stage to Meeting Booked",
      confirmationText: "move Call Stage to Meeting Booked in monday",
    };
  }

  if (mentionsAgreement) {
    return {
      kind: "agreement-stage",
      description: "moved Final verdict to Agreement Stage",
      confirmationText: "move Final verdict to Agreement Stage in monday",
    };
  }

  return null;
}

function columnValuesForUpdateIntent(
  updateIntent: NonNullable<ReturnType<typeof mondayUpdateIntent>>,
  deal: SalesDeal,
) {
  if (updateIntent.kind === "meeting-booked") {
    return {
      [callStageColumnIdFor(deal)]: {
        label: isCmoDinnerDeal(deal) ? "Meeting Booked" : "Booked a Meeting",
      },
    };
  }

  return {
    [finalVerdictColumnIdFor(deal)]: { label: "Agreement Stage" },
  };
}

function callStageColumnIdFor(deal: SalesDeal) {
  return isCmoDinnerDeal(deal) ? CMO_DINNER_AFTER_DINNER_STATUS_COLUMN_ID : CALL_STAGE_COLUMN_ID;
}

function finalVerdictColumnIdFor(deal: SalesDeal) {
  return isCmoDinnerDeal(deal) ? CMO_DINNER_FINAL_VERDICT_COLUMN_ID : FINAL_VERDICT_COLUMN_ID;
}

function isCmoDinnerDeal(deal: SalesDeal) {
  return deal.boardId === "5030120019" || (deal.boardName || "").toLowerCase().includes("cmo dinner");
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
  const boardHint = boardContextHint([...recentUserMessages, question].join(" "));

  if (!tokens.length) return [];

  const ranked = deals
    .map((deal) => {
      const directScore = relevanceScore(deal, tokens);
      const contextBonus = directScore > 0 ? relevanceScore(deal, contextTokens) * 0.25 : 0;
      const boardBonus =
        boardHint && dealMatchesBoardHint(deal, boardHint) && directScore > 0 ? 40 : 0;

      return {
        deal,
        score: directScore + contextBonus + boardBonus,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const confidentMatch = confidentSingleMatch(ranked);
  if (confidentMatch) return [confidentMatch.deal];

  return ranked.map((item) => item.deal);
}

function confidentSingleMatch(ranked: Array<{ deal: SalesDeal; score: number }>) {
  const [top, second] = ranked;

  if (!top) return null;
  if (!second) return top.score >= 80 ? top : null;

  const scoreGap = top.score - second.score;

  if (top.score >= 180 && scoreGap >= 80) return top;
  if (top.score >= 280 && scoreGap >= 40 && isCmoDinnerDeal(top.deal)) return top;

  return null;
}

function relevanceScore(deal: SalesDeal, tokens: string[]) {
  const account = normalizeSearch(deal.account);
  const email = normalizeSearch(deal.email);
  const firstName = normalizeSearch(deal.firstName);
  const lastName = normalizeSearch(deal.lastName);
  const website = normalizeSearch(deal.website);
  const boardName = normalizeSearch(deal.boardName || "");
  const searchable = `${account} ${email} ${firstName} ${lastName} ${website} ${boardName}`;
  let score = 0;
  let matchedAccount = false;
  let matchedExactAccount = false;
  let matchedFirstName = false;

  for (const token of tokens) {
    if (email && email.includes(token)) score += 80;
    if (firstName && firstName === token) {
      score += 70;
      matchedFirstName = true;
    }
    if (lastName && lastName === token) score += 70;
    if (account && account === token) {
      score += 100;
      matchedAccount = true;
      matchedExactAccount = true;
    } else if (account && (account.includes(token) || token.includes(account))) {
      score += 40;
      matchedAccount = true;
    }
    if (boardName && boardName.includes(token)) score += 8;
    else if (searchable.includes(token)) score += 12;
  }

  if (matchedExactAccount && matchedFirstName) score += 150;
  else if (matchedAccount && matchedFirstName) score += 20;

  return score;
}

function boardContextHint(text: string) {
  const normalized = text.toLowerCase();

  if (/\b(cmo|dinner)\b/.test(normalized)) return "cmo-dinner";
  return "";
}

function dealMatchesBoardHint(deal: SalesDeal, hint: string) {
  if (hint === "cmo-dinner") {
    return deal.boardId === "5030120019" || (deal.boardName || "").toLowerCase().includes("cmo dinner");
  }

  return false;
}

function searchTokens(text: string) {
  const stopWords = new Set([
    "agreement",
    "called",
    "confirm",
    "company",
    "dinner",
    "from",
    "lead",
    "meeting",
    "monday",
    "move",
    "one",
    "please",
    "stage",
    "status",
    "that",
    "update",
  ]);

  return [
    ...new Set(
      text
        .split(/[^a-zA-Z0-9@._-]+/)
        .map((token) => normalizeSearch(token))
        .filter((token) => token.length >= 3 && !stopWords.has(token)),
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

function formatSelectedDeal(deal: SalesDeal) {
  const contact = [deal.firstName, deal.lastName].filter(Boolean).join(" ");
  const email = deal.email ? `, ${deal.email}` : "";
  const contactText = contact ? ` (${contact}${email})` : email ? ` (${deal.email})` : "";

  return `${deal.account}${contactText}`;
}
