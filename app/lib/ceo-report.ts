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
  const generatedAt = new Date(snapshot.generatedAt);
  const reportTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(generatedAt);
  const title = `CEO Sales Brief - ${reportTime}`;
  const signed = topByStage(deals, (deal) => deal.finalVerdict === "Completed", 4);
  const agreement = topByStage(deals, (deal) => deal.finalVerdict === "Agreement Stage", 5);
  const hot = highProbabilityDeals(deals).slice(0, 5);
  const watch = watchListDeals(deals).slice(0, 5);
  const upcomingCalls = upcomingBookedMeetings(deals);
  const movement = movementSinceLastReport(recentChanges);
  const activeUnassigned = deals.filter(
    (deal) => cleanOwner(deal.owner) === "Unassigned" && scoreDeal(deal) >= 50,
  );
  const inbound = deals.filter((deal) => !isOutbound(deal));
  const outbound = deals.filter(isOutbound);
  const newSignals = newLeadSignals(deals, recentChanges).slice(0, 5);

  const paragraphs = [
    reportDate(),
    "CEO Sales Brief",
    `Bottom line: ${agreement.length} deals are in agreement stage, ${hot.length} are hot, and ${upcomingCalls.length} booked calls are coming up. The main execution risk is ownership: ${activeUnassigned.length} active records are still unassigned.`,
    "What Can Close",
    ...dealLines([...agreement, ...hot].slice(0, 8)),
    "Movement Since Last Report",
    `Moved to agreement: ${movement.agreementMoves.length ? listNames(movement.agreementMoves) : "none"}.`,
    `New records added: ${movement.createdCount}. Losses/no-shows: ${movement.negativeCount}.`,
    movement.important.length
      ? `Important changes: ${movement.important.slice(0, 4).map(formatChange).join("; ")}.`
      : "Important changes: no major stage movement outside the closing list.",
    "Lead Board",
    boardLine("Signed", signed),
    boardLine("Agreement Stage", agreement),
    boardLine("Hot", hot),
    boardLine("Worth Watching", watch),
    "New Leads Worth CEO Attention",
    ...(newSignals.length ? dealLines(newSignals) : ["No new high-signal leads found in the latest CRM changes."]),
    "Pipeline Shape",
    `Inbound: ${inbound.length.toLocaleString()} records, ${countWhere(
      inbound,
      (deal) => deal.callStage === "Sales Qualified",
    )} sales qualified, ${countWhere(inbound, (deal) => deal.callStage === "Booked a Meeting")} booked calls.`,
    `Outbound: ${outbound.length.toLocaleString()} records, ${countWhere(
      outbound,
      (deal) => deal.callStage === "Sales Qualified",
    )} sales qualified, ${countWhere(outbound, (deal) => deal.callStage === "Booked a Meeting")} booked calls.`,
    "CEO Decisions Needed",
    "1. Who owns the unassigned active opportunities?",
    "2. Which agreement-stage deal needs leadership help to close this week?",
    "3. Which hot lead deserves Nuseir or senior-team involvement?",
  ];

  return {
    title,
    paragraphs,
    sheetValues: paragraphs.map((paragraph) => [paragraph]),
    plainText: paragraphs.join("\n\n"),
  };
}

function highProbabilityDeals(deals: SalesDeal[]) {
  return topByStage(
    deals,
    (deal) =>
      !["Completed", "Agreement Stage", "Lost", "Gone Cold"].includes(deal.finalVerdict) &&
      (["Confirmed (Verbal)", "2nd call with Nuseir"].includes(deal.finalVerdict) ||
        deal.nextStepsStatus === "Proposal Done" ||
        (deal.callStage === "Sales Qualified" && deal.qualification === "Fit")),
    12,
  );
}

function watchListDeals(deals: SalesDeal[]) {
  const named = ["Ironasylum", "Movinglife", "LetsBeco", "DS18", "AltitudeX", "Mycospring"];
  const explicit = deals.filter((deal) =>
    named.some((name) => deal.account.toLowerCase().includes(name.toLowerCase())),
  );
  const secondCall = topByStage(
    deals,
    (deal) =>
      !["Completed", "Agreement Stage", "Lost", "Gone Cold"].includes(deal.finalVerdict) &&
      (deal.callStage === "Booked a Meeting" || deal.nextStepsStatus === "Proposal Stage"),
    10,
  );

  return uniqueDeals([...explicit, ...secondCall]).sort((a, b) => scoreDeal(b) - scoreDeal(a));
}

function newLeadSignals(deals: SalesDeal[], changes: SalesMemoryChange[]) {
  const createdIds = new Set(
    changes
      .filter((change) => change.field === "created")
      .map((change) => change.itemId),
  );
  const createdDeals = deals.filter((deal) => createdIds.has(deal.id));
  const notableNames = ["Movinglife", "LetsBeco", "Airwallex", "Subway", "Gainswave", "Rently"];
  const notable = deals.filter((deal) =>
    notableNames.some((name) => deal.account.toLowerCase().includes(name.toLowerCase())),
  );
  const highBudget = createdDeals.filter((deal) =>
    ["$300k-1m /year", "$1m+ /year", "$1m+ / year"].includes(deal.budget),
  );

  return uniqueDeals([...highBudget, ...notable, ...topByStage(createdDeals, () => true, 8)])
    .sort((a, b) => scoreDeal(b) - scoreDeal(a));
}

function movementSinceLastReport(changes: SalesMemoryChange[]) {
  const recent = changesThisWeek(changes);
  const agreementMoves = recent
    .filter((change) => change.field === "finalVerdict" && change.after === "Agreement Stage")
    .map((change) => change.account);
  const createdCount = recent.filter((change) => change.field === "created").length;
  const negativeCount = recent.filter(
    (change) =>
      ["callStage", "finalVerdict"].includes(change.field) &&
      ["Lost", "No Show", "Gone Cold"].includes(change.after || ""),
  ).length;
  const important = recent.filter(
    (change) =>
      change.field !== "created" &&
      (change.after === "Agreement Stage" ||
        change.after === "Confirmed (Verbal)" ||
        change.after === "Lost" ||
        change.after === "No Show"),
  );

  return { agreementMoves, createdCount, negativeCount, important };
}

function topByStage(
  deals: SalesDeal[],
  predicate: (deal: SalesDeal) => boolean,
  limit: number,
) {
  return deals
    .filter(predicate)
    .sort((a, b) => {
      const stageScore = scoreDeal(b) - scoreDeal(a);
      if (stageScore) return stageScore;
      return b.value * b.probability - a.value * a.probability;
    })
    .slice(0, limit);
}

function dealLines(deals: SalesDeal[]) {
  if (!deals.length) return ["None."];
  return deals.map((deal) => `- ${dealLine(deal)}`);
}

function dealLine(deal: SalesDeal) {
  const parts = [
    deal.account,
    stageFor(deal),
    cleanOwner(deal.owner) !== "Unassigned" ? cleanOwner(deal.owner) : "unassigned",
    deal.firstMeetingDate ? `meeting ${dateLabel(deal.firstMeetingDate)}` : "",
    deal.budget && deal.budget !== "Unknown" ? deal.budget : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

function boardLine(label: string, deals: SalesDeal[]) {
  return `${label}: ${deals.length ? deals.map(shortDealName).join(", ") : "none"}`;
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

function formatChange(change: SalesMemoryChange) {
  return `${change.account} ${change.field} ${change.before || "blank"} -> ${change.after || "blank"}`;
}

function shortDealName(deal: SalesDeal) {
  const meeting = deal.firstMeetingDate ? ` (${dateLabel(deal.firstMeetingDate)})` : "";
  return `${deal.account}${meeting}`;
}

function stageFor(deal: SalesDeal) {
  return [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(" / ");
}

function cleanOwner(owner: string) {
  return owner && owner !== "Unassigned" ? owner : "Unassigned";
}

function listNames(names: string[]) {
  if (!names.length) return "none";
  return [...new Set(names)].join(", ");
}

function uniqueDeals(deals: SalesDeal[]) {
  const seen = new Set<string>();
  return deals.filter((deal) => {
    if (seen.has(deal.id)) return false;
    seen.add(deal.id);
    return true;
  });
}

function isOutbound(deal: SalesDeal) {
  return deal.source?.toLowerCase().includes("outbound") || false;
}

function countWhere(deals: SalesDeal[], predicate: (deal: SalesDeal) => boolean) {
  return deals.filter(predicate).length;
}

function reportDate() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "long",
  }).format(new Date());
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

function dateLabel(value: string) {
  const match = value.match(/\d{4}-(\d{2})-(\d{2})/);
  if (!match) return value;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(todayInSingapore().slice(0, 4));
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}
