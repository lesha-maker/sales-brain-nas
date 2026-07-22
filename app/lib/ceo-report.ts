import type { SalesDeal } from "./monday";
import type { SalesMemoryChange, SalesMemorySnapshot } from "./sales-memory";
import type { LarkReportBlock } from "./lark";

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
  const signedCount = deals.filter((deal) => deal.finalVerdict === "Completed").length;
  const inboundSqls = countWhere(inbound, (deal) => deal.callStage === "Sales Qualified");
  const outboundSqls = countWhere(outbound, (deal) => deal.callStage === "Sales Qualified");
  const bottomLine = `Sales has ${agreement.length} deals in agreement stage, ${hot.length} high-probability opportunities, and ${upcomingCalls.length} booked calls coming up. The biggest thing to watch is ownership: ${activeUnassigned.length} active opportunities are still unassigned.`;
  const movedToAgreement = `Moved to agreement: ${movement.agreementMoves.length ? listNames(movement.agreementMoves) : "none"}.`;
  const newAndNegative = `New records added: ${movement.createdCount}. Losses/no-shows: ${movement.negativeCount}.`;
  const importantChanges = movement.important.length
    ? `Important changes: ${movement.important.slice(0, 4).map(formatChange).join("; ")}.`
    : "Important changes: no major stage movement outside the closing list.";
  const inboundShape = `Inbound: ${inbound.length.toLocaleString()} records, ${countWhere(
    inbound,
    (deal) => deal.callStage === "Sales Qualified",
  )} sales qualified, ${countWhere(inbound, (deal) => deal.callStage === "Booked a Meeting")} booked calls.`;
  const outboundShape = `Outbound: ${outbound.length.toLocaleString()} records, ${countWhere(
    outbound,
    (deal) => deal.callStage === "Sales Qualified",
  )} sales qualified, ${countWhere(outbound, (deal) => deal.callStage === "Booked a Meeting")} booked calls.`;
  const newSignalLines = newSignals.length
    ? dealLines(newSignals)
    : ["No new high-signal leads found in the latest CRM changes."];
  const summaryRows = [
    ["Metric", "Current Value"],
    ["Total CRM Records", deals.length.toLocaleString()],
    ["Inbound SQLs", String(inboundSqls)],
    ["Outbound SQLs", String(outboundSqls)],
    ["Agreement Stage", String(agreement.length)],
    ["High-Probability / Hot", String(hot.length)],
    ["Upcoming Booked Calls", String(upcomingCalls.length)],
    ["Completed Deals", String(signedCount)],
    ["New Records This Week", String(movement.createdCount)],
    ["Moved To Agreement This Week", String(movement.agreementMoves.length)],
    ["Lost / No-Show Movement", String(movement.negativeCount)],
    ["Unassigned Active Opportunities", String(activeUnassigned.length)],
  ];
  const closingRows = closingBoardRows({
    signed,
    agreement,
    hot,
    watch,
  });
  const takeawayOne = agreement.length
    ? `The closing lane is real but narrow: ${listDealNames(agreement, 4)} are already in agreement stage. These should get the most operational attention this week.`
    : "There are no deals currently marked agreement stage, so the focus should be moving the strongest hot leads into a closeable lane.";
  const takeawayTwo = hot.length
    ? `The next layer of closable pipeline is ${listDealNames(hot, 5)}. These are not just generic SQLs; they have proposal, verbal-confirmed, or second-call signals.`
    : "There are no obvious high-probability leads after agreement stage, which means the team needs to rebuild the next closeable layer.";
  const takeawayThree = newSignals.length
    ? `New or newly important leads worth attention: ${listDealNames(newSignals, 5)}. These should be checked for owner, next step, and meeting date.`
    : "No new high-signal leads stood out in the latest CRM change set.";
  const takeawayFour = `Inbound is carrying ${inboundSqls} SQLs and outbound is carrying ${outboundSqls}. The CEO read should stay split by source because the operating motion is different for each.`;
  const takeawayFive = activeUnassigned.length
    ? `${activeUnassigned.length} active opportunities are unassigned. This is the main execution leak because good leads can look healthy in stage while nobody is clearly accountable.`
    : "Ownership looks clean on the active pipeline right now.";
  const ceoTakeaway = `The pipeline has enough activity to manage, but the CEO view should stay focused on conversion discipline: close the agreement-stage deals, protect the hot leads, and assign every active opportunity.`;

  const paragraphs = [
    title,
    `Modified ${reportDate()}`,
    "Executive Summary",
    bottomLine,
    `This week: ${movedToAgreement} ${newAndNegative}`,
    "The CEO focus should be simple: close agreement-stage deals, push the hot opportunities, and fix ownership gaps before they leak pipeline.",
    "Current Sales Snapshot",
    ...summaryRows.map((row) => row.join(" | ")),
    "Closing Board",
    ...closingRows.map((row) => row.join(" | ")),
    "Key Takeaways For CEO",
    `1. ${takeawayOne}`,
    `2. ${takeawayTwo}`,
    `3. ${takeawayThree}`,
    `4. ${takeawayFour}`,
    `5. ${takeawayFive}`,
    "Recommended Decisions",
    "1. Which agreement-stage deal needs senior help this week?",
    "2. Who owns every unassigned active opportunity by end of day?",
    "3. Which hot lead deserves Nuseir or leadership involvement?",
    "CEO Takeaway",
    ceoTakeaway,
    "Appendix: Recent CRM Movement",
    movedToAgreement,
    newAndNegative,
    importantChanges,
    inboundShape,
    outboundShape,
    ...newSignalLines,
  ];
  const blocks = reportBlocks([
    { type: "heading1", text: title },
    { type: "text", text: `Modified ${reportDate()}` },
    { type: "heading2", text: "Executive Summary" },
    { type: "text", text: bottomLine },
    { type: "text", text: `This week: ${movedToAgreement} ${newAndNegative}` },
    {
      type: "text",
      text: "The CEO focus should be simple: close agreement-stage deals, push the hot opportunities, and fix ownership gaps before they leak pipeline.",
    },
    { type: "divider" },
    { type: "heading2", text: "Current Sales Snapshot" },
    { type: "table", rows: summaryRows },
    { type: "divider" },
    { type: "heading2", text: "Closing Board" },
    { type: "table", rows: closingRows },
    { type: "divider" },
    { type: "heading2", text: "Key Takeaways For CEO" },
    { type: "heading2", text: "1. Closing lane is the priority" },
    { type: "text", text: takeawayOne },
    { type: "heading2", text: "2. Hot pipeline needs a push" },
    { type: "text", text: takeawayTwo },
    { type: "heading2", text: "3. New signals need fast ownership" },
    { type: "text", text: takeawayThree },
    { type: "heading2", text: "4. Inbound and outbound need separate reads" },
    { type: "text", text: takeawayFour },
    { type: "heading2", text: "5. Ownership is the main execution risk" },
    { type: "text", text: takeawayFive },
    { type: "divider" },
    { type: "heading2", text: "Recommended Decisions" },
    { type: "text", text: "1. Which agreement-stage deal needs senior help this week?" },
    { type: "text", text: "2. Who owns every unassigned active opportunity by end of day?" },
    { type: "text", text: "3. Which hot lead deserves Nuseir or leadership involvement?" },
    { type: "divider" },
    { type: "heading2", text: "CEO Takeaway" },
    { type: "text", text: ceoTakeaway },
    { type: "divider" },
    { type: "heading2", text: "Appendix: Recent CRM Movement" },
    { type: "text", text: importantChanges },
    { type: "text", text: inboundShape },
    { type: "text", text: outboundShape },
  ]);

  return {
    title,
    blocks,
    paragraphs,
    sheetValues: paragraphs.map((paragraph) => [paragraph]),
    plainText: paragraphs.join("\n\n"),
  };
}

function reportBlocks(blocks: LarkReportBlock[]) {
  return blocks;
}

function closingBoardRows({
  signed,
  agreement,
  hot,
  watch,
}: {
  signed: SalesDeal[];
  agreement: SalesDeal[];
  hot: SalesDeal[];
  watch: SalesDeal[];
}) {
  const rows = [["Lane", "Lead", "Owner", "Signal"]];
  const sections = [
    ["Completed", signed.slice(0, 4)],
    ["Agreement Stage", agreement.slice(0, 5)],
    ["High Probability", hot.slice(0, 6)],
    ["Worth Watching", watch.slice(0, 6)],
  ] as const;

  for (const [lane, deals] of sections) {
    if (!deals.length) {
      rows.push([lane, "None", "", ""]);
      continue;
    }

    for (const deal of deals) {
      rows.push([lane, deal.account, cleanOwner(deal.owner), conciseSignal(deal)]);
    }
  }

  return rows.slice(0, 18);
}

function conciseSignal(deal: SalesDeal) {
  return [
    stageFor(deal),
    deal.firstMeetingDate ? `meeting ${dateLabel(deal.firstMeetingDate)}` : "",
    deal.budget && deal.budget !== "Unknown" ? deal.budget : "",
  ]
    .filter(Boolean)
    .join(" | ");
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

function listDealNames(deals: SalesDeal[], limit: number) {
  const names = deals.slice(0, limit).map(shortDealName);
  return names.length ? names.join(", ") : "none";
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
  if (deal.group) return deal.group === "Outbound Leads";
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
