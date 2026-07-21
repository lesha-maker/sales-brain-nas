import type { LarkDocumentContentBlock } from "./lark";
import type { SalesDeal } from "./monday";
import type { SalesMemoryChange, SalesMemorySnapshot } from "./sales-memory";

export function buildCeoSalesReport({
  snapshot,
  recentChanges,
}: {
  snapshot: SalesMemorySnapshot;
  recentChanges: SalesMemoryChange[];
}) {
  const deals = snapshot.deals;
  const inbound = deals.filter(isInbound);
  const outbound = deals.filter(isOutbound);
  const generatedAt = new Date(snapshot.generatedAt);
  const reportDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(generatedAt);
  const title = `CEO Sales Snapshot - ${reportDate}`;
  const completed = deals.filter((deal) => deal.finalVerdict === "Completed");
  const agreementStage = deals.filter((deal) => deal.finalVerdict === "Agreement Stage");
  const highProbability = highProbabilityDeals(deals);
  const upcomingCalls = upcomingBookedMeetings(deals);
  const weekAgreementMoves = changesThisWeek(recentChanges).filter(
    (change) => change.field === "finalVerdict" && change.after === "Agreement Stage",
  );
  const notableConversations = notableConversationDeals(deals);
  const keyPoints = [
    `This week, ${weekAgreementMoves.length} clients moved into Agreement Stage: ${listNames(
      weekAgreementMoves.map((change) => change.account),
    )}.`,
    `Ironasylum is worth noting: sales qualified, Facebook source, owned by Ildiko, first meeting on ${firstDeal(
      deals,
      "Ironasylum",
    )?.firstMeetingDate || "unknown date"}.`,
    `${upcomingCalls.length} booked meetings are coming up from today onward.`,
    `${snapshot.summary.missing.owner.toLocaleString()} records are still unassigned. That is the main operating risk in the CRM.`,
  ];

  const blocks: LarkDocumentContentBlock[] = [
    paragraph(title),
    paragraph(
      `Snapshot as of ${reportDate}: ${snapshot.summary.totalRecords.toLocaleString()} total records, ${countWhere(
        deals,
        (deal) => deal.callStage === "Sales Qualified",
      )} sales qualified, ${agreementStage.length} agreement stage, ${completed.length} completed.`,
    ),
    paragraph("FIRST FOLD - WHAT THE CEO NEEDS TO SEE"),
    table(firstFoldRows({ completed, agreementStage, highProbability })),
    paragraph("KEY POINTS TO NOTE"),
    ...keyPoints.map(paragraph),
    paragraph("INBOUND SNAPSHOT"),
    table(segmentRows(inbound), [130, 90, 90, 90, 90, 90, 90]),
    paragraph("Top inbound names/stages are included in the first-fold table when they are completed, agreement stage, or high probability."),
    paragraph("OUTBOUND SNAPSHOT"),
    table(segmentRows(outbound), [130, 90, 90, 90, 90, 90, 90]),
    paragraph("UPCOMING CALLS"),
    table(dealRows(upcomingCalls.slice(0, 8)), [170, 130, 125, 120, 125, 130, 150]),
    paragraph("NOTEWORTHY NEW OR ACTIVE CONVERSATIONS"),
    table(dealRows(notableConversations.slice(0, 8)), [170, 130, 125, 120, 125, 130, 150]),
    paragraph("CEO ACTIONS"),
    table(
      [
        ["Priority", "Action", "Why it matters"],
        [
          "1",
          "Assign owners to all active unassigned records.",
          "Unowned qualified leads are the fastest way for pipeline to leak.",
        ],
        [
          "2",
          "Review every Agreement Stage and high-probability record today.",
          "This is the smallest set with the clearest revenue signal.",
        ],
        [
          "3",
          "Use outbound as a high-intent motion, not a volume motion.",
          "Outbound has fewer records but much higher sales-qualified density.",
        ],
      ],
      [70, 310, 370],
    ),
  ];

  return {
    title,
    blocks,
    sheetValues: blocksToSheetValues(blocks),
    paragraphs: blocks.flatMap((block) =>
      block.type === "paragraph" ? [block.text] : [block.rows.map((row) => row.join(" | ")).join("\n")],
    ),
    plainText: blocks
      .map((block) =>
        block.type === "paragraph" ? block.text : block.rows.map((row) => row.join(" | ")).join("\n"),
      )
      .join("\n\n"),
  };
}

function blocksToSheetValues(blocks: LarkDocumentContentBlock[]) {
  const values: string[][] = [];

  for (const block of blocks) {
    if (block.type === "paragraph") {
      values.push([block.text]);
      values.push([]);
      continue;
    }

    values.push(...block.rows);
    values.push([]);
  }

  return values;
}

function firstFoldRows({
  completed,
  agreementStage,
  highProbability,
}: {
  completed: SalesDeal[];
  agreementStage: SalesDeal[];
  highProbability: SalesDeal[];
}) {
  return [
    ["Bucket", "Account", "Owner", "Current Stage", "Source", "Meeting", "Budget", "Note"],
    ...bucketRows("Completed", completed, 4),
    ...bucketRows("Agreement Stage", agreementStage, 5),
    ...bucketRows("High probability", highProbability, 8),
  ];
}

function bucketRows(bucket: string, deals: SalesDeal[], limit: number) {
  if (!deals.length) {
    return [[bucket, "None", "", "", "", "", "", ""]];
  }

  return deals.slice(0, limit).map((deal) => [
    bucket,
    deal.account,
    cleanOwner(deal.owner),
    stageFor(deal),
    sourceFor(deal),
    deal.firstMeetingDate || deal.latestMeetingDate || "",
    cleanValue(deal.budget),
    shortNote(deal),
  ]);
}

function segmentRows(deals: SalesDeal[]) {
  return [
    ["Segment", "Total", "Fit", "Review", "Sales Qualified", "Booked Meetings", "Agreement"],
    [
      isOutbound(deals[0] || ({} as SalesDeal)) ? "Outbound" : "Inbound",
      String(deals.length),
      String(countWhere(deals, (deal) => deal.qualification === "Fit")),
      String(countWhere(deals, (deal) => deal.qualification === "Review")),
      String(countWhere(deals, (deal) => deal.callStage === "Sales Qualified")),
      String(countWhere(deals, (deal) => deal.callStage === "Booked a Meeting")),
      String(countWhere(deals, (deal) => deal.finalVerdict === "Agreement Stage")),
    ],
  ];
}

function dealRows(deals: SalesDeal[]) {
  return [
    ["Account", "Owner", "Stage", "Source", "Meeting", "Budget", "Contact"],
    ...deals.map((deal) => [
      deal.account,
      cleanOwner(deal.owner),
      stageFor(deal),
      sourceFor(deal),
      deal.firstMeetingDate || deal.latestMeetingDate || "",
      cleanValue(deal.budget),
      deal.email || "",
    ]),
  ];
}

function highProbabilityDeals(deals: SalesDeal[]) {
  return topActiveDeals(
    deals.filter((deal) => {
      if (["Completed", "Agreement Stage", "Lost", "Gone Cold"].includes(deal.finalVerdict)) {
        return false;
      }

      return (
        ["Confirmed (Verbal)", "2nd call with Nuseir"].includes(deal.finalVerdict) ||
        deal.nextStepsStatus === "Proposal Done" ||
        (deal.callStage === "Sales Qualified" && deal.qualification === "Fit")
      );
    }),
    14,
  );
}

function topActiveDeals(deals: SalesDeal[], limit: number) {
  return [...deals]
    .filter((deal) =>
      [
        "Sales Qualified",
        "Booked a Meeting",
        "Proposal Done",
        "Proposal Stage",
        "Agreement Stage",
        "Completed",
        "Followed-Up",
      ].some((stage) => stageFor(deal).includes(stage)),
    )
    .sort((a, b) => {
      const stageScore = scoreDeal(b) - scoreDeal(a);
      if (stageScore) return stageScore;
      return b.value * b.probability - a.value * a.probability;
    })
    .slice(0, limit);
}

function notableConversationDeals(deals: SalesDeal[]) {
  const notableNames = ["Ironasylum", "LetsBeco", "Medlounges", "DS18", "Flexar"];
  const named = deals.filter((deal) =>
    notableNames.some((name) => deal.account.toLowerCase().includes(name.toLowerCase())),
  );
  const recentHighBudget = deals.filter(
    (deal) =>
      ["$300k-1m /year", "$1m+ /year", "$1m+ / year"].includes(deal.budget) &&
      ["Fit", "Review", "5"].includes(deal.qualification),
  );

  return uniqueDeals([...named, ...topActiveDeals(recentHighBudget, 10)]).slice(0, 16);
}

function scoreDeal(deal: SalesDeal) {
  const stage = stageFor(deal);
  if (stage.includes("Completed")) return 100;
  if (stage.includes("Agreement Stage")) return 90;
  if (stage.includes("Confirmed")) return 80;
  if (stage.includes("2nd call")) return 75;
  if (stage.includes("Proposal Done")) return 70;
  if (stage.includes("Proposal Stage")) return 60;
  if (stage.includes("Sales Qualified")) return 50;
  if (stage.includes("Booked a Meeting")) return 40;
  return 0;
}

function changesThisWeek(changes: SalesMemoryChange[]) {
  const weekStart = startOfWeekInSingapore();
  return changes.filter((change) => dateOnly(change.crawledAt) >= weekStart);
}

function startOfWeekInSingapore() {
  const today = new Date(`${todayInSingapore()}T00:00:00+08:00`);
  const day = today.getUTCDay() || 7;
  today.setUTCDate(today.getUTCDate() - day + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
}

function upcomingBookedMeetings(deals: SalesDeal[]) {
  const today = todayInSingapore();

  return deals
    .filter((deal) => deal.callStage === "Booked a Meeting")
    .filter((deal) => {
      const meetingDate = dateOnly(deal.firstMeetingDate);
      return meetingDate ? meetingDate >= today : false;
    })
    .sort((a, b) => dateOnly(a.firstMeetingDate).localeCompare(dateOnly(b.firstMeetingDate)));
}

function firstDeal(deals: SalesDeal[], account: string) {
  return deals.find((deal) => deal.account.toLowerCase().includes(account.toLowerCase()));
}

function uniqueDeals(deals: SalesDeal[]) {
  const seen = new Set<string>();
  return deals.filter((deal) => {
    if (seen.has(deal.id)) return false;
    seen.add(deal.id);
    return true;
  });
}

function paragraph(text: string): LarkDocumentContentBlock {
  return { type: "paragraph", text };
}

function table(
  rows: string[][],
  columnWidths = [100, 160, 130, 140, 110, 120, 110, 220],
): LarkDocumentContentBlock {
  return {
    type: "table",
    rows: rows.map((row) => row.map((cell) => cleanCell(cell))),
    columnWidths,
  };
}

function stageFor(deal: SalesDeal) {
  return [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(" / ");
}

function sourceFor(deal: SalesDeal) {
  return deal.source && deal.source !== "5" ? deal.source : "Unknown";
}

function cleanOwner(owner: string) {
  return owner && owner !== "Unassigned" ? owner : "Unassigned";
}

function cleanValue(value: string) {
  return value && value !== "Unknown" ? value : "";
}

function shortNote(deal: SalesDeal) {
  if (deal.salesCallNotes) return deal.salesCallNotes;
  if (deal.followUp) return deal.followUp;
  if (deal.agentNotes) return deal.agentNotes.split("\n")[0] || deal.agentNotes;
  if (deal.lookingFor) return deal.lookingFor;
  return "";
}

function cleanCell(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function listNames(names: string[]) {
  if (!names.length) return "none";
  return [...new Set(names)].join(", ");
}

function isOutbound(deal: SalesDeal) {
  return deal.source?.toLowerCase().includes("outbound") || false;
}

function isInbound(deal: SalesDeal) {
  return !isOutbound(deal);
}

function countWhere(deals: SalesDeal[], predicate: (deal: SalesDeal) => boolean) {
  return deals.filter(predicate).length;
}

function todayInSingapore() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateOnly(value: string) {
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}
