import { NextResponse } from "next/server";
import { ensureSalesMemorySchedulerStarted } from "../../lib/sales-memory-scheduler";

export async function GET() {
  const memoryScheduler = ensureSalesMemorySchedulerStarted();
  return NextResponse.json({ ok: true, memoryScheduler });
}
