const MONDAY_API_URL = "https://api.monday.com/v2";

export type SalesDeal = {
  id: string;
  boardId?: string;
  boardName?: string;
  account: string;
  group?: string;
  owner: string;
  stage: string;
  qualification: string;
  initialOutreach: string;
  callStage: string;
  nextStepsStatus: string;
  finalVerdict: string;
  firstMeetingDate: string;
  latestMeetingDate: string;
  lastFollowUpDate: string;
  value: number;
  closeDate: string;
  health: "Green" | "Yellow" | "Red";
  nextStep: string;
  lastActivityDays: number;
  probability: number;
  budget: string;
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  jobTitle: string;
  website: string;
  phone: string;
  lookingFor: string;
  agentNotes: string;
  status: string;
  followUp: string;
  salesCallNotes: string;
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
      "API-Version": "2026-04",
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
      calculatedColumns: Array<{ id: string; title: string; type: string; settings_str?: string }>;
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
          calculatedColumns: columns(capabilities: [CALCULATED]) {
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
              column_values(capabilities: [CALCULATED]) {
                id
                text
                value
                type
                ... on BatteryValue {
                  battery_value {
                    key
                    count
                  }
                }
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

  if (board) {
    board.columns = mergeColumns(board.columns, board.calculatedColumns);
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
              column_values(capabilities: [CALCULATED]) {
                id
                text
                value
                type
                ... on BatteryValue {
                  battery_value {
                    key
                    count
                  }
                }
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

function mergeColumns(
  columns: Array<{ id: string; title: string; type: string; settings_str?: string }>,
  calculatedColumns: Array<{ id: string; title: string; type: string; settings_str?: string }>,
) {
  return [...columns, ...calculatedColumns].filter(
    (column, index, allColumns) =>
      allColumns.findIndex((candidate) => candidate.id === column.id) === index,
  );
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
    battery_value?: Array<{ key: string; count: number }> | null;
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
  salesCallNotes: "text_mm57vcg1",
  added: "date_mm4tf2tz",
};

function normalizeDeals(board: {
  id: string;
  name?: string;
  columns: Array<{ id: string; title: string; type: string; settings_str?: string }>;
  items_page: { items: MondayItem[] };
}) {
  const columnLabels = new Map(
    board.columns.map((column) => [column.id, parseStatusLabels(column.settings_str)]),
  );
  const columnIdsByTitle = new Map(
    board.columns.map((column) => [normalizeColumnTitle(column.title), column.id]),
  );

  return board.items_page.items.map((item) => {
    const valueFor = (columnId: string) => {
      const column = item.column_values.find((value) => value.id === columnId);
      if (!column) return "";

      const text = column.text?.trim();
      if (text) return text;

      const labels = columnLabels.get(columnId) || {};
      if (column.battery_value?.length) {
        return column.battery_value
          .map((value) => labels[String(value.key)] || value.key)
          .filter(Boolean)
          .join(", ");
      }

      if (column.value) {
        try {
          const parsed = JSON.parse(column.value) as { index?: string | number };
          if (parsed.index !== undefined) return labels[String(parsed.index)] || "";
        } catch {}
      }

      return "";
    };
    const valueForTitle = (...titles: string[]) =>
      firstPresent(titles.map((title) => valueFor(columnIdsByTitle.get(normalizeColumnTitle(title)) || ""))) ||
      "";

    const notes = valueFor(columns.notes);
    const inferredVerdict = verdictFromNotes(notes);
    const qualification =
      firstPresent([
        valueFor(columns.qualification),
        valueForTitle("Nas.com Qualified", "Qualification"),
      ]) || "";
    const initialOutreach =
      firstPresent([
        valueFor(columns.outreach),
        valueForTitle("Initial Outreach", "How Heard", "Source"),
      ]) || "";
    const callStage =
      firstPresent([
        valueFor(columns.callStage),
        valueForTitle("Call Stage", "After Dinner Status", "Attendance"),
      ]) || "";
    const nextStepsStatus =
      firstPresent([valueFor(columns.nextStepsStatus), valueForTitle("Next Steps")]) || "";
    const finalVerdict =
      firstPresent([valueFor(columns.finalVerdict), valueForTitle("Final Verdict")]) || "";
    const firstMeetingDate =
      firstPresent([valueFor(columns.firstMeeting), valueForTitle("1st Meeting Date", "Event Date")]) ||
      "";
    const latestMeetingDate =
      firstPresent([valueFor(columns.latestMeeting), valueForTitle("Latest Meeting Date")]) || "";
    const lastFollowUpDate =
      firstPresent([valueFor(columns.lastFollowUpDate), valueForTitle("Last follow up")]) || "";
    const owner =
      firstPresent([valueFor(columns.owner), valueForTitle("Assigned To", "Owner")]) || "Unassigned";
    const firstName = firstPresent([valueFor(columns.firstName), valueForTitle("First Name")]) || "";
    const lastName = firstPresent([valueFor(columns.lastName), valueForTitle("Last Name")]) || "";
    const website = firstPresent([valueFor(columns.website), valueForTitle("Website")]) || "";
    const phone = firstPresent([valueFor(columns.phone), valueForTitle("Phone")]) || "";
    const lookingFor =
      firstPresent([valueFor(columns.lookingFor), valueForTitle("AI Concern", "Looking For")]) || "";
    const cmoNotes = valueForTitle("Lead Notes / Intel");
    const status = firstPresent([valueFor(columns.status), valueForTitle("Status")]) || "";
    const followUp = firstPresent([valueFor(columns.followUp), valueForTitle("Hand Off")]) || "";
    const salesCallNotes =
      firstPresent([valueFor(columns.salesCallNotes), cmoNotes, valueForTitle("Sales Call Notes")]) ||
      "";
    const stage =
      firstPresent([
        finalVerdict,
        inferredVerdict,
        nextStepsStatus,
        callStage,
        initialOutreach,
        qualification,
        valueFor(columns.source),
        item.group?.title,
      ]) || "Unstaged";

    const lastActivityDate =
      firstPresent([
        lastFollowUpDate,
        latestMeetingDate,
        firstMeetingDate,
        valueFor(columns.added),
      ]) || "";

    const budget = firstPresent([valueFor(columns.budget), valueForTitle("Budget")]) || "";
    const probability = probabilityFrom({
      probability: firstPresent([
        valueFor(columns.probability),
        valueForTitle("Probability of Closing"),
      ]) || "",
      finalVerdict,
      qualification,
      budget,
      notes: firstPresent([notes, cmoNotes]) || "",
    });
    const lastActivityDays = daysSince(lastActivityDate);

    return {
      id: item.id,
      boardId: board.id,
      boardName: board.name,
      account: item.name,
      group: item.group?.title || "Unknown",
      owner,
      stage,
      qualification,
      initialOutreach,
      callStage,
      nextStepsStatus,
      finalVerdict,
      firstMeetingDate,
      latestMeetingDate,
      lastFollowUpDate,
      value: estimatedBudgetValue(budget),
      closeDate:
        firstPresent([
          latestMeetingDate,
          firstMeetingDate,
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
      firstName,
      lastName,
      country: valueFor(columns.country),
      jobTitle: valueFor(columns.jobTitle),
      website,
      phone,
      lookingFor,
      agentNotes: firstPresent([notes, cmoNotes]) || "",
      status,
      followUp,
      salesCallNotes,
      source:
        firstPresent([
          valueFor(columns.source),
          valueForTitle("Inbound / Outbound", "Source"),
          item.group?.title,
        ]) || "Unknown",
      mondayUrl: `https://nas-io.monday.com/boards/${board.id}/pulses/${item.id}`,
    } satisfies SalesDeal;
  });
}

function parseStatusLabels(settings?: string) {
  try {
    return (JSON.parse(settings || "{}").labels || {}) as Record<string, string>;
  } catch {
    return {};
  }
}

function normalizeColumnTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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
