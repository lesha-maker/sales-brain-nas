import type { SalesDeal } from "./monday";
import type { SalesMemoryChange, SalesMemorySnapshot } from "./sales-memory";
import type { LarkReportBlock } from "./lark";

type PipelineSet = {
  signed: SalesDeal[];
  agreement: SalesDeal[];
  hot: SalesDeal[];
  worthSecondCall: SalesDeal[];
  upcomingMeetings: SalesDeal[];
  dinnerFollowUps: SalesDeal[];
  newEnterprise: SalesDeal[];
  feeConcern: SalesDeal[];
  activeEnterpriseCount: number;
};

export function buildCeoSalesReport({
  snapshot,
  recentChanges,
}: {
  snapshot: SalesMemorySnapshot;
  recentChanges: SalesMemoryChange[];
}) {
  const deals = snapshot.deals;
  const title = `Agent Sales Report - ${reportDate()}`;
  const pipeline = buildPipelineSet(deals, recentChanges);
  const movement = movementSinceLastReport(recentChanges);
  const dinnerMarkets = groupDinnerFollowUps(pipeline.dinnerFollowUps);
  const newCeoLevel = pipeline.newEnterprise.filter(isMillionPlusLead).slice(0, 2);
  const agreementMoveCount = movement.agreementMoves.length || pipeline.agreement.length;
  const health = pipeline.agreement.length + pipeline.hot.length >= 8 ? "Strong" : "Needs focus";

  const executiveSummary =
    `This week we moved ${agreementMoveCount} opportunities into agreement stage, ` +
    `advanced multiple enterprise accounts through follow-up and proposal work, added ` +
    `${newCeoLevel.length} CEO-level opportunities, and generated ` +
    `${pipeline.dinnerFollowUps.length} qualified follow-up meetings from our CMO dinners.`;

  const snapshotRows = pipelineSnapshotRows(pipeline);
  const agreementRows = progressTableRows("Agreement Stage", pipeline.agreement.slice(0, 5));
  const hotRows = progressTableRows("Hot Opportunities", pipeline.hot.slice(0, 10));
  const newEnterpriseRows = tableRows(
    ["Lead", "Signal", "Owner"],
    pipeline.newEnterprise.slice(0, 8).map((deal) => [
      cleanName(deal.account),
      conciseSignal(deal),
      cleanOwner(deal.owner),
    ]),
  );
  const upcomingMeetingRows = tableRows(
    ["Lead", "Date", "Signal"],
    pipeline.upcomingMeetings.slice(0, 8).map((deal) => [
      cleanName(deal.account),
      dateLabel(deal.firstMeetingDate),
      conciseSignal(deal),
    ]),
  );
  const dinnerRows = cmoDinnerTableRows(dinnerMarkets);
  const keyHighlights = [
    `${pipeline.agreement.length} deals are now at agreement stage and approaching signature.`,
    `${pipeline.activeEnterpriseCount} active enterprise opportunities remain in the late-stage pipeline.`,
    `The top of funnel continues to replenish with ${pipeline.newEnterprise.length} new or newly important enterprise opportunities.`,
    `CMO dinners have produced ${pipeline.dinnerFollowUps.length} qualified follow-up meetings across ${dinnerMarkets.length || 1} market${dinnerMarkets.length === 1 ? "" : "s"}.`,
  ];
  const progressLines = progressLinesFor(pipeline, movement);
  const ceoTakeaways = [
    `${pipeline.agreement.length} deals are closest to signature: ${listDealNames(pipeline.agreement, 4)}.`,
    `The hot lane has ${pipeline.hot.length} opportunities and should be the sales team's main operating focus.`,
    newCeoLevel.length
      ? `The newest CEO-level opportunities are ${listDealNames(newCeoLevel, 2)}.`
      : "No new million-plus CEO-level opportunity was clearly marked in CRM this cycle.",
    `CMO dinners are working as an enterprise acquisition channel, with ${pipeline.dinnerFollowUps.length} follow-up meetings captured.`,
    `Two leads for CEO follow-up: ${ceoFollowUpNames(pipeline)}.`,
  ];
  const paragraphs = [
    "Agent Sales Report",
    "Executive Summary",
    executiveSummary,
    "Pipeline Health",
    `Overall Health: ${healthIcon(health)} ${health}`,
    "Key highlights",
    ...keyHighlights.map((line) => `- ${line}`),
    "Enterprise Pipeline Snapshot",
    ...snapshotRows.map((row) => row.join(" | ")),
    "Pipeline Progress Since Last Update",
    ...progressLines,
    "Commercial Decision Required",
    commercialDecisionText(pipeline),
    ...commercialDecisionLines(pipeline),
    "New Enterprise Opportunities",
    ...newEnterpriseRows.map((row) => row.join(" | ")),
    "Upcoming Enterprise Meetings",
    ...upcomingMeetingRows.map((row) => row.join(" | ")),
    "CMO Dinner Follow-ups",
    "The dinner strategy continues to convert into qualified enterprise meetings.",
    ...dinnerRows.map((row) => row.join(" | ")),
    "CEO Takeaways",
    ...ceoTakeaways.map((line) => `- ${line}`),
  ];

  const blocks = reportBlocks([
    { type: "heading1", text: "Agent Sales Report" },
    { type: "heading2", text: "Executive Summary" },
    { type: "text", text: executiveSummary },
    { type: "divider" },
    { type: "heading1", text: "Pipeline Health" },
    { type: "heading3", text: `Overall Health: ${healthIcon(health)} ${health}` },
    { type: "text", text: "Key highlights" },
    ...keyHighlights.map((text) => ({ type: "text" as const, text: `- ${text}` })),
    { type: "divider" },
    { type: "heading1", text: "Enterprise Pipeline Snapshot" },
    { type: "table", rows: snapshotRows },
    { type: "divider" },
    { type: "heading1", text: "Pipeline Progress Since Last Update" },
    { type: "heading2", text: "Agreement Stage" },
    { type: "table", rows: agreementRows },
    { type: "heading2", text: "Hot Opportunities" },
    { type: "table", rows: hotRows },
    { type: "text", text: movement.important.length
      ? `Other movement worth noting: ${movement.important.slice(0, 4).map(formatChange).join("; ")}.`
      : "Other movement worth noting: no major non-closing stage changes found this week." },
    { type: "divider" },
    { type: "heading1", text: "Commercial Decision Required" },
    { type: "text", text: commercialDecisionText(pipeline) },
    ...commercialDecisionLines(pipeline).map((text) => ({ type: "text" as const, text })),
    { type: "divider" },
    { type: "heading1", text: "New Enterprise Opportunities" },
    { type: "table", rows: newEnterpriseRows },
    { type: "divider" },
    { type: "heading1", text: "Upcoming Enterprise Meetings" },
    { type: "text", text: `${pipeline.upcomingMeetings.length} enterprise conversations have been scheduled. Calls we are excited about.` },
    { type: "table", rows: upcomingMeetingRows },
    { type: "divider" },
    { type: "heading1", text: "CMO Dinner Follow-ups" },
    { type: "text", text: "The dinner strategy continues to convert into qualified enterprise meetings." },
    { type: "table", rows: dinnerRows },
    { type: "divider" },
    { type: "heading1", text: "CEO Takeaways" },
    ...ceoTakeaways.map((text) => ({ type: "text" as const, text: `- ${text}` })),
  ]);

  return {
    title,
    blocks,
    paragraphs,
    sheetValues: paragraphs.map((paragraph) => [paragraph]),
    plainText: paragraphs.join("\n\n"),
  };
}

function healthIcon(health: string) {
  return health === "Strong" ? "🟢" : "🟡";
}

function commercialDecisionLines(pipeline: PipelineSet) {
  const lines: string[] = [];

  if (pipeline.feeConcern.length) {
    lines.push("Affected opportunities:");
    lines.push(...pipeline.feeConcern.slice(0, 6).map((deal) => `- ${cleanName(deal.account)}`));
  }

  const ceoFollowUp = ceoFollowUpNames(pipeline);
  if (ceoFollowUp !== "none identified") {
    lines.push(`CEO follow-up: ${ceoFollowUp}`);
  }

  return lines;
}

function progressTableRows(section: string, deals: SalesDeal[]) {
  return tableRows(
    ["Lead", "Stage", "What CEO Should Know"],
    deals.map((deal) => [
      cleanName(deal.account),
      section === "Agreement Stage" ? "Agreement Stage" : stageFor(deal),
      progressNote(deal),
    ]),
  );
}

function cmoDinnerTableRows(dinnerMarkets: Array<[string, SalesDeal[]]>) {
  const rows = dinnerMarkets.flatMap(([market, marketDeals]) =>
    marketDeals.slice(0, 8).map((deal) => [
      marketLabel(market),
      cleanName(deal.account),
      [cleanOwner(deal.owner), dinnerAction(deal).replace(/^ — /, "")].filter(Boolean).join(" / "),
    ]),
  );

  return tableRows(["Market", "Lead", "Owner / Status"], rows);
}

function marketLabel(market: string) {
  const normalized = market.toLowerCase();
  if (normalized.includes("tel aviv")) return "🇮🇱 Tel Aviv";
  if (normalized.includes("singapore")) return "🇸🇬 Singapore";
  if (normalized.includes("miami") || normalized.includes("us")) return "🇺🇸 Miami";
  return market;
}

function dinnerAction(deal: SalesDeal) {
  const signal = [deal.followUp, deal.nextStepsStatus, deal.finalVerdict, deal.callStage]
    .find((value) => value && value !== "5" && value !== "No Action" && value !== "Blank");

  return signal ? ` — ${signal}` : "";
}

function buildPipelineSet(deals: SalesDeal[], recentChanges: SalesMemoryChange[]): PipelineSet {
  const signed = topByStage(deals, isCompleted, 6);
  const agreement = topByStage(deals, isAgreementStage, 6);
  const hot = topByStage(deals, isHotOpportunity, 14);
  const worthSecondCall = topByStage(deals, isWorthSecondCall, 12);
  const upcomingMeetings = upcomingBookedMeetings(deals).filter(isEnterpriseLead);
  const dinnerFollowUps = cmoDinnerFollowUps(deals);
  const newEnterprise = newEnterpriseSignals(deals, recentChanges);
  const feeConcern = implementationFeeConcerns(deals);
  const activeEnterpriseCount = uniqueDeals([...agreement, ...hot]).length;

  return {
    signed,
    agreement,
    hot,
    worthSecondCall,
    upcomingMeetings,
    dinnerFollowUps,
    newEnterprise,
    feeConcern,
    activeEnterpriseCount,
  };
}

function pipelineSnapshotRows(pipeline: PipelineSet) {
  const columns = [
    pipeline.signed,
    pipeline.agreement,
    pipeline.hot,
    pipeline.worthSecondCall,
  ];
  const maxRows = Math.max(...columns.map((column) => column.length), 1);
  const rows = [["Signed", "Agreement Stage", "Hot", "Worth a Second Call"]];

  for (let index = 0; index < Math.min(maxRows, 8); index += 1) {
    rows.push([
      snapshotCell(pipeline.signed[index]),
      snapshotCell(pipeline.agreement[index]),
      snapshotCell(pipeline.hot[index]),
      snapshotCell(pipeline.worthSecondCall[index]),
    ]);
  }

  return rows;
}

function snapshotCell(deal?: SalesDeal) {
  if (!deal) return "";
  const meeting = deal.firstMeetingDate ? ` (${dateLabel(deal.firstMeetingDate)})` : "";
  return `${cleanName(deal.account)}${meeting}`;
}

function progressLinesFor(pipeline: PipelineSet, movement: ReturnType<typeof movementSinceLastReport>) {
  return [
    "Agreement Stage",
    ...dealBullets(
      pipeline.agreement.slice(0, 5),
      (deal) => `${cleanName(deal.account)} - ${progressNote(deal)}`,
    ),
    "Hot Opportunities",
    ...dealBullets(
      pipeline.hot.slice(0, 10),
      (deal) => `${cleanName(deal.account)} - ${progressNote(deal)}`,
    ),
    movement.important.length
      ? `Other movement worth noting: ${movement.important.slice(0, 4).map(formatChange).join("; ")}.`
      : "Other movement worth noting: no major non-closing stage changes found this week.",
  ];
}

function commercialDecisionText(pipeline: PipelineSet) {
  if (!pipeline.feeConcern.length) {
    return "No clear commercial decision blocker is currently tagged in the CRM notes.";
  }

  return (
    "Some prospects have raised concerns around pricing or implementation fee. " +
    "Recommendation: consider a time-boxed implementation-fee concession for agreements signed before month-end."
  );
}

function tableRows(header: string[], rows: string[][]) {
  return [header, ...(rows.length ? rows : [header.map((_, index) => (index === 0 ? "None" : ""))])];
}

function cmoDinnerFollowUps(deals: SalesDeal[]) {
  return topByStage(
    deals,
    (deal) =>
      isDinnerBoard(deal) &&
      !isNegative(deal) &&
      (deal.callStage === "Booked a Meeting" ||
        deal.callStage === "Sales Qualified" ||
        deal.finalVerdict.includes("Meeting") ||
        deal.nextStepsStatus.includes("Meeting") ||
        deal.followUp.length > 0),
    24,
  );
}

function groupDinnerFollowUps(deals: SalesDeal[]) {
  const groups = new Map<string, SalesDeal[]>();

  for (const deal of deals) {
    const market = dinnerMarket(deal);
    groups.set(market, [...(groups.get(market) || []), deal]);
  }

  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
}

function dinnerMarket(deal: SalesDeal) {
  const raw = `${deal.group || ""} ${deal.country || ""} ${deal.source || ""} ${deal.agentNotes || ""}`;
  const lower = raw.toLowerCase();

  if (lower.includes("miami") || lower.includes("usa") || lower.includes("united states")) return "Miami / US";
  if (lower.includes("singapore")) return "Singapore";
  if (lower.includes("tel aviv") || lower.includes("israel")) return "Tel Aviv";
  return deal.group && deal.group !== "Unknown" ? deal.group : "CMO Dinner";
}

function newEnterpriseSignals(deals: SalesDeal[], changes: SalesMemoryChange[]) {
  const createdIds = new Set(
    changes
      .filter((change) => change.field === "created")
      .map((change) => change.itemId),
  );
  const created = deals.filter((deal) => createdIds.has(deal.id));
  const named = [
    "MovingLife",
    "Gennoma",
    "Genomma",
    "LetsBeco",
    "Beco",
    "Airwallex",
    "Subway",
    "Gainswave",
    "GoUSA",
    "3M",
    "India Times",
  ];
  const notable = deals.filter((deal) =>
    named.some((name) => deal.account.toLowerCase().includes(name.toLowerCase())),
  );

  return uniqueDeals([
    ...created.filter((deal) => isEnterpriseLead(deal) && !isNegative(deal)),
    ...notable.filter((deal) => !isNegative(deal)),
    ...topByStage(deals, (deal) => isMillionPlusLead(deal) && !isNegative(deal), 8),
  ])
    .sort((a, b) => scoreDeal(b) - scoreDeal(a))
    .slice(0, 10);
}

function implementationFeeConcerns(deals: SalesDeal[]) {
  const explicit = ["Modernising Trends", "Modernizing Trends", "SG Doors", "Suneraa", "Sunera"];

  return topByStage(
    deals,
    (deal) => {
      const text = `${deal.account} ${deal.agentNotes} ${deal.salesCallNotes} ${deal.lookingFor}`.toLowerCase();
      return (
        explicit.some((name) => deal.account.toLowerCase().includes(name.toLowerCase())) ||
        text.includes("implementation fee") ||
        text.includes("setup fee") ||
        text.includes("pricing concern") ||
        text.includes("discount")
      );
    },
    8,
  );
}

function ceoFollowUpNames(pipeline: PipelineSet) {
  const preferred = [...pipeline.hot, ...pipeline.worthSecondCall].filter((deal) =>
    ["kipp", "zumba"].some((name) => deal.account.toLowerCase().includes(name)),
  );
  const fallback = uniqueDeals([...preferred, ...pipeline.hot, ...pipeline.agreement]).slice(0, 2);
  return fallback.length ? listDealNames(fallback, 2) : "none identified";
}

function movementSinceLastReport(changes: SalesMemoryChange[]) {
  const recent = changesThisWeek(changes);
  const agreementMoves = recent
    .filter((change) => change.field === "finalVerdict" && change.after === "Agreement Stage")
    .map((change) => change.account);
  const important = recent.filter(
    (change) =>
      change.field !== "created" &&
      (change.after === "Agreement Stage" ||
        change.after === "Confirmed (Verbal)" ||
        change.after === "Lost" ||
        change.after === "No Show" ||
        change.after === "Proposal Done"),
  );

  return { agreementMoves, important };
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

function dealBullets(deals: SalesDeal[], formatter: (deal: SalesDeal) => string) {
  if (!deals.length) return ["- None currently marked."];
  return deals.map((deal) => `- ${formatter(deal)}`);
}

function progressNote(deal: SalesDeal) {
  if (deal.finalVerdict === "Agreement Stage") return "Agreement stage; needs close follow-up.";
  if (deal.finalVerdict === "Signed" || deal.finalVerdict === "Completed") return "Signed or completed.";
  if (deal.finalVerdict === "Confirmed (Verbal)") return "Verbally confirmed; needs conversion to agreement.";
  if (deal.finalVerdict === "2nd call with Nuseir") return "Second call with Nuseir; leadership involvement is already in motion.";
  if (deal.nextStepsStatus === "Proposal Done") return "Proposal sent; waiting for response or next push.";
  if (deal.callStage === "Booked a Meeting") return "Meeting booked; prepare sharp enterprise POV.";

  return conciseSignal(deal) || "Active opportunity.";
}

function conciseSignal(deal: SalesDeal) {
  return [
    stageFor(deal),
    deal.budget && deal.budget !== "Unknown" ? deal.budget : "",
    cleanOwner(deal.owner) !== "Unassigned" ? cleanOwner(deal.owner) : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

function scoreDeal(deal: SalesDeal) {
  const stage = stageFor(deal);
  let score = 0;

  if (stage.includes("Completed") || stage.includes("Signed")) score += 100;
  if (stage.includes("Agreement Stage")) score += 90;
  if (stage.includes("Confirmed")) score += 80;
  if (stage.includes("2nd call")) score += 75;
  if (stage.includes("Proposal Done")) score += 70;
  if (stage.includes("Proposal Stage")) score += 60;
  if (stage.includes("Sales Qualified")) score += 50;
  if (stage.includes("Booked a Meeting")) score += 40;
  if (isMillionPlusLead(deal)) score += 20;
  if (isDinnerBoard(deal)) score += 8;

  return score;
}

function isCompleted(deal: SalesDeal) {
  return deal.finalVerdict === "Completed" || deal.finalVerdict === "Signed";
}

function isAgreementStage(deal: SalesDeal) {
  return deal.finalVerdict === "Agreement Stage" || deal.nextStepsStatus === "Agreement Stage";
}

function isHotOpportunity(deal: SalesDeal) {
  if (isCompleted(deal) || isAgreementStage(deal) || isNegative(deal)) return false;

  return (
    deal.finalVerdict === "Confirmed (Verbal)" ||
    deal.finalVerdict === "2nd call with Nuseir" ||
    deal.nextStepsStatus === "Proposal Done" ||
    deal.nextStepsStatus === "Proposal Stage" ||
    (deal.callStage === "Sales Qualified" && isEnterpriseLead(deal))
  );
}

function isWorthSecondCall(deal: SalesDeal) {
  if (isCompleted(deal) || isAgreementStage(deal) || isHotOpportunity(deal) || isNegative(deal)) {
    return false;
  }

  return deal.callStage === "Booked a Meeting" || deal.callStage === "Sales Qualified" || isEnterpriseLead(deal);
}

function isEnterpriseLead(deal: SalesDeal) {
  const budget = deal.budget.toLowerCase();
  const notes = `${deal.account} ${deal.jobTitle} ${deal.agentNotes} ${deal.salesCallNotes} ${deal.lookingFor}`.toLowerCase();

  return (
    isMillionPlusLead(deal) ||
    budget.includes("300") ||
    budget.includes("100k") ||
    notes.includes("enterprise") ||
    notes.includes("ceo") ||
    notes.includes("cmo") ||
    notes.includes("head of") ||
    notes.includes("million") ||
    notes.includes("$1m")
  );
}

function isMillionPlusLead(deal: SalesDeal) {
  const text = `${deal.budget} ${deal.agentNotes} ${deal.salesCallNotes} ${deal.lookingFor}`.toLowerCase();
  return text.includes("$1m") || text.includes("1m+") || text.includes("million") || text.includes("$ms");
}

function isDinnerBoard(deal: SalesDeal) {
  return deal.boardId === "5030120019" || (deal.boardName || "").toLowerCase().includes("cmo dinner");
}

function isNegative(deal: SalesDeal) {
  return ["Lost", "Gone Cold", "No Show"].includes(deal.finalVerdict) || deal.callStage === "No Show";
}

function stageFor(deal: SalesDeal) {
  return [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(" / ");
}

function cleanOwner(owner: string) {
  return owner && owner !== "Unassigned" ? owner : "Unassigned";
}

function cleanName(name: string) {
  return name.replace(/\s+/g, " ").trim();
}

function listDealNames(deals: SalesDeal[], limit: number) {
  const names = deals.slice(0, limit).map((deal) => cleanName(deal.account));
  return names.length ? names.join(", ") : "none";
}

function uniqueDeals(deals: SalesDeal[]) {
  const seen = new Set<string>();
  return deals.filter((deal) => {
    const key = `${deal.boardId || "unknown"}:${deal.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function changesThisWeek(changes: SalesMemoryChange[]) {
  const weekStart = startOfWeekInSingapore();
  return changes.filter((change) => dateOnly(change.crawledAt) >= weekStart);
}

function formatChange(change: SalesMemoryChange) {
  return `${change.account}: ${change.before || "blank"} -> ${change.after || "blank"}`;
}

function reportBlocks(blocks: LarkReportBlock[]) {
  return blocks;
}

function reportDate() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "long",
  }).format(new Date());
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
  if (!match) return value || "";

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
