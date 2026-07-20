import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { SalesDeal } from "./monday";
import { getBoardSnapshot } from "./monday";

export type SalesMemorySnapshot = {
  id: string;
  generatedAt: string;
  board: {
    id: string;
    name: string;
  };
  summary: SalesMemorySummary;
  deals: SalesDeal[];
};

export type SalesMemorySummary = {
  totalRecords: number;
  byQualification: Record<string, number>;
  byInitialOutreach: Record<string, number>;
  byCallStage: Record<string, number>;
  byNextSteps: Record<string, number>;
  byFinalVerdict: Record<string, number>;
  byOwner: Record<string, number>;
  missing: {
    owner: number;
    email: number;
    agentNotes: number;
    nextStep: number;
    lastFollowUp: number;
  };
};

export type SalesMemoryChange = {
  crawledAt: string;
  itemId: string;
  account: string;
  field: keyof SalesDeal | "created" | "removed";
  before?: string;
  after?: string;
};

const trackedFields: Array<keyof SalesDeal> = [
  "owner",
  "email",
  "qualification",
  "initialOutreach",
  "callStage",
  "nextStepsStatus",
  "finalVerdict",
  "firstMeetingDate",
  "latestMeetingDate",
  "lastFollowUpDate",
  "budget",
  "agentNotes",
  "salesCallNotes",
  "followUp",
];

let activeCrawl: Promise<SalesMemorySnapshot> | null = null;

export async function crawlSalesMemory(boardId: string) {
  if (activeCrawl) return activeCrawl;

  activeCrawl = crawlAndStore(boardId).finally(() => {
    activeCrawl = null;
  });

  return activeCrawl;
}

export async function getLatestSalesMemory() {
  try {
    const raw = await readFile(memoryPath("latest.json"), "utf8");
    return JSON.parse(raw) as SalesMemorySnapshot;
  } catch {
    return null;
  }
}

export async function getRecentSalesMemoryChanges(limit = 100) {
  try {
    const raw = await readFile(memoryPath("changes.jsonl"), "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as SalesMemoryChange);
  } catch {
    return [];
  }
}

async function crawlAndStore(boardId: string) {
  const previous = await getLatestSalesMemory();
  const { board, deals } = await getBoardSnapshot(boardId);

  if (!board) {
    throw new Error("monday board was not found.");
  }

  const generatedAt = new Date().toISOString();
  const snapshot: SalesMemorySnapshot = {
    id: generatedAt.replace(/[:.]/g, "-"),
    generatedAt,
    board: {
      id: board.id,
      name: board.name,
    },
    summary: buildSummary(deals),
    deals,
  };

  const changes = diffSnapshots(previous, snapshot);
  await writeSnapshot(snapshot, changes);
  return snapshot;
}

function buildSummary(deals: SalesDeal[]): SalesMemorySummary {
  return {
    totalRecords: deals.length,
    byQualification: countBy(deals, (deal) => deal.qualification || "Blank"),
    byInitialOutreach: countBy(deals, (deal) => deal.initialOutreach || "Blank"),
    byCallStage: countBy(deals, (deal) => deal.callStage || "Blank"),
    byNextSteps: countBy(deals, (deal) => deal.nextStepsStatus || "Blank"),
    byFinalVerdict: countBy(deals, (deal) => deal.finalVerdict || "Blank"),
    byOwner: countBy(deals, (deal) => deal.owner || "Unassigned"),
    missing: {
      owner: deals.filter((deal) => !deal.owner || deal.owner === "Unassigned").length,
      email: deals.filter((deal) => !deal.email).length,
      agentNotes: deals.filter((deal) => !deal.agentNotes).length,
      nextStep: deals.filter((deal) => !deal.nextStepsStatus && !deal.followUp).length,
      lastFollowUp: deals.filter((deal) => !deal.lastFollowUpDate).length,
    },
  };
}

function diffSnapshots(
  previous: SalesMemorySnapshot | null,
  current: SalesMemorySnapshot,
): SalesMemoryChange[] {
  if (!previous) {
    return current.deals.map((deal) => ({
      crawledAt: current.generatedAt,
      itemId: deal.id,
      account: deal.account,
      field: "created",
      after: deal.stage,
    }));
  }

  const changes: SalesMemoryChange[] = [];
  const previousById = new Map(previous.deals.map((deal) => [deal.id, deal]));
  const currentById = new Map(current.deals.map((deal) => [deal.id, deal]));

  for (const deal of current.deals) {
    const before = previousById.get(deal.id);

    if (!before) {
      changes.push({
        crawledAt: current.generatedAt,
        itemId: deal.id,
        account: deal.account,
        field: "created",
        after: deal.stage,
      });
      continue;
    }

    for (const field of trackedFields) {
      const oldValue = stringifyDealValue(before[field]);
      const newValue = stringifyDealValue(deal[field]);

      if (oldValue !== newValue) {
        changes.push({
          crawledAt: current.generatedAt,
          itemId: deal.id,
          account: deal.account,
          field,
          before: oldValue,
          after: newValue,
        });
      }
    }
  }

  for (const deal of previous.deals) {
    if (!currentById.has(deal.id)) {
      changes.push({
        crawledAt: current.generatedAt,
        itemId: deal.id,
        account: deal.account,
        field: "removed",
        before: deal.stage,
      });
    }
  }

  return changes;
}

async function writeSnapshot(snapshot: SalesMemorySnapshot, changes: SalesMemoryChange[]) {
  const dir = memoryDir();
  await mkdir(dir, { recursive: true });

  const latestPath = memoryPath("latest.json");
  const tempPath = memoryPath(`latest.${process.pid}.tmp`);
  await writeFile(tempPath, JSON.stringify(snapshot, null, 2));
  await rename(tempPath, latestPath);

  const crawlLog = {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    totalRecords: snapshot.summary.totalRecords,
    changeCount: changes.length,
    summary: snapshot.summary,
  };

  await appendFile(memoryPath("crawls.jsonl"), `${JSON.stringify(crawlLog)}\n`);

  if (changes.length) {
    await appendFile(
      memoryPath("changes.jsonl"),
      `${changes.map((change) => JSON.stringify(change)).join("\n")}\n`,
    );
  }
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function stringifyDealValue(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function memoryPath(fileName: string) {
  return path.join(memoryDir(), fileName);
}

function memoryDir() {
  return process.env.SALES_BRAIN_MEMORY_DIR || path.join(process.cwd(), ".sales-brain-memory");
}
