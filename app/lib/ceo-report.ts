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
  const worthSecondCall = worthSecondCallDeals(deals);
  const upcomingCalls = upcomingBookedMeetings(deals);
  const weekAgreementMoves = changesThisWeek(recentChanges).filter(
    (change) => change.field === "finalVerdict" && change.after === "Agreement Stage",
  );
  const existingLeadUpdates = buildExistingLeadUpdates(deals);
  const newLeadUpdates = buildNewLeadUpdates(deals);
  const paragraphs = [
    reportTitleDate(),
    "Overall Funnel",
    formatFunnelBoard({
      signed: completed,
      agreementStage,
      hot: highProbability,
      worthSecondCall,
    }),
    "Updates On Existing Leads Since We Last Met",
    ...existingLeadUpdates,
    "New Leads That Showed Interest",
    ...newLeadUpdates,
    "Quick Stats",
    `As of ${reportDate}: ${snapshot.summary.totalRecords.toLocaleString()} CRM records, ${countWhere(
      deals,
      (deal) => deal.callStage === "Sales Qualified",
    )} sales qualified, ${agreementStage.length} in agreement stage, ${completed.length} completed, ${upcomingCalls.length} upcoming calls.`,
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

function reportTitleDate() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function formatFunnelBoard({
  signed,
  agreementStage,
  hot,
  worthSecondCall,
}: {
  signed: SalesDeal[];
  agreementStage: SalesDeal[];
  hot: SalesDeal[];
  worthSecondCall: SalesDeal[];
}) {
  const columns = [
    ["Signed", signed.map(shortDealName).slice(0, 10)],
    ["Agreement stage", agreementStage.map(shortDealName).slice(0, 10)],
    ["Hot", hot.map(shortDealName).slice(0, 10)],
    ["Worth a second call", worthSecondCall.map(shortDealName).slice(0, 10)],
  ] as const;
  const maxRows = Math.max(...columns.map(([, rows]) => rows.length), 1);
  const widths = [28, 28, 28, 28];
  const header = columns.map(([label], index) => pad(label, widths[index])).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-+-");
  const rows = Array.from({ length: maxRows }, (_, rowIndex) =>
    columns
      .map(([, values], columnIndex) => pad(values[rowIndex] || "", widths[columnIndex]))
      .join(" | "),
  );

  return [header, divider, ...rows].join("\n");
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

function worthSecondCallDeals(deals: SalesDeal[]) {
  return topActiveDeals(
    deals.filter((deal) => {
      if (["Completed", "Agreement Stage", "Lost", "Gone Cold"].includes(deal.finalVerdict)) {
        return false;
      }

      return (
        deal.finalVerdict === "2nd call with Nuseir" ||
        deal.callStage === "Booked a Meeting" ||
        deal.nextStepsStatus === "Proposal Stage"
      );
    }),
    12,
  );
}

function buildExistingLeadUpdates(deals: SalesDeal[]) {
  return [
    "- Dolce Estetica Clinic (Medlounges): should be signed today.",
    "- DS18: counter proposed $10k. Alex meeting today.",
    "- AltitudeX: following up; checking if they have more questions we can tackle.",
    "- Mycospring: still travelling; coming back with questions.",
    "- Babysense: followed up again.",
    "- DW Group: pricing submitted, waiting for feedback.",
    "- KIPP: currently evaluating. Lesha sent email.",
    "- Flexar: follow up on Monday.",
    "- Zumba: follow up sent.",
    "- PSB Academy: delayed.",
    "- Modernizing Trends: open to monthly, but no implementation fee.",
  ].map((line) => enrichWithCrmStage(line, deals));
}

function buildNewLeadUpdates(deals: SalesDeal[]) {
  return [
    "- MovingLife: overall rating 9.6/10; Tier 1 enterprise opportunity. They spend $200k/month on digital. Revenue signal: $25M.",
    "- Gennoma Lab (outbound US): Alan is Head of Digital Marketing. They spend millions in digital marketing and built internal agents, but results are not effective. Circling internally because there is some AI champion politics.",
    "- Lets Beco Shop: approx $100k/month digital spend, about $1.2M annually. Business is roughly $400M/year.",
    "- USEA Global: B2B company. Needs qualification on use case and budget.",
    "- Airwallex USA: proposing partnership with Head of Startups around content and SMB intros. Follow-up call today.",
    "- Miami Dinner: most interested leads are Subway, Gainswave, and Home Improvement. Home Improvement spends around $70k/month and is very AI interested.",
    "- Singapore Dinner: Chimichanga, Rently, Sodexo, Airwallex, Crocs, ViViai, XVA, DHL.",
  ].map((line) => enrichWithCrmStage(line, deals));
}

function enrichWithCrmStage(line: string, deals: SalesDeal[]) {
  const deal = deals.find((candidate) => {
    const haystack = line.toLowerCase();
    return (
      haystack.includes(candidate.account.toLowerCase()) ||
      candidate.account
        .toLowerCase()
        .split(/\s+/)
        .filter((part) => part.length >= 5)
        .some((part) => haystack.includes(part))
    );
  });

  if (!deal) return line;

  const stage = stageFor(deal);
  const owner = cleanOwner(deal.owner);
  const crmParts = [stage ? `stage: ${stage}` : "", owner ? `owner: ${owner}` : ""].filter(Boolean);

  return crmParts.length ? `${line} (${crmParts.join(", ")})` : line;
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

function pad(value: string, width: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  const shortened = clean.length > width - 1 ? `${clean.slice(0, width - 2)}.` : clean;
  return shortened.padEnd(width, " ");
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
