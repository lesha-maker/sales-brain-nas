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
  const paragraphs = [
    title,
    `As of ${reportDate}: ${snapshot.summary.totalRecords.toLocaleString()} CRM records, ${countWhere(
      deals,
      (deal) => deal.callStage === "Sales Qualified",
    )} sales qualified, ${agreementStage.length} in agreement stage, ${completed.length} completed, ${upcomingCalls.length} upcoming calls.`,
    "First Fold: Closed / Agreement / High Probability",
    ...formatBucket("Completed", completed, 4),
    ...formatBucket("Agreement Stage", agreementStage, 5),
    ...formatBucket("High Probability Of Closing", highProbability, 6),
    "Key Points To Note",
    `This week, ${weekAgreementMoves.length} clients moved into Agreement Stage: ${listNames(
      weekAgreementMoves.map((change) => change.account),
    )}.`,
    `Ironasylum: sales qualified, Facebook source, owned by Ildiko, first meeting ${firstDeal(
      deals,
      "Ironasylum",
    )?.firstMeetingDate || "unknown date"}.`,
    `${upcomingCalls.length} booked meetings are coming up from today onward. Top ones: ${listNames(
      upcomingCalls.slice(0, 5).map((deal) => deal.account),
    )}.`,
    `Main risk: ${snapshot.summary.missing.owner.toLocaleString()} records are still unassigned.`,
    "Inbound Snapshot",
    segmentLine("Inbound", inbound),
    "Outbound Snapshot",
    segmentLine("Outbound", outbound),
    "Noteworthy Conversations",
    ...notableConversations.slice(0, 6).map(formatDeal),
    "CEO Actions",
    "1. Review Agreement Stage and high-probability records today.",
    "2. Assign owners to every unassigned active record.",
    "3. Confirm upcoming calls have owner, agenda, and next step before the call.",
  ];

  return {
    title,
    paragraphs,
    sheetValues: paragraphs.map((paragraph) => [paragraph]),
    plainText: paragraphs.join("\n\n"),
  };
}

function formatBucket(bucket: string, deals: SalesDeal[], limit: number) {
  if (!deals.length) {
    return [`${bucket}: none`];
  }

  return [
    `${bucket}:`,
    ...deals.slice(0, limit).map(formatDeal),
  ];
}

function formatDeal(deal: SalesDeal) {
  const parts = [
    deal.account,
    stageFor(deal),
    `owner: ${cleanOwner(deal.owner)}`,
    `source: ${sourceFor(deal)}`,
    deal.firstMeetingDate ? `meeting: ${deal.firstMeetingDate}` : "",
    cleanValue(deal.budget) ? `budget: ${cleanValue(deal.budget)}` : "",
    deal.email ? `contact: ${deal.email}` : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

function segmentLine(segment: string, deals: SalesDeal[]) {
  return `${segment}: ${deals.length.toLocaleString()} records | ${countWhere(
    deals,
    (deal) => deal.qualification === "Fit",
  )} fit | ${countWhere(
    deals,
    (deal) => deal.qualification === "Review",
  )} review | ${countWhere(
    deals,
    (deal) => deal.callStage === "Sales Qualified",
  )} sales qualified | ${countWhere(
    deals,
    (deal) => deal.callStage === "Booked a Meeting",
  )} booked meetings | ${countWhere(
    deals,
    (deal) => deal.finalVerdict === "Agreement Stage",
  )} agreement stage.`;
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
