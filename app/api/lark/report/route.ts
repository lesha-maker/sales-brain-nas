import { NextRequest, NextResponse } from "next/server";
import { sendLarkTextReport } from "../../../lib/lark";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { text?: string; chatId?: string };
  const chatId = body.chatId || process.env.LARK_SALES_CHAT_ID;

  if (!chatId) {
    return NextResponse.json({ error: "LARK_SALES_CHAT_ID is required." }, { status: 400 });
  }

  if (!body.text) {
    return NextResponse.json({ error: "Report text is required." }, { status: 400 });
  }

  try {
    const result = await sendLarkTextReport({ chatId, text: body.text });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send report." },
      { status: 502 },
    );
  }
}
