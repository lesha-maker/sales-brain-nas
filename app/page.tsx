"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SalesDeal } from "./lib/monday";

const sampleDeals: SalesDeal[] = [
  {
    id: "MON-1042",
    account: "Northstar Logistics",
    owner: "Ari",
    stage: "Proposal",
    qualification: "Fit",
    initialOutreach: "Emailed",
    callStage: "Sales Qualified",
    nextStepsStatus: "Proposal Stage",
    finalVerdict: "",
    firstMeetingDate: "2026-07-12",
    latestMeetingDate: "2026-07-20",
    lastFollowUpDate: "2026-07-23",
    value: 82000,
    closeDate: "2026-07-31",
    health: "Yellow",
    nextStep: "Confirm procurement timeline",
    lastActivityDays: 8,
    probability: 62,
    budget: "$10-100k /year",
    email: "ops@northstar.example",
    firstName: "",
    lastName: "",
    country: "United States",
    jobTitle: "VP Growth",
    website: "",
    phone: "",
    lookingFor: "Improve logistics growth pipeline.",
    agentNotes: "Fit lead. Procurement timeline needs confirmation.",
    status: "",
    followUp: "Confirm procurement timeline",
    salesCallNotes: "",
    source: "Inbound Leads",
    mondayUrl: "https://nas-io.monday.com/boards/5029402147",
  },
  {
    id: "MON-1178",
    account: "Helio Retail Group",
    owner: "Mina",
    stage: "Negotiation",
    qualification: "Fit",
    initialOutreach: "LinkedIn Outreach",
    callStage: "Booked a Meeting",
    nextStepsStatus: "Proposal Done",
    finalVerdict: "Followed-Up",
    firstMeetingDate: "2026-07-08",
    latestMeetingDate: "2026-07-18",
    lastFollowUpDate: "2026-07-19",
    value: 146000,
    closeDate: "2026-08-08",
    health: "Green",
    nextStep: "Send final security answers",
    lastActivityDays: 2,
    probability: 78,
    budget: "$100-300k /year",
    email: "growth@helio.example",
    firstName: "",
    lastName: "",
    country: "Singapore",
    jobTitle: "CMO",
    website: "",
    phone: "",
    lookingFor: "Scale retail campaign.",
    agentNotes: "Fit lead. Security answers requested.",
    status: "",
    followUp: "Send final security answers",
    salesCallNotes: "",
    source: "Partner",
    mondayUrl: "https://nas-io.monday.com/boards/5029402147",
  },
  {
    id: "MON-1221",
    account: "Tandem Clinics",
    owner: "Jon",
    stage: "Review",
    qualification: "Review",
    initialOutreach: "Emailed",
    callStage: "In Review",
    nextStepsStatus: "",
    finalVerdict: "",
    firstMeetingDate: "",
    latestMeetingDate: "",
    lastFollowUpDate: "2026-07-04",
    value: 41000,
    closeDate: "2026-08-19",
    health: "Red",
    nextStep: "Book economic buyer call",
    lastActivityDays: 16,
    probability: 31,
    budget: "Less than $10k /year",
    email: "founder@tandem.example",
    firstName: "",
    lastName: "",
    country: "United Kingdom",
    jobTitle: "Founder",
    website: "",
    phone: "",
    lookingFor: "Clinic growth consulting.",
    agentNotes: "Review. Needs economic buyer.",
    status: "",
    followUp: "Book economic buyer call",
    salesCallNotes: "",
    source: "Inbound Leads",
    mondayUrl: "https://nas-io.monday.com/boards/5029402147",
  },
];

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const quickQuestions = [
  "What changed this week?",
  "Which deals are stuck?",
  "What can close this month?",
  "Where should leadership intervene?",
];

type SnapshotResponse = {
  mode: "live" | "sample";
  source?: "memory" | "monday";
  data?: {
    board?: {
      id: string;
      name: string;
    };
    deals?: SalesDeal[];
    generatedAt?: string;
  };
  message?: string;
  error?: string;
};

function answerQuestion(question: string, deals: SalesDeal[]) {
  const lower = question.toLowerCase();
  const stale = deals
    .filter((deal) => deal.lastActivityDays >= 7)
    .sort((a, b) => b.lastActivityDays - a.lastActivityDays);
  const highIntent = deals
    .filter((deal) => deal.probability >= 60)
    .sort((a, b) => b.value * b.probability - a.value * a.probability);
  const weighted = deals.reduce(
    (sum, deal) => sum + deal.value * (deal.probability / 100),
    0,
  );

  if (lower.includes("stuck") || lower.includes("risk")) {
    if (!stale.length) return "No stale deals found in the loaded monday rows.";

    return `${stale.length} records need attention. Top risks: ${stale
      .slice(0, 5)
      .map(
        (deal) =>
          `${deal.account} (${deal.callStage || deal.stage}, ${deal.lastActivityDays} days quiet, owner: ${deal.owner})`,
      )
      .join("; ")}.`;
  }

  if (lower.includes("close") || lower.includes("month")) {
    if (!highIntent.length) return "I do not see high-probability closers in the loaded rows yet.";

    return `${highIntent.length} high-intent records are worth ${currency.format(
      highIntent.reduce((sum, deal) => sum + deal.value, 0),
    )} estimated budget and ${currency.format(
      highIntent.reduce((sum, deal) => sum + deal.value * (deal.probability / 100), 0),
    )} weighted. Start with ${highIntent[0].account}.`;
  }

  if (lower.includes("change") || lower.includes("week")) {
    return "The live board connection is now in place. The next upgrade is to store monday snapshots so I can compare today against yesterday/last week and produce true movement reports: new leads, stage moves, owner changes, verdict changes, and budget changes.";
  }

  return `Loaded ${deals.length} monday records. Estimated weighted pipeline is ${currency.format(
    weighted,
  )}. The highest leverage queue is stale records with Fit/Review signals and missing follow-up.`;
}

export default function Home() {
  const [deals, setDeals] = useState(sampleDeals);
  const [boardName, setBoardName] = useState("Sample sales board");
  const [mode, setMode] = useState<"loading" | "live" | "sample" | "error">("loading");
  const [statusMessage, setStatusMessage] = useState("Connecting to monday...");
  const [question, setQuestion] = useState("Which deals are stuck?");
  const [chat, setChat] = useState([
    {
      role: "brain",
      text: "I am connected to the monday CRM model and watching owner, qualification, outreach, call stage, next step, final verdict, budget, and activity age.",
    },
  ]);
  const [action, setAction] = useState("Update selected monday item");

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      try {
        const response = await fetch("/api/sales/snapshot", { cache: "no-store" });
        const payload = (await response.json()) as SnapshotResponse;

        if (cancelled) return;

        if (!response.ok || payload.error) {
          setMode("error");
          setStatusMessage(payload.error ?? "Unable to load monday data.");
          return;
        }

        if (payload.mode === "live" && payload.data?.deals?.length) {
          setDeals(payload.data.deals);
          setBoardName(payload.data.board?.name ?? "monday sales board");
          setMode("live");
          setStatusMessage(
            payload.source === "memory" && payload.data.generatedAt
              ? `Loaded ${payload.data.deals.length} records from Sales Brain memory (${new Date(
                  payload.data.generatedAt,
                ).toLocaleString()}).`
              : `Loaded ${payload.data.deals.length} live monday records.`,
          );
          return;
        }

        setMode("sample");
        setStatusMessage(payload.message ?? "Using sample data.");
      } catch (error) {
        if (cancelled) return;
        setMode("error");
        setStatusMessage(error instanceof Error ? error.message : "Unable to load monday data.");
      }
    }

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  const stages = useMemo(() => {
    const order = new Map<string, number>();
    for (const deal of deals) {
      const stage = deal.callStage || deal.stage;
      if (!order.has(stage)) order.set(stage, order.size);
    }
    return [...order.keys()].slice(0, 8);
  }, [deals]);

  const totals = useMemo(() => {
    const gross = deals.reduce((sum, deal) => sum + deal.value, 0);
    const weighted = deals.reduce(
      (sum, deal) => sum + deal.value * (deal.probability / 100),
      0,
    );
    const atRisk = deals.filter((deal) => deal.health !== "Green").length;

    return { gross, weighted, atRisk };
  }, [deals]);

  const sortedDeals = useMemo(
    () =>
      [...deals].sort((a, b) => {
        const healthRank = { Red: 0, Yellow: 1, Green: 2 };
        return healthRank[a.health] - healthRank[b.health] || b.value - a.value;
      }),
    [deals],
  );

  function askBrain(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;

    setChat((current) => [
      ...current,
      { role: "you", text: question },
      { role: "brain", text: answerQuestion(question, deals) },
    ]);
    setQuestion("");
  }

  return (
    <main className="min-h-screen bg-[#f7f5ef] text-[#171717]">
      <section className="border-b border-[#d8d2c3] bg-[#fbfaf6]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#736b5d]">
              Sales Brain
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal text-[#151515] md:text-5xl">
              {boardName}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span
                className={
                  mode === "live"
                    ? "border border-[#2f6846] bg-[#e8f3ec] px-2 py-1 font-semibold text-[#2f6846]"
                    : mode === "error"
                      ? "border border-[#9d2f3a] bg-[#fae8ea] px-2 py-1 font-semibold text-[#9d2f3a]"
                      : "border border-[#d8d2c3] bg-white px-2 py-1 font-semibold text-[#5d5549]"
                }
              >
                {mode}
              </span>
              <span className="text-[#5d5549]">{statusMessage}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Metric label="Est. budget" value={currency.format(totals.gross)} />
            <Metric label="Weighted" value={currency.format(totals.weighted)} />
            <Metric label="At risk" value={`${totals.atRisk} records`} tone="risk" />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            {stages.map((stage) => {
              const stageDeals = deals.filter((deal) => (deal.callStage || deal.stage) === stage);
              const value = stageDeals.reduce((sum, deal) => sum + deal.value, 0);

              return (
                <div
                  className="min-h-32 border border-[#d8d2c3] bg-white p-4"
                  key={stage}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate text-sm font-semibold" title={stage}>
                      {stage}
                    </h2>
                    <span className="text-xs text-[#756d61]">{stageDeals.length}</span>
                  </div>
                  <p className="mt-2 text-lg font-semibold">{currency.format(value)}</p>
                  <div className="mt-4 space-y-2">
                    {stageDeals.slice(0, 3).map((deal) => (
                      <div className="border-l-2 border-[#356d8f] pl-2 text-xs" key={deal.id}>
                        <p className="truncate font-medium" title={deal.account}>
                          {deal.account}
                        </p>
                        <p className="truncate text-[#756d61]" title={deal.owner}>
                          {deal.owner}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border border-[#d8d2c3] bg-white">
            <div className="flex flex-col gap-2 border-b border-[#d8d2c3] p-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Live monday records</h2>
                <p className="text-sm text-[#756d61]">
                  Sorted by risk first, then estimated budget.
                </p>
              </div>
              <button
                className="h-10 border border-[#191919] px-4 text-sm font-semibold hover:bg-[#191919] hover:text-white"
                onClick={() => window.location.reload()}
              >
                Sync monday
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1440px] border-collapse text-left text-sm">
                <thead className="bg-[#eee9dc] text-xs uppercase tracking-[0.12em] text-[#5d5549]">
                  <tr>
                    <th className="px-4 py-3">Lead</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Qualification</th>
                    <th className="px-4 py-3">Call Stage</th>
                    <th className="px-4 py-3">Next Steps</th>
                    <th className="px-4 py-3">Final verdict</th>
                    <th className="px-4 py-3">Budget</th>
                    <th className="px-4 py-3">Probability</th>
                    <th className="px-4 py-3">Meetings</th>
                    <th className="px-4 py-3">Last follow up</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDeals.map((deal) => (
                    <tr className="border-t border-[#ebe5d8]" key={deal.id}>
                      <td className="px-4 py-3">
                        <a
                          className="font-semibold hover:text-[#356d8f]"
                          href={deal.mondayUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {deal.account}
                        </a>
                        <p className="text-xs text-[#756d61]">
                          {deal.jobTitle || "No title"} {deal.country ? `- ${deal.country}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">{deal.owner}</td>
                      <td className="px-4 py-3">
                        <Status label={deal.qualification || "Blank"} />
                      </td>
                      <td className="px-4 py-3">
                        <Status label={deal.callStage || "Blank"} />
                      </td>
                      <td className="px-4 py-3">
                        <Status label={deal.nextStepsStatus || "Blank"} />
                      </td>
                      <td className="px-4 py-3">
                        <Status label={deal.finalVerdict || "Blank"} />
                      </td>
                      <td className="px-4 py-3">
                        <p>{deal.budget}</p>
                        <p className="text-xs text-[#756d61]">{currency.format(deal.value)}</p>
                      </td>
                      <td className="px-4 py-3">{deal.probability}%</td>
                      <td className="px-4 py-3 text-xs">
                        <p>1st: {deal.firstMeetingDate || "None"}</p>
                        <p>Latest: {deal.latestMeetingDate || "None"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{deal.lastFollowUpDate || "None"}</p>
                        <div className="mt-1">
                          <Health label={deal.health} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          className="h-9 border border-[#356d8f] px-3 text-xs font-semibold text-[#234e68] hover:bg-[#e6f1f6]"
                          onClick={() =>
                            setAction(`Add follow-up for ${deal.account} (${deal.id})`)
                          }
                        >
                          Queue update
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <section className="border border-[#d8d2c3] bg-white">
            <div className="border-b border-[#d8d2c3] p-4">
              <h2 className="text-lg font-semibold">Chat with Sales Brain</h2>
              <p className="text-sm text-[#756d61]">
                Answers use the currently loaded monday rows.
              </p>
            </div>
            <div className="max-h-[420px] space-y-3 overflow-auto p-4">
              {chat.map((message, index) => (
                <div
                  className={
                    message.role === "you"
                      ? "ml-10 bg-[#1f2933] p-3 text-sm text-white"
                      : "mr-10 bg-[#edf4f7] p-3 text-sm text-[#163142]"
                  }
                  key={`${message.role}-${index}`}
                >
                  {message.text}
                </div>
              ))}
            </div>
            <form className="border-t border-[#d8d2c3] p-4" onSubmit={askBrain}>
              <div className="mb-3 flex flex-wrap gap-2">
                {quickQuestions.map((item) => (
                  <button
                    className="border border-[#d8d2c3] px-3 py-2 text-xs hover:bg-[#f3efe4]"
                    key={item}
                    onClick={() => setQuestion(item)}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  aria-label="Ask Sales Brain"
                  className="h-11 min-w-0 flex-1 border border-[#bdb5a6] px-3 text-sm outline-none focus:border-[#356d8f]"
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about pipeline, stages, risks..."
                  value={question}
                />
                <button className="h-11 bg-[#356d8f] px-4 text-sm font-semibold text-white hover:bg-[#28536c]">
                  Ask
                </button>
              </div>
            </form>
          </section>

          <section className="border border-[#d8d2c3] bg-white p-4">
            <h2 className="text-lg font-semibold">monday write queue</h2>
            <p className="mt-1 text-sm text-[#756d61]">
              Writes are explicit and should be sent only after approval.
            </p>
            <div className="mt-4 border border-[#e1dbcf] bg-[#fbfaf6] p-3">
              <label className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5d5549]">
                Pending action
              </label>
              <input
                className="mt-2 h-10 w-full border border-[#c7bfaf] px-3 text-sm"
                onChange={(event) => setAction(event.target.value)}
                value={action}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button className="h-10 border border-[#9d2f3a] text-sm font-semibold text-[#9d2f3a]">
                  Reject
                </button>
                <button className="h-10 bg-[#2f6846] text-sm font-semibold text-white">
                  Approve write
                </button>
              </div>
            </div>
          </section>

          <section className="border border-[#d8d2c3] bg-white p-4">
            <h2 className="text-lg font-semibold">Lark report composer</h2>
            <p className="mt-1 text-sm text-[#756d61]">
              Ready once Lark app credentials and sales chat ID are added.
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <ReportLine label="Loaded" value={`${deals.length} monday records`} />
              <ReportLine label="Forecast" value={`${currency.format(totals.weighted)} weighted`} />
              <ReportLine
                label="Top risk"
                value={sortedDeals.find((deal) => deal.health === "Red")?.account ?? "None"}
              />
            </div>
            <button className="mt-4 h-10 w-full bg-[#191919] text-sm font-semibold text-white">
              Send to Lark
            </button>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "risk";
}) {
  return (
    <div className="min-w-28 border border-[#d8d2c3] bg-white px-4 py-3">
      <p className="text-xs text-[#756d61]">{label}</p>
      <p className={tone === "risk" ? "mt-1 font-semibold text-[#9d2f3a]" : "mt-1 font-semibold"}>
        {value}
      </p>
    </div>
  );
}

function Status({ label }: { label: string }) {
  return (
    <span className="inline-flex h-7 max-w-40 items-center truncate border border-[#b9cccf] bg-[#edf4f7] px-2 text-xs font-semibold text-[#234e68]">
      {label}
    </span>
  );
}

function Health({ label }: { label: SalesDeal["health"] }) {
  const classes = {
    Green: "border-[#2f6846] bg-[#e8f3ec] text-[#2f6846]",
    Yellow: "border-[#a7731b] bg-[#fff4d8] text-[#855713]",
    Red: "border-[#9d2f3a] bg-[#fae8ea] text-[#9d2f3a]",
  };

  return (
    <span className={`inline-flex h-7 items-center border px-2 text-xs font-semibold ${classes[label]}`}>
      {label}
    </span>
  );
}

function ReportLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[#eee8dd] pb-2">
      <span className="font-semibold">{label}</span>
      <span className="text-right text-[#5d5549]">{value}</span>
    </div>
  );
}
