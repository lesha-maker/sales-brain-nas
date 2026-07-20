import type { SalesDeal } from "./monday";
import type { ConversationMessage } from "./sales-memory";

type BrainAnswerInput = {
  question: string;
  deals: SalesDeal[];
  conversation?: ConversationMessage[];
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

export async function answerSalesQuestion({ question, deals, conversation = [] }: BrainAnswerInput) {
  const fallback = deterministicSalesAnswer(question, deals);
  const directAnswer = directSpecificLeadAnswer({ question, deals, conversation });

  if (directAnswer) {
    return directAnswer;
  }

  if (!process.env.OPENAI_API_KEY) {
    return `${fallback}\n\nOpenAI analysis is ready in the codebase, but OPENAI_API_KEY is not configured yet.`;
  }

  try {
    return cleanLarkAnswer(await askOpenAI({ question, deals, conversation, fallback }));
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

  if (normalized.includes("stuck") || normalized.includes("risk")) {
    return [
      `I found ${atRisk.length} top risk records to check first:`,
      ...atRisk.map(
        (deal) =>
          `- ${deal.account}: ${deal.callStage || deal.stage}, ${deal.budget}, owner ${deal.owner}, next step: ${deal.nextStep}`,
      ),
    ].join("\n");
  }

  if (normalized.includes("sales qualified")) {
    return `We have ${salesQualified.length} sales qualified leads right now.`;
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

async function askOpenAI({
  question,
  deals,
  conversation = [],
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
                "You are Sales Brain, an analytical sales operations agent for Nas Daily.",
                "Answer questions about the monday.com CRM with concrete numbers in normal, conversational English.",
                "Use only the supplied CRM summary. Do not invent records, amounts, owners, or statuses.",
                "Keep Lark replies short and human. Prefer 1-3 plain sentences for simple questions.",
                "Do not use markdown formatting, bold text, code ticks, bullet points, or CRM jargon unless the user asks for a detailed report.",
                "Say 'sales qualified' instead of 'Call Stage = Sales Qualified' unless the exact field name matters.",
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
    lateStageClosing,
    proposalDone,
    relevantDeals,
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

function relevanceScore(deal: SalesDeal, tokens: string[]) {
  const account = normalizeSearch(deal.account);
  const email = normalizeSearch(deal.email);
  const website = normalizeSearch(deal.website);
  const searchable = `${account} ${email} ${website}`;
  let score = 0;

  for (const token of tokens) {
    if (account === token) score += 100;
    else if (account.includes(token) || token.includes(account)) score += 40;
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

function topDeals(deals: SalesDeal[], limit: number) {
  return deals
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, limit)
    .map((deal) => ({
      account: deal.account,
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
