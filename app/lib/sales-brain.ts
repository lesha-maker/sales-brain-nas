import type { SalesDeal } from "./monday";
import type { ConversationMessage, SalesContextNote } from "./sales-memory";

type BrainAnswerInput = {
  question: string;
  deals: SalesDeal[];
  conversation?: ConversationMessage[];
  contextNotes?: SalesContextNote[];
};

type StageSummary = {
  stage: string;
  count: number;
  estimatedBudget: number;
  weightedPipeline: number;
};

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export async function answerSalesQuestion({
  question,
  deals,
  conversation = [],
  contextNotes = [],
}: BrainAnswerInput) {
  const fallback = deterministicSalesAnswer(question, deals);
  const directAnswer = directSpecificLeadAnswer({ question, deals, conversation });
  const cmoDinnerAnswer = directCmoDinnerAnswer(question, deals);
  const normalized = question.toLowerCase();

  if (directAnswer) {
    return directAnswer;
  }

  if (cmoDinnerAnswer) {
    return cmoDinnerAnswer;
  }

  if (asksAboutMillionPlusNeverBooked(normalized) || asksAboutTodaysCallsWithDetails(normalized)) {
    return fallback;
  }

  if (!process.env.OPENAI_API_KEY) {
    return `${fallback}\n\nOpenAI analysis is ready in the codebase, but OPENAI_API_KEY is not configured yet.`;
  }

  try {
    return cleanLarkAnswer(
      await askOpenAI({ question, deals, conversation, contextNotes, fallback }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI request failed.";
    return cleanLarkAnswer(`${fallback}\n\nOpenAI analysis was unavailable: ${message}`);
  }
}

function directSpecificLeadAnswer({
  question,
  deals,
  conversation,
}: Required<BrainAnswerInput>) {
  const normalized = question.toLowerCase();
  const looksLikeUpdate =
    /\b(move|update|change|set|put)\b/.test(normalized) &&
    /\b(stage|agreement|proposal|qualified|status)\b/.test(normalized);

  if (!looksLikeUpdate) return "";

  const relevantDeals = findRelevantDeals(deals, question, conversation).slice(0, 5);
  if (!relevantDeals.length) return "";

  const names = relevantDeals
    .map((deal) => {
      const email = deal.email ? `, ${deal.email}` : "";
      const status = [
        deal.callStage && deal.callStage !== "5" ? deal.callStage : "",
        deal.nextStepsStatus && deal.nextStepsStatus !== "5" ? deal.nextStepsStatus : "",
        deal.finalVerdict && deal.finalVerdict !== "5" ? deal.finalVerdict : "",
      ]
        .filter(Boolean)
        .join(", ");

      return `${deal.account}${email}${status ? ` (${status})` : ""}`;
    })
    .join("; ");

  if (relevantDeals.length > 1) {
    return `I found multiple matching records: ${names}. Which one should I update?`;
  }

  return `I found ${names}. I can prepare that update, but I need you to confirm before I write to monday.`;
}

function deterministicSalesAnswer(question: string, deals: SalesDeal[]) {
  const normalized = question.toLowerCase();
  const weighted = deals.reduce(
    (sum, deal) => sum + deal.value * (deal.probability / 100),
    0,
  );
  const atRisk = deals
    .filter((deal) => deal.health !== "Green")
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, 5);
  const fit = deals
    .filter((deal) => deal.qualification === "Fit")
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, 5);
  const salesQualified = deals.filter((deal) => deal.callStage === "Sales Qualified");
  const inboundSalesQualified = salesQualified.filter((deal) => !isOutbound(deal));
  const outboundSalesQualified = salesQualified.filter(isOutbound);
  const upcomingCalls = upcomingBookedMeetings(deals);
  const todaysCalls = bookedMeetingsOn(deals, todayInSingapore());

  if (normalized.includes("stuck") || normalized.includes("risk")) {
    return [
      `I found ${atRisk.length} top risk records to check first:`,
      ...atRisk.map(
        (deal) =>
          `- ${deal.account}: ${deal.callStage || deal.stage}, ${deal.budget}, owner ${deal.owner}, next step: ${deal.nextStep}`,
      ),
    ].join("\n");
  }

  if (asksAboutInboundQualifiedLeads(normalized)) {
    return `We have ${inboundSalesQualified.length} inbound sales qualified leads right now.`;
  }

  if (asksAboutOutboundQualifiedLeads(normalized)) {
    return `We have ${outboundSalesQualified.length} outbound sales qualified leads right now.`;
  }

  if (normalized.includes("sales qualified")) {
    return `We have ${salesQualified.length} sales qualified leads right now.`;
  }

  if (asksAboutMillionPlusNeverBooked(normalized)) {
    const matches = deals
      .filter(isMillionPlusLead)
      .filter(hasNeverBookedCall)
      .sort((a, b) => b.value - a.value);

    if (!matches.length) {
      return "I do not see any $1M+ leads that have never booked a call.";
    }

    return [
      `I found ${matches.length} $1M+ leads that have never booked a call:`,
      ...matches.slice(0, 25).map(formatLeadListItem),
      matches.length > 25 ? `And ${matches.length - 25} more.` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (asksAboutTodaysCallsWithDetails(normalized)) {
    const ownerFilter = requestedOwner(normalized);
    const matches = ownerFilter
      ? todaysCalls.filter((deal) => ownerMatches(deal, ownerFilter))
      : todaysCalls;

    if (!matches.length) {
      return ownerFilter
        ? `I do not see any calls today assigned to ${ownerFilter.label}.`
        : "I do not see any calls scheduled for today.";
    }

    const heading = ownerFilter
      ? `I found ${matches.length} calls today assigned to ${ownerFilter.label}:`
      : `I found ${matches.length} calls today:`;

    return [heading, ...matches.map(formatDetailedCallItem)].join("\n");
  }

  if (asksAboutUpcomingCalls(normalized)) {
    return `You have ${upcomingCalls.length} upcoming calls. I counted records where call stage is Booked a Meeting and the 1st meeting date is today or later.`;
  }

  if (normalized.includes("fit") || normalized.includes("qualified")) {
    return [
      "Top Fit records from monday:",
      ...fit.map(
        (deal) =>
          `- ${deal.account}: ${deal.budget}, ${deal.country || "no country"}, owner ${deal.owner}`,
      ),
    ].join("\n");
  }

  if (normalized.includes("pipeline") || normalized.includes("forecast")) {
    return `Loaded ${deals.length} monday records. Estimated weighted pipeline is ${formatter.format(
      weighted,
    )}.`;
  }

  return [
    `I loaded ${deals.length} monday records.`,
    `Ask me: "what deals are stuck?", "show top fit leads", or "what is pipeline forecast?"`,
  ].join("\n");
}

function directCmoDinnerAnswer(question: string, deals: SalesDeal[]) {
  const normalized = question.toLowerCase();

  if (!asksAboutCmoDinner(normalized)) return "";

  const dinnerDeals = deals.filter(isCmoDinnerDeal);

  if (!dinnerDeals.length) {
    return "I checked the CMO Dinner board, but I do not see any CMO dinner records loaded in Sales Brain memory yet.";
  }

  const hotDeals = dinnerDeals
    .filter(isHotCmoDinnerLead)
    .sort((a, b) => cmoDinnerScore(b) - cmoDinnerScore(a))
    .slice(0, 10);

  if (asksForHotLeads(normalized)) {
    if (!hotDeals.length) {
      return `I checked ${dinnerDeals.length} CMO dinner records. None are clearly marked hot yet.`;
    }

    return [
      `The hottest CMO dinner leads I see are:`,
      ...hotDeals.map((deal) => `- ${formatCmoDinnerLead(deal)}`),
    ].join("\n");
  }

  if (asksAboutUpcomingCalls(normalized)) {
    const upcoming = upcomingBookedMeetings(dinnerDeals).slice(0, 10);

    if (!upcoming.length) {
      return "I checked the CMO Dinner board and do not see upcoming booked meetings dated today or later.";
    }

    return [
      `There are ${upcoming.length} upcoming CMO dinner meetings I see:`,
      ...upcoming.map((deal) => `- ${formatCmoDinnerLead(deal)}`),
    ].join("\n");
  }

  return `I checked the CMO Dinner board. It has ${dinnerDeals.length} records loaded, including ${hotDeals.length} hot or high-signal leads.`;
}

async function askOpenAI({
  question,
  deals,
  conversation = [],
  contextNotes = [],
  fallback,
}: BrainAnswerInput & { fallback: string }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  const relevantDeals = topDeals(findRelevantDeals(deals, question, conversation), 12);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: {
        effort: process.env.OPENAI_REASONING_EFFORT || "medium",
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are Harry, the Sales Brain sales agent for Nas Daily.",
                "Your name is Harry. If the user says Harry, they usually mean you, not a CRM lead or another person.",
                "Do not make jokes about Harry Potter or treat Harry as an external contact unless the CRM data clearly identifies a separate person named Harry.",
                "Answer questions about the monday.com CRM with concrete numbers in normal, conversational English.",
                "Use only the supplied CRM summary. Do not invent records, amounts, owners, or statuses.",
                "Keep Lark replies short and human. Prefer 1-3 plain sentences for simple questions.",
                "Do not use markdown formatting, bold text, code ticks, bullet points, or CRM jargon unless the user asks for a detailed report.",
                "Say 'sales qualified' instead of 'Call Stage = Sales Qualified' unless the exact field name matters.",
                "When the user asks how many calls are coming up, upcoming calls, or booked calls, count only CRM records where callStage is 'Booked a Meeting' and firstMeetingDate is today or later in Asia/Singapore.",
                "When the user mentions CMO dinner, dinner leads, Miami dinner, Singapore dinner, or Tel Aviv, use only the CMO Dinner board records. In this CRM summary those are in crmSummary.cmoDinner.",
                "Use the recent conversation to understand follow-up questions. For example, if the user asks for 'the list', infer the list from the previous answer.",
                "If the follow-up is ambiguous, make your best inference from the recent conversation and say what you assumed.",
                "When the CRM summary includes relevantDeals, use those records first for questions about a specific company or person.",
                "The field matchingCrmRecordsForThisQuestion is the most important source for company-specific questions.",
                "If there are multiple matching records for the same company, say there are multiple records and distinguish them by email, stage, or status.",
                "Never say you cannot find a record if matchingCrmRecordsForThisQuestion contains records.",
                "If there is a data caveat, explain it simply in a sentence after the answer.",
                "When recommending writes back to monday, phrase them as proposed actions, not completed changes.",
              ].join("\n"),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  question,
                  recentConversation: conversation.slice(-8),
                  matchingCrmRecordsForThisQuestion: relevantDeals,
                  salesBrainContextNotes: relevantContextNotes({
                    notes: contextNotes,
                    question,
                    deals: relevantDeals,
                  }),
                  crmSummary: buildCrmSummary(deals, question, conversation),
                  deterministicBaseline: fallback,
                },
                null,
                2,
              ),
            },
          ],
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    output_text?: string;
    output?: Array<{
      content?: Array<{
        text?: string;
        type?: string;
      }>;
    }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI returned HTTP ${response.status}`);
  }

  return extractResponseText(payload) || fallback;
}

function buildCrmSummary(
  deals: SalesDeal[],
  question = "",
  conversation: ConversationMessage[] = [],
) {
  const stageSummaries = summarizeByStage(deals);
  const callStageSummaries = summarizeByColumn(deals, (deal) => deal.callStage || "Blank");
  const nextStepSummaries = summarizeByColumn(deals, (deal) => deal.nextStepsStatus || "Blank");
  const finalVerdictSummaries = summarizeByColumn(deals, (deal) => deal.finalVerdict || "Blank");
  const ownerSummaries = summarizeByOwner(deals);
  const topFit = topDeals(deals.filter((deal) => deal.qualification === "Fit"), 12);
  const topReview = topDeals(deals.filter((deal) => deal.qualification === "Review"), 12);
  const topNotFit = topDeals(deals.filter((deal) => deal.qualification === "Not Fit"), 8);
  const salesQualified = topDeals(
    deals.filter((deal) => deal.callStage === "Sales Qualified"),
    20,
  );
  const inboundSalesQualified = topDeals(
    deals.filter((deal) => deal.callStage === "Sales Qualified" && !isOutbound(deal)),
    20,
  );
  const outboundSalesQualified = topDeals(
    deals.filter((deal) => deal.callStage === "Sales Qualified" && isOutbound(deal)),
    20,
  );
  const upcomingCalls = topDeals(upcomingBookedMeetings(deals), 20);
  const lateStageClosing = topDeals(
    deals.filter((deal) =>
      ["2nd call with Nuseir", "Confirmed (Verbal)", "Completed"].includes(deal.finalVerdict),
    ),
    20,
  );
  const proposalDone = topDeals(
    deals.filter((deal) => deal.nextStepsStatus === "Proposal Done"),
    20,
  );
  const relevantDeals = topDeals(findRelevantDeals(deals, question, conversation), 12);
  const cmoDinnerDeals = deals.filter(isCmoDinnerDeal);
  const hotCmoDinnerDeals = topDeals(
    cmoDinnerDeals.filter(isHotCmoDinnerLead).sort((a, b) => cmoDinnerScore(b) - cmoDinnerScore(a)),
    15,
  );
  const missingOwnerCount = deals.filter((deal) => deal.owner === "Unassigned").length;
  const noBudgetCount = deals.filter((deal) => deal.budget === "Unknown").length;
  const weightedPipeline = deals.reduce(
    (sum, deal) => sum + deal.value * (deal.probability / 100),
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    totalRecords: deals.length,
    estimatedBudget: deals.reduce((sum, deal) => sum + deal.value, 0),
    weightedPipeline: Math.round(weightedPipeline),
    healthCounts: countBy(deals, (deal) => deal.health),
    stageSummaries,
    callStageSummaries,
    nextStepSummaries,
    finalVerdictSummaries,
    ownerSummaries,
    dataQuality: {
      missingOwnerCount,
      noBudgetCount,
    },
    topFit,
    topReview,
    topNotFit,
    salesQualified,
    inboundSalesQualified,
    outboundSalesQualified,
    inboundSalesQualifiedCount: deals.filter(
      (deal) => deal.callStage === "Sales Qualified" && !isOutbound(deal),
    ).length,
    outboundSalesQualifiedCount: deals.filter(
      (deal) => deal.callStage === "Sales Qualified" && isOutbound(deal),
    ).length,
    upcomingCalls,
    upcomingCallsDefinition:
      "callStage is Booked a Meeting and firstMeetingDate is today or later in Asia/Singapore",
    lateStageClosing,
    proposalDone,
    relevantDeals,
    cmoDinner: {
      totalRecords: cmoDinnerDeals.length,
      hotLeads: hotCmoDinnerDeals,
      upcomingMeetings: topDeals(upcomingBookedMeetings(cmoDinnerDeals), 12),
      qualifiedCount: cmoDinnerDeals.filter(
        (deal) => deal.qualification === "Qualified" || deal.qualification === "Fit",
      ).length,
      note: "Use this section whenever the user asks about CMO dinner leads.",
    },
  };
}

function findRelevantDeals(
  deals: SalesDeal[],
  question: string,
  conversation: ConversationMessage[],
) {
  const searchText = [
    ...conversation
      .filter((message) => message.role === "user")
      .slice(-4)
      .map((message) => message.text),
    question,
  ].join(" ");
  const tokens = searchTokens(searchText);

  if (!tokens.length) return [];

  return deals
    .map((deal) => ({ deal, score: relevanceScore(deal, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((item) => item.deal);
}

function relevantContextNotes({
  notes,
  question,
  deals,
}: {
  notes: SalesContextNote[];
  question: string;
  deals: Array<Pick<SalesDeal, "account" | "email" | "id">>;
}) {
  const tokens = searchTokens(
    [
      question,
      ...deals.flatMap((deal) => [deal.account, deal.email, deal.id]),
    ].join(" "),
  );

  if (!tokens.length) return notes.slice(-8);

  return notes
    .map((note) => {
      const searchable = normalizeSearch(
        [note.account, note.email, note.itemId, note.note, note.rawText].filter(Boolean).join(" "),
      );
      const score = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 1 : 0), 0);
      return { note, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((item) => item.note);
}

function relevanceScore(deal: SalesDeal, tokens: string[]) {
  const account = normalizeSearch(deal.account);
  const email = normalizeSearch(deal.email);
  const website = normalizeSearch(deal.website);
  const searchable = `${account} ${email} ${website}`;
  let score = 0;

  for (const token of tokens) {
    if (account && account === token) score += 100;
    else if (account && (account.includes(token) || token.includes(account))) score += 40;
    else if (searchable.includes(token)) score += 12;
  }

  return score;
}

function searchTokens(text: string) {
  const stopWords = new Set([
    "about",
    "agreement",
    "called",
    "can",
    "crm",
    "give",
    "into",
    "list",
    "monday",
    "move",
    "stage",
    "status",
    "that",
    "this",
    "update",
    "what",
    "with",
  ]);

  return [
    ...new Set(
      text
        .split(/[^a-zA-Z0-9@._-]+/)
        .map((token) => normalizeSearch(token))
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    ),
  ];
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function summarizeByStage(deals: SalesDeal[]) {
  return summarizeByColumn(deals, (deal) => deal.stage);
}

function summarizeByColumn(deals: SalesDeal[], keyFor: (deal: SalesDeal) => string) {
  const summaries = new Map<string, StageSummary>();

  for (const deal of deals) {
    const key = keyFor(deal);
    const current =
      summaries.get(key) ||
      ({
        stage: key,
        count: 0,
        estimatedBudget: 0,
        weightedPipeline: 0,
      } satisfies StageSummary);

    current.count += 1;
    current.estimatedBudget += deal.value;
    current.weightedPipeline += deal.value * (deal.probability / 100);
    summaries.set(key, current);
  }

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      weightedPipeline: Math.round(summary.weightedPipeline),
    }))
    .sort((a, b) => b.weightedPipeline - a.weightedPipeline);
}

function summarizeByOwner(deals: SalesDeal[]) {
  return [...groupBy(deals, (deal) => deal.owner).entries()]
    .map(([owner, ownerDeals]) => ({
      owner,
      count: ownerDeals.length,
      fitCount: ownerDeals.filter((deal) => deal.qualification === "Fit").length,
      reviewCount: ownerDeals.filter((deal) => deal.qualification === "Review").length,
      estimatedBudget: ownerDeals.reduce((sum, deal) => sum + deal.value, 0),
      weightedPipeline: Math.round(
        ownerDeals.reduce((sum, deal) => sum + deal.value * (deal.probability / 100), 0),
      ),
    }))
    .sort((a, b) => b.weightedPipeline - a.weightedPipeline)
    .slice(0, 12);
}

function asksAboutUpcomingCalls(normalizedQuestion: string) {
  const mentionsCall = /\b(call|calls|meeting|meetings)\b/.test(normalizedQuestion);
  const mentionsUpcoming =
    /\b(upcoming|coming up|booked|scheduled|today|tomorrow|next)\b/.test(normalizedQuestion);

  return mentionsCall && mentionsUpcoming;
}

function asksAboutTodaysCallsWithDetails(normalizedQuestion: string) {
  return (
    /\btoday\b/.test(normalizedQuestion) &&
    /\b(call|calls|meeting|meetings)\b/.test(normalizedQuestion) &&
    /\b(company|budget|qualifier|agent|says|notes|info|assigned)\b/.test(normalizedQuestion)
  );
}

function asksAboutMillionPlusNeverBooked(normalizedQuestion: string) {
  const mentionsMillionPlus =
    /\b1\s*m\+?\b/.test(normalizedQuestion) ||
    /\b1m\+?\b/.test(normalizedQuestion) ||
    /\$1\s*m\+?/.test(normalizedQuestion) ||
    /\b1\s*million\+?\b/.test(normalizedQuestion) ||
    /\$1\s*million\+?/.test(normalizedQuestion);
  const mentionsNeverBooked =
    /\bnever\b/.test(normalizedQuestion) &&
    /\b(booked|scheduled|had)\b/.test(normalizedQuestion) &&
    /\b(call|meeting)\b/.test(normalizedQuestion);

  return mentionsMillionPlus && mentionsNeverBooked;
}

function asksAboutInboundQualifiedLeads(normalizedQuestion: string) {
  return (
    /\binbound\b/.test(normalizedQuestion) &&
    /\b(qualified|sql|sales qualified)\b/.test(normalizedQuestion) &&
    /\b(lead|leads|records|clients)\b/.test(normalizedQuestion)
  );
}

function asksAboutOutboundQualifiedLeads(normalizedQuestion: string) {
  return (
    /\boutbound\b/.test(normalizedQuestion) &&
    /\b(qualified|sql|sales qualified)\b/.test(normalizedQuestion) &&
    /\b(lead|leads|records|clients)\b/.test(normalizedQuestion)
  );
}

function asksAboutCmoDinner(normalizedQuestion: string) {
  return (
    /\bcmo\b/.test(normalizedQuestion) ||
    /\bdinner\b/.test(normalizedQuestion) ||
    /\bmiami dinner\b/.test(normalizedQuestion) ||
    /\bsingapore dinner\b/.test(normalizedQuestion) ||
    /\btel aviv\b/.test(normalizedQuestion)
  );
}

function asksForHotLeads(normalizedQuestion: string) {
  return /\b(hot|hottest|high signal|priority|excited|important|best|top)\b/.test(normalizedQuestion);
}

function isCmoDinnerDeal(deal: SalesDeal) {
  return deal.boardId === "5030120019" || (deal.boardName || "").toLowerCase().includes("cmo dinner");
}

function isHotCmoDinnerLead(deal: SalesDeal) {
  if (isNegativeDeal(deal)) return false;
  return cmoDinnerScore(deal) >= 35;
}

function isNegativeDeal(deal: SalesDeal) {
  return (
    ["Lost", "Gone Cold", "No Show", "Not Qualified"].includes(deal.finalVerdict) ||
    ["No Show", "Not Qualified"].includes(deal.callStage) ||
    deal.qualification === "Not Qualified"
  );
}

function cmoDinnerScore(deal: SalesDeal) {
  const text = [
    deal.account,
    deal.qualification,
    deal.callStage,
    deal.nextStepsStatus,
    deal.finalVerdict,
    deal.status,
    deal.followUp,
    deal.agentNotes,
    deal.salesCallNotes,
    deal.budget,
    deal.jobTitle,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;

  if (deal.qualification === "Qualified" || deal.qualification === "Fit") score += 35;
  if (deal.callStage === "Sales Qualified") score += 35;
  if (deal.callStage === "Booked a Meeting" || deal.callStage === "Meeting Booked") score += 30;
  if (deal.nextStepsStatus === "Proposal Done" || deal.nextStepsStatus === "Proposal Stage") score += 25;
  if (["Agreement Stage", "Confirmed (Verbal)", "2nd call with Nuseir"].includes(deal.finalVerdict)) score += 35;
  if (deal.status === "Going") score += 8;
  if (deal.firstMeetingDate) score += 8;
  if (/\b(proposal|follow[- ]?up|meeting|closing|nuseir|interested|qualified)\b/.test(text)) score += 20;
  if (/\b(ceo|founder|cmo|head of|vp|director)\b/.test(text)) score += 12;
  if (/\$1m|1m\+|million|\$ms|300k|500k/i.test(text)) score += 20;

  return score;
}

function formatCmoDinnerLead(deal: SalesDeal) {
  const details = [
    deal.firstMeetingDate ? `meeting ${friendlyDate(deal.firstMeetingDate)}` : "",
    deal.budget && deal.budget !== "Unknown" ? deal.budget : "",
    deal.owner && deal.owner !== "Unassigned" ? `owner ${deal.owner}` : "",
    dinnerSignal(deal),
  ].filter(Boolean);

  return `${deal.account}${details.length ? `: ${details.join(", ")}` : ""}`;
}

function dinnerSignal(deal: SalesDeal) {
  const stages = [deal.callStage, deal.nextStepsStatus, deal.finalVerdict]
    .filter((value) => value && value !== "5")
    .join(" / ");

  if (stages) return stages;

  const note = [deal.followUp, deal.agentNotes, deal.salesCallNotes]
    .find((value) => value && value.trim());

  return note ? note.replace(/\s+/g, " ").slice(0, 120) : "";
}

function isOutbound(deal: SalesDeal) {
  if (deal.group) return deal.group === "Outbound Leads";
  return deal.source?.toLowerCase().includes("outbound") || false;
}

function requestedOwner(normalizedQuestion: string) {
  if (/\b(diko|ildiko)\b/.test(normalizedQuestion)) {
    return { label: "Diko", tokens: ["diko", "ildiko", "kissimonova"] };
  }

  if (/\b(diana)\b/.test(normalizedQuestion)) {
    return { label: "Diana", tokens: ["diana", "orozco", "gollaz"] };
  }

  if (/\b(alex)\b/.test(normalizedQuestion)) {
    return { label: "Alex", tokens: ["alex", "dwek"] };
  }

  if (/\b(lesha)\b/.test(normalizedQuestion)) {
    return { label: "Lesha", tokens: ["lesha", "mansukhani"] };
  }

  return null;
}

function ownerMatches(deal: SalesDeal, owner: { tokens: string[] }) {
  const normalizedOwner = deal.owner.toLowerCase();
  return owner.tokens.some((token) => normalizedOwner.includes(token));
}

function isMillionPlusLead(deal: SalesDeal) {
  if (deal.value >= 1_000_000) return true;

  const budget = deal.budget.toLowerCase();
  return /\b\d+(?:\.\d+)?\s*(?:m|mm|million)\s*\+/.test(budget);
}

function hasNeverBookedCall(deal: SalesDeal) {
  return (
    !["Booked a Meeting", "Meeting Booked", "No Show", "Cancelled"].includes(deal.callStage) &&
    !dateOnly(deal.firstMeetingDate) &&
    !dateOnly(deal.latestMeetingDate)
  );
}

function formatLeadListItem(deal: SalesDeal) {
  const details = [
    deal.email,
    deal.budget && deal.budget !== "Unknown" ? deal.budget : "",
    deal.country,
    deal.owner && deal.owner !== "Unassigned" ? `owner ${deal.owner}` : "",
    deal.callStage && deal.callStage !== "5" ? deal.callStage : "",
  ].filter(Boolean);

  return `- ${deal.account}${details.length ? `: ${details.join(", ")}` : ""}`;
}

function formatDetailedCallItem(deal: SalesDeal) {
  const qualifierNotes = compactNote(
    deal.agentNotes || deal.salesCallNotes || deal.lookingFor || deal.nextStep || "",
  );
  const details = [
    deal.firstMeetingDate ? `time ${friendlyDateTime(deal.firstMeetingDate)}` : "",
    deal.budget && deal.budget !== "Unknown" ? `budget ${deal.budget}` : "budget unknown",
    qualifierNotes ? `qualifier notes: ${qualifierNotes}` : "qualifier notes: none in CRM",
  ];

  return `- ${deal.account}: ${details.join("; ")}`;
}

function compactNote(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized !== "5" ? normalized.slice(0, 260) : "";
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

function bookedMeetingsOn(deals: SalesDeal[], targetDate: string) {
  return deals
    .filter((deal) => deal.callStage === "Booked a Meeting")
    .filter((deal) => dateOnly(deal.firstMeetingDate) === targetDate)
    .sort((a, b) => timeOnly(a.firstMeetingDate).localeCompare(timeOnly(b.firstMeetingDate)));
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
  const monthDay = value.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i,
  );

  if (monthDay) {
    const year = todayInSingapore().slice(0, 4);
    const month = monthNumber(monthDay[1]);
    const day = monthDay[2].padStart(2, "0");
    return month ? `${year}-${month}-${day}` : "";
  }

  const parsed = Date.parse(value);

  if (!Number.isNaN(parsed)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }

  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] || "";
}

function friendlyDate(value: string) {
  const date = dateOnly(value);
  if (!date) return value;

  const parsed = new Date(`${date}T00:00:00+08:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function friendlyDateTime(value: string) {
  const time = timeOnly(value);
  return time || friendlyDate(value);
}

function timeOnly(value: string) {
  const parsed = Date.parse(value);

  if (!Number.isNaN(parsed)) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  }

  const match = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function monthNumber(value: string) {
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    sept: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  return months[value.toLowerCase().slice(0, 4)] || months[value.toLowerCase().slice(0, 3)] || "";
}

function topDeals(deals: SalesDeal[], limit: number) {
  return deals
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, limit)
    .map((deal) => ({
      account: deal.account,
      group: deal.group,
      boardId: deal.boardId,
      boardName: deal.boardName,
      owner: deal.owner,
      email: deal.email,
      stage: deal.stage,
      qualification: deal.qualification,
      initialOutreach: deal.initialOutreach,
      callStage: deal.callStage,
      nextStepsStatus: deal.nextStepsStatus,
      finalVerdict: deal.finalVerdict,
      firstMeetingDate: deal.firstMeetingDate,
      latestMeetingDate: deal.latestMeetingDate,
      lastFollowUpDate: deal.lastFollowUpDate,
      budget: deal.budget,
      estimatedValue: deal.value,
      probability: deal.probability,
      country: deal.country,
      jobTitle: deal.jobTitle,
      website: deal.website,
      lookingFor: deal.lookingFor,
      agentNotes: deal.agentNotes,
      salesCallNotes: deal.salesCallNotes,
      nextStep: deal.nextStep,
      mondayUrl: deal.mondayUrl,
    }));
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return [...groupBy(items, keyFor).entries()].reduce<Record<string, number>>(
    (counts, [key, values]) => {
      counts[key] = values.length;
      return counts;
    },
    {},
  );
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }

  return grouped;
}

function extractResponseText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  if (payload.output_text) return payload.output_text;

  return payload.output
    ?.flatMap((item) => item.content || [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanLarkAnswer(answer: string) {
  return answer
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
