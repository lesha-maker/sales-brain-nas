import { crawlSalesMemory } from "./sales-memory";

declare global {
  var salesBrainMemoryScheduler:
    | {
        startedAt: string;
        timer: NodeJS.Timeout;
      }
    | undefined;
}

const TEN_MINUTES = 10 * 60 * 1000;

export function ensureSalesMemorySchedulerStarted() {
  if (process.env.SALES_BRAIN_ENABLE_SCHEDULER !== "true") {
    return { enabled: false, started: false };
  }

  if (globalThis.salesBrainMemoryScheduler) {
    return {
      enabled: true,
      started: false,
      startedAt: globalThis.salesBrainMemoryScheduler.startedAt,
    };
  }

  const boardId = process.env.MONDAY_SALES_BOARD_ID;

  if (!boardId) {
    return { enabled: true, started: false, error: "MONDAY_SALES_BOARD_ID is missing." };
  }

  const run = () => {
    crawlSalesMemory(boardId).catch((error) => {
      console.error("Sales Brain memory crawl failed", error);
    });
  };

  const timer = setInterval(run, TEN_MINUTES);
  timer.unref?.();
  globalThis.salesBrainMemoryScheduler = {
    startedAt: new Date().toISOString(),
    timer,
  };

  setTimeout(run, 5_000).unref?.();

  return {
    enabled: true,
    started: true,
    startedAt: globalThis.salesBrainMemoryScheduler.startedAt,
  };
}
