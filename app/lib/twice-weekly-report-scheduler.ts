import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTwiceWeeklySalesReport } from "./twice-weekly-report";

declare global {
  var salesBrainReportScheduler:
    | {
        startedAt: string;
        timer: NodeJS.Timeout;
      }
    | undefined;
}

const ONE_HOUR = 60 * 60 * 1000;

export function ensureTwiceWeeklyReportSchedulerStarted() {
  if (process.env.SALES_BRAIN_ENABLE_REPORT_SCHEDULER === "false") {
    return { enabled: false, started: false };
  }

  if (globalThis.salesBrainReportScheduler) {
    return {
      enabled: true,
      started: true,
      startedAt: globalThis.salesBrainReportScheduler.startedAt,
      schedule: scheduleDescription(),
    };
  }

  const run = () => {
    maybeSendScheduledReport().catch((error) => {
      console.error("Sales Brain scheduled report failed", error);
    });
  };

  const timer = setInterval(run, ONE_HOUR);
  timer.unref?.();
  globalThis.salesBrainReportScheduler = {
    startedAt: new Date().toISOString(),
    timer,
  };

  setTimeout(run, 20_000).unref?.();

  return {
    enabled: true,
    started: true,
    startedAt: globalThis.salesBrainReportScheduler.startedAt,
    schedule: scheduleDescription(),
  };
}

async function maybeSendScheduledReport() {
  const now = singaporeNow();

  if (!reportDays().includes(now.weekday)) return;
  if (now.hour < reportHour()) return;

  const key = `${now.date}:${now.weekday}`;
  const sent = await getLastSentReportKey();

  if (sent === key) return;

  await createTwiceWeeklySalesReport({ sendToChat: true });
  await setLastSentReportKey(key);
}

async function getLastSentReportKey() {
  try {
    return (await readFile(reportStatePath(), "utf8")).trim();
  } catch {
    return "";
  }
}

async function setLastSentReportKey(key: string) {
  await mkdir(reportStateDir(), { recursive: true });
  await writeFile(reportStatePath(), key);
}

function reportDays() {
  return (process.env.SALES_BRAIN_REPORT_DAYS || "tuesday,thursday")
    .split(",")
    .map((day) => day.trim().toLowerCase())
    .filter(Boolean);
}

function reportHour() {
  const parsed = Number(process.env.SALES_BRAIN_REPORT_HOUR || "9");
  return Number.isFinite(parsed) ? Math.max(0, Math.min(23, parsed)) : 9;
}

function singaporeNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";

  return {
    weekday: part("weekday").toLowerCase(),
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

function scheduleDescription() {
  return `${reportDays().join(", ")} at ${String(reportHour()).padStart(2, "0")}:00 Asia/Singapore`;
}

function reportStateDir() {
  return path.join(
    process.env.SALES_BRAIN_MEMORY_DIR || path.join(process.cwd(), ".sales-brain-memory"),
    "scheduled-reports",
  );
}

function reportStatePath() {
  return path.join(reportStateDir(), "twice-weekly-last-sent.txt");
}
