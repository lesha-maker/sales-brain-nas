import type { SalesDeal } from "./monday";
import type { SalesMemoryChange, SalesMemorySnapshot } from "./sales-memory";

type Segment = "Inbound" | "Outbound";

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
  const title = `CEO Sales Report - ${reportDate}`;
  const upcomingCalls = upcomingBookedMeetings(deals);
  const agreementStage = deals.filter((deal) => deal.finalVerdict === "Agreement Stage");
  const completed = deals.filter((deal) => deal.finalVerdict === "Completed");
  const salesQualified = deals.filter((deal) => deal.callStage === "Sales Qualified");
  const recentImportantChanges = recentChanges
    .filter((change) =>
      ["created", "callStage", "nextStepsStatus", "finalVerdict", "owner"].includes(change.field),
    )
    .slice(-12);

  const paragraphs = [
    title,
    `Snapshot: ${snapshot.summary.totalRecords.toLocaleString()} CRM records as of ${reportDate}.`,
    `CEO headline: ${salesQualified.length} sales qualified leads, ${upcomingCalls.length} upcoming booked calls, ${agreementStage.length} records in Agreement Stage, and ${completed.length} completed deals.`,
    `The system is still heavily under-owned: ${snapshot.summary.missing.owner.toLocaleString()} records are unassigned, including a meaningful amount of qualified/active pipeline. That is the biggest operating risk in the CRM right now.`,
    "",
    "1. Executive Dashboard",
    metricLine("Total records", snapshot.summary.totalRecords),
    metricLine("Sales qualified leads", salesQualified.length),
    metricLine("Upcoming calls", upcomingCalls.length),
    metricLine("Proposal done", countWhere(deals, (deal) => deal.nextStepsStatus === "Proposal Done")),
    metricLine("Agreement stage", agreementStage.length),
    metricLine("Completed deals", completed.length),
    metricLine("Unassigned records", snapshot.summary.missing.owner),
    "",
    "2. Inbound Leads",
    segmentSummary("Inbound", inbound),
    `Inbound is the volume engine: ${inbound.length.toLocaleString()} records, ${countWhere(
      inbound,
      (deal) => deal.callStage === "Sales Qualified",
    )} sales qualified, ${countWhere(
      inbound,
      (deal) => deal.callStage === "Booked a Meeting",
    )} booked meetings, and ${countWhere(
      inbound,
      (deal) => deal.nextStepsStatus === "Proposal Done",
    )} proposal done records.`,
    `Inbound quality split: ${countWhere(inbound, (deal) => deal.qualification === "Fit")} fit, ${countWhere(
      inbound,
      (deal) => deal.qualification === "Review",
    )} review, and ${countWhere(inbound, (deal) => deal.qualification === "Not Fit")} not fit.`,
    topDealLine(
      "Top inbound records to watch",
      topDeals(
        inbound.filter((deal) =>
          ["Sales Qualified", "Booked a Meeting"].includes(deal.callStage),
        ),
      ),
    ),
    "",
    "3. Outbound Leads",
    segmentSummary("Outbound", outbound),
    `Outbound is smaller but much denser: ${outbound.length} records, ${countWhere(
      outbound,
      (deal) => deal.callStage === "Sales Qualified",
    )} sales qualified, ${countWhere(
      outbound,
      (deal) => deal.callStage === "Booked a Meeting",
    )} booked meetings, and ${countWhere(
      outbound,
      (deal) => deal.nextStepsStatus === "Proposal Done",
    )} proposal done records.`,
    `Outbound quality split: ${countWhere(outbound, (deal) => deal.qualification === "Fit")} fit, ${countWhere(
      outbound,
      (deal) => deal.qualification === "Review",
    )} review, and ${countWhere(outbound, (deal) => deal.qualification === "Not Fit")} not fit.`,
    topDealLine(
      "Top outbound records to watch",
      topDeals(
        outbound.filter((deal) =>
          ["Sales Qualified", "Booked a Meeting"].includes(deal.callStage),
        ),
      ),
    ),
    "",
    "4. Calls And Near-Term Pipeline",
    `Upcoming calls are defined as Call Stage = Booked a Meeting and 1st Meeting Date today or later. Today is ${todayInSingapore()} in Singapore time.`,
    topDealLine("Upcoming booked calls", upcomingCalls.slice(0, 12)),
    topDealLine("Agreement stage records", agreementStage),
    topDealLine("Completed records", completed),
    "",
    "5. Operating Risks",
    `Ownership gap: ${snapshot.summary.missing.owner.toLocaleString()} records are unassigned. The CEO-level question is not whether leads exist; it is whether every live lead has an accountable human owner.`,
    `Follow-up hygiene: ${snapshot.summary.missing.lastFollowUp.toLocaleString()} records have no last follow-up date. This makes it hard to trust pipeline freshness without opening individual records.`,
    `CRM blanks: monday is still returning many blank status values as '5'. The report filters around that, but the board should eventually normalize blank labels so reporting reads cleaner.`,
    "",
    "6. Recommended CEO Actions",
    "Assign ownership for every sales qualified, booked meeting, proposal done, and agreement stage record today.",
    "Review all upcoming calls and confirm each has a clear owner, agenda, and next step before the call happens.",
    "Use outbound as a focused ABM motion: it is much smaller than inbound, but the fit rate and sales qualified density are materially stronger.",
    "Keep inbound automated, but add a daily review queue for high-budget Fit/Review leads so the best ones do not sit unassigned.",
    "",
    "7. Recent Movement",
    ...recentImportantChanges.map(formatChange),
  ];

  return {
    title,
    paragraphs: paragraphs.filter((paragraph) => paragraph !== ""),
    plainText: paragraphs.join("\n\n"),
  };
}

function segmentSummary(segment: Segment, deals: SalesDeal[]) {
  return `${segment}: ${deals.length.toLocaleString()} records, ${countWhere(
    deals,
    (deal) => deal.qualification === "Fit",
  )} fit, ${countWhere(
    deals,
    (deal) => deal.callStage === "Sales Qualified",
  )} sales qualified, ${countWhere(
    deals,
    (deal) => deal.callStage === "Booked a Meeting",
  )} booked meetings, ${countWhere(
    deals,
    (deal) => deal.finalVerdict === "Agreement Stage",
  )} agreement stage, ${countWhere(deals, (deal) => deal.finalVerdict === "Completed")} completed.`;
}

function metricLine(label: string, value: number) {
  return `${label}: ${value.toLocaleString()}`;
}

function topDealLine(label: string, deals: SalesDeal[]) {
  if (!deals.length) return `${label}: none.`;

  return `${label}: ${deals
    .slice(0, 12)
    .map((deal) => {
      const owner = deal.owner && deal.owner !== "Unassigned" ? `owner ${deal.owner}` : "unassigned";
      const contact = deal.email ? `, ${deal.email}` : "";
      const date = deal.firstMeetingDate ? `, meeting ${deal.firstMeetingDate}` : "";
      const stage = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
        .filter((value) => value && value !== "5")
        .join(" / ");

      return `${deal.account}${contact}${stage ? ` (${stage})` : ""}${date}, ${owner}`;
    })
    .join("; ")}.`;
}

function topDeals(deals: SalesDeal[]) {
  return [...deals]
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, 12);
}

function isOutbound(deal: SalesDeal) {
  return deal.source.toLowerCase().includes("outbound");
}

function isInbound(deal: SalesDeal) {
  return !isOutbound(deal);
}

function countWhere(deals: SalesDeal[], predicate: (deal: SalesDeal) => boolean) {
  return deals.filter(predicate).length;
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

function formatChange(change: SalesMemoryChange) {
  if (change.field === "created") {
    return `${change.account}: new CRM record created.`;
  }

  return `${change.account}: ${change.field} changed from ${change.before || "blank"} to ${
    change.after || "blank"
  }.`;
}
