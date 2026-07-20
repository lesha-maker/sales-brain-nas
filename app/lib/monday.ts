const MONDAY_API_URL = "https://api.monday.com/v2";

export type SalesDeal = {
  id: string;
  account: string;
  owner: string;
  stage: string;
  value: number;
  closeDate: string;
  health: "Green" | "Yellow" | "Red";
  nextStep: string;
  lastActivityDays: number;
  probability: number;
  budget: string;
  email: string;
  country: string;
  jobTitle: string;
  source: string;
  mondayUrl: string;
};

type MondayRequest = {
  query: string;
  variables?: Record<string, unknown>;
};

export async function mondayRequest<T>({
  query,
  variables,
}: MondayRequest): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;

  if (!token) {
    throw new Error("MONDAY_API_TOKEN is not configured.");
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message ?? "monday API request failed.");
  }

  if (!payload.data) {
    throw new Error("monday API returned no data.");
  }

  return payload.data;
}

export async function getBoardSnapshot(boardId: string) {
  const data = await mondayRequest<{
    boards: Array<{
      id: string;
      name: string;
      columns: Array<{ id: string; title: string; type: string; settings_str?: string }>;
      items_page: {
        cursor?: string;
        items: MondayItem[];
      };
    }>;
  }>({
    query: `
      query SalesBoard($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          name
          columns {
            id
            title
            type
            settings_str
          }
          items_page(limit: 500) {
            cursor
            items {
              id
              name
              group { id title }
              column_values {
                id
                text
                value
                type
              }
              updates(limit: 3) {
                id
                body
                created_at
              }
            }
          }
        }
      }
    `,
    variables: { boardId },
  });

  const board = data.boards[0];

  if (board?.items_page.cursor) {
    let cursor = board.items_page.cursor;

    while (cursor) {
      const page = await getNextItemsPage(cursor);
      board.items_page.items = board.items_page.items.concat(page.items);
      cursor = page.cursor;
    }
  }

  return {
    board,
    deals: board ? normalizeDeals(board) : [],
  };
}

async function getNextItemsPage(cursor: string) {
  const data = await mondayRequest<{
    next_items_page: {
      cursor?: string;
      items: MondayItem[];
    };
  }>({
    query: `
      query NextSalesBoardItems($cursor: String!) {
        next_items_page(cursor: $cursor, limit: 500) {
          cursor
          items {
            id
            name
            group { id title }
            column_values {
              id
              text
              value
              type
            }
            updates(limit: 3) {
              id
              body
              created_at
            }
          }
        }
      }
    `,
    variables: { cursor },
  });

  return data.next_items_page;
}

type MondayItem = {
  id: string;
  name: string;
  group?: { id: string; title: string };
  column_values: Array<{
    id: string;
    text?: string | null;
    value?: string | null;
    type: string;
  }>;
  updates?: Array<{ id: string; body: string; created_at: string }>;
};

const columns = {
  owner: "multiple_person_mm546gv2",
  source: "color_mm4p2xwk",
  qualification: "color_mm4jxst5",
  outreach: "color_mm4jtmcv",
  callStage: "color_mm4j8pct",
  nextStepsStatus: "color_mm524pr",
  finalVerdict: "color_mm594jh8",
  probability: "color_mm52bm3k",
  firstMeeting: "date_mm4trd3h",
  latestMeeting: "date_mm58yark",
  lastFollowUpDate: "date_mm59agw5",
  firstName: "text_mm4jed5h",
  lastName: "text_mm4j6g5p",
  email: "email_mm4jfc4f",
  jobTitle: "text_mm4jzwhg",
  country: "text_mm4jqhbd",
  budget: "text_mm4jzveb",
  lookingFor: "long_text_mm4j7ftq",
  notes: "long_text_mm4jt916",
  status: "text_mm52m79k",
  followUp: "text_mm52trjk",
  added: "date_mm4tf2tz",
};

function normalizeDeals(board: { id: string; items_page: { items: MondayItem[] } }) {
  return board.items_page.items.map((item) => {
    const valueFor = (columnId: string) =>
      item.column_values.find((column) => column.id === columnId)?.text?.trim() ?? "";

    const notes = valueFor(columns.notes);
    const inferredVerdict = verdictFromNotes(notes);
    const stage =
      firstPresent([
        valueFor(columns.finalVerdict),
        inferredVerdict,
        valueFor(columns.nextStepsStatus),
        valueFor(columns.callStage),
        valueFor(columns.outreach),
        valueFor(columns.qualification),
        valueFor(columns.source),
        item.group?.title,
      ]) || "Unstaged";

    const lastActivityDate =
      firstPresent([
        valueFor(columns.lastFollowUpDate),
        valueFor(columns.latestMeeting),
        valueFor(columns.firstMeeting),
        valueFor(columns.added),
      ]) || "";

    const finalVerdict = valueFor(columns.finalVerdict);
    const qualification = valueFor(columns.qualification);
    const budget = valueFor(columns.budget);
    const probability = probabilityFrom({
      probability: valueFor(columns.probability),
      finalVerdict,
      qualification,
      budget,
      notes,
    });
    const lastActivityDays = daysSince(lastActivityDate);

    return {
      id: item.id,
      account: item.name,
      owner: valueFor(columns.owner) || "Unassigned",
      stage,
      value: estimatedBudgetValue(budget),
      closeDate:
        firstPresent([
          valueFor(columns.latestMeeting),
          valueFor(columns.firstMeeting),
          valueFor(columns.added),
        ]) || "No date",
      health: healthFor({
        finalVerdict: finalVerdict || inferredVerdict,
        qualification,
        lastActivityDays,
        probability,
      }),
      nextStep:
        firstPresent([
          valueFor(columns.followUp),
          valueFor(columns.nextStepsStatus),
          firstSentence(valueFor(columns.lookingFor)),
          firstSentence(notes),
        ]) || "Add next step",
      lastActivityDays,
      probability,
      budget: budget || "Unknown",
      email: valueFor(columns.email),
      country: valueFor(columns.country),
      jobTitle: valueFor(columns.jobTitle),
      source: valueFor(columns.source) || item.group?.title || "Unknown",
      mondayUrl: `https://nas-io.monday.com/boards/${board.id}/pulses/${item.id}`,
    } satisfies SalesDeal;
  });
}

function firstPresent(values: Array<string | undefined | null>) {
  return values.find((value) => value && value.trim())?.trim();
}

function firstSentence(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.split(/(?<=[.!?])\s+/)[0]?.slice(0, 160) ?? "";
}

function verdictFromNotes(notes: string) {
  const text = notes.trim().toLowerCase();

  if (text.startsWith("not fit") || text.includes("\nnot fit")) return "Not Fit";
  if (text.startsWith("fit") || text.includes("\nfit")) return "Fit";
  if (text.startsWith("review") || text.includes("\nreview")) return "Review";

  return "";
}

function estimatedBudgetValue(budget: string) {
  const normalized = budget.toLowerCase();

  if (!normalized) return 0;
  if (normalized.includes("less than") || normalized.includes("<")) return 5000;

  const numbers = normalized
    .match(/\d+(?:,\d+)?/g)
    ?.map((part) => Number(part.replace(",", ""))) ?? [];

  if (numbers.length >= 2) {
    return Math.round((numbers[0] + numbers[1]) / 2) * 1000;
  }

  if (numbers.length === 1) {
    return numbers[0] * 1000;
  }

  return 0;
}

function probabilityFrom({
  probability,
  finalVerdict,
  qualification,
  budget,
  notes,
}: {
  probability: string;
  finalVerdict: string;
  qualification: string;
  budget: string;
  notes: string;
}) {
  const explicit = probability.match(/\d+/)?.[0];
  if (explicit) return Number(explicit);

  const text = `${finalVerdict} ${qualification} ${notes}`.toLowerCase();
  let score = 35;

  if (text.includes("not fit")) score = 8;
  else if (text.includes("fit")) score = 68;
  else if (text.includes("review")) score = 42;
  else if (text.includes("qualified")) score = 55;

  if (budget.includes("100") || budget.includes("300")) score += 8;
  if (budget.toLowerCase().includes("less than")) score -= 18;

  return Math.max(1, Math.min(95, score));
}

function daysSince(dateValue: string) {
  if (!dateValue) return -1;

  const parsed = Date.parse(dateValue);
  if (Number.isNaN(parsed)) return -1;

  const diff = Date.now() - parsed;
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function healthFor({
  finalVerdict,
  qualification,
  lastActivityDays,
  probability,
}: {
  finalVerdict: string;
  qualification: string;
  lastActivityDays: number;
  probability: number;
}) {
  const text = `${finalVerdict} ${qualification}`.toLowerCase();

  if (text.includes("not fit") || probability < 20 || lastActivityDays >= 21) {
    return "Red";
  }

  if (text.includes("review") || probability < 50 || lastActivityDays >= 7) {
    return "Yellow";
  }

  return "Green";
}

export async function changeDealColumns({
  boardId,
  itemId,
  columnValues,
}: {
  boardId: string;
  itemId: string;
  columnValues: Record<string, unknown>;
}) {
  return mondayRequest({
    query: `
      mutation ChangeDeal($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          board_id: $boardId,
          item_id: $itemId,
          column_values: $columnValues
        ) {
          id
        }
      }
    `,
    variables: {
      boardId,
      itemId,
      columnValues: JSON.stringify(columnValues),
    },
  });
}

export async function createDealUpdate({
  itemId,
  body,
}: {
  itemId: string;
  body: string;
}) {
  return mondayRequest({
    query: `
      mutation CreateDealUpdate($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
          id
        }
      }
    `,
    variables: { itemId, body },
  });
}
