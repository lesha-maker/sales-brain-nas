import { NextRequest, NextResponse } from "next/server";
import { getBoardSnapshot } from "../../../lib/monday";
import { replyToLarkMessage } from "../../../lib/lark";

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

  if (expectedToken && receivedToken && receivedToken !== expectedToken) {
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
  const answer = await answerFromSalesBoard(question);

  await replyToLarkMessage({
    messageId,
    text: answer,
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

async function answerFromSalesBoard(question: string) {
  const boardId = process.env.MONDAY_SALES_BOARD_ID;

  if (!boardId) {
    return "Sales Brain is missing MONDAY_SALES_BOARD_ID, so I cannot read the CRM yet.";
  }

  const { deals } = await getBoardSnapshot(boardId);
  const normalized = question.toLowerCase();
  const weighted = deals.reduce(
    (sum, deal) => sum + deal.value * (deal.probability / 100),
    0,
  );
  const atRisk = deals
    .filter((deal) => deal.health !== "Green")
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, 5);
  const fit = deals
    .filter((deal) => deal.stage === "Fit")
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, 5);

  if (normalized.includes("stuck") || normalized.includes("risk")) {
    return [
      `I found ${atRisk.length} top risk records to check first:`,
      ...atRisk.map(
        (deal) =>
          `- ${deal.account}: ${deal.stage}, ${deal.budget}, owner ${deal.owner}, next step: ${deal.nextStep}`,
      ),
    ].join("\n");
  }

  if (normalized.includes("fit") || normalized.includes("qualified")) {
    return [
      `Top Fit records from monday:`,
      ...fit.map(
        (deal) =>
          `- ${deal.account}: ${deal.budget}, ${deal.country || "no country"}, owner ${deal.owner}`,
      ),
    ].join("\n");
  }

  if (normalized.includes("pipeline") || normalized.includes("forecast")) {
    return `Loaded ${deals.length} monday records. Estimated weighted pipeline is $${Math.round(
      weighted,
    ).toLocaleString("en-US")}.`;
  }

  return [
    `I loaded ${deals.length} monday records.`,
    `Ask me: "what deals are stuck?", "show top fit leads", or "what is pipeline forecast?"`,
  ].join("\n");
}
