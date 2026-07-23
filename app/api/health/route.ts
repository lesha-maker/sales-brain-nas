import { NextResponse } from "next/server";
import { ensureSalesMemorySchedulerStarted } from "../../lib/sales-memory-scheduler";
import { ensureTwiceWeeklyReportSchedulerStarted } from "../../lib/twice-weekly-report-scheduler";

export async function GET() {
  const memoryScheduler = ensureSalesMemorySchedulerStarted();
  const reportScheduler = ensureTwiceWeeklyReportSchedulerStarted();
  return NextResponse.json({
    ok: true,
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      "unknown",
    memoryScheduler,
    reportScheduler,
  });
}
