import type { SalesDeal } from "./monday";

type BrainAnswerInput = {
  question: string;
  deals: SalesDeal[];
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

export async function answerSalesQuestion({ question, deals }: BrainAnswerInput) {
  const fallback = deterministicSalesAnswer(question, deals);

  if (!process.env.OPENAI_API_KEY) {
    return `${fallback}\n\nOpenAI analysis is ready in the codebase, but OPENAI_API_KEY is not configured yet.`;
  }

  try {
    return await askOpenAI({ question, deals, fallback });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI request failed.";
    return `${fallback}\n\nOpenAI analysis was unavailable: ${message}`;
  }
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
    .filter((deal) => deal.stage === "Fit")
    .sort((a, b) => b.value * b.probability - a.value * a.probability)
    .slice(0, 5);

  if (normalized.includes("stuck") || normalized.includes("risk")) {
    return [
      `I found ${atRisk.length} top risk records to check first:`,
      ...atRisk.map(
        (deal) =>
          `- ${deal.account}: ${deal.stage}, ${deal.budget}, owner ${deal.owner}, next step: ${deal.nextStep}`,
      ),
    ].join("\n");
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
  fallback,
}: BrainAnswerInput & { fallback: string }) {
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
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
                "Answer questions about the monday.com CRM with concrete numbers, risks, and next actions.",
                "Use only the supplied CRM summary. Do not invent records, amounts, owners, or statuses.",
                "Keep Lark replies concise: 3-7 bullets unless the user asks for detail.",
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
                  crmSummary: buildCrmSummary(deals),
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

function buildCrmSummary(deals: SalesDeal[]) {
  const stageSummaries = summarizeByStage(deals);
  const ownerSummaries = summarizeByOwner(deals);
  const topFit = topDeals(deals.filter((deal) => deal.stage === "Fit"), 12);
  const topReview = topDeals(deals.filter((deal) => deal.stage === "Review"), 12);
  const topNotFit = topDeals(deals.filter((deal) => deal.stage === "Not Fit"), 8);
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
    ownerSummaries,
    dataQuality: {
      missingOwnerCount,
      noBudgetCount,
    },
    topFit,
    topReview,
    topNotFit,
  };
}

function summarizeByStage(deals: SalesDeal[]) {
  const summaries = new Map<string, StageSummary>();

  for (const deal of deals) {
    const current =
      summaries.get(deal.stage) ||
      ({
        stage: deal.stage,
        count: 0,
        estimatedBudget: 0,
        weightedPipeline: 0,
      } satisfies StageSummary);

    current.count += 1;
    current.estimatedBudget += deal.value;
    current.weightedPipeline += deal.value * (deal.probability / 100);
    summaries.set(deal.stage, current);
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
      fitCount: ownerDeals.filter((deal) => deal.stage === "Fit").length,
      reviewCount: ownerDeals.filter((deal) => deal.stage === "Review").length,
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
      stage: deal.stage,
      budget: deal.budget,
      estimatedValue: deal.value,
      probability: deal.probability,
      country: deal.country,
      jobTitle: deal.jobTitle,
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
