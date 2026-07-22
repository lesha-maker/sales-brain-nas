import { NextRequest, NextResponse } from "next/server";
import {
  getLarkDocumentMarkdown,
  getLarkDocumentRawContent,
  getLarkWikiNode,
  testLarkDocumentEditAccess,
} from "../../../lib/lark";

type TemplateTestRequest = {
  token?: string;
  url?: string;
  testEdit?: boolean;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as TemplateTestRequest;
  const token = body.token || tokenFromUrl(body.url || "");

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Send a wiki/doc token or Lark wiki URL." },
      { status: 400 },
    );
  }

  const result: Record<string, unknown> = {
    ok: false,
    inputToken: token,
  };

  try {
    const node = await getLarkWikiNode(token);
    result.wikiNode = node;

    const docType = node.objType === "docx" ? "docx" : node.objType;
    const markdown = await getLarkDocumentMarkdown({
      docToken: node.objToken,
      docType,
    });

    result.ok = true;
    result.readMethod = "wiki -> docs markdown";
    result.markdownPreview = markdown.slice(0, 4000);
    result.markdownLength = markdown.length;

    if (body.testEdit) {
      result.editTest = await testLarkDocumentEditAccess(node.objToken);
    }

    return NextResponse.json(result);
  } catch (wikiError) {
    result.wikiError = errorMessage(wikiError);
  }

  try {
    const markdown = await getLarkDocumentMarkdown({
      docToken: token,
      docType: "docx",
    });

    result.ok = true;
    result.readMethod = "direct docs markdown";
    result.markdownPreview = markdown.slice(0, 4000);
    result.markdownLength = markdown.length;

    return NextResponse.json(result);
  } catch (markdownError) {
    result.markdownError = errorMessage(markdownError);
  }

  try {
    const rawContent = await getLarkDocumentRawContent(token);

    result.ok = true;
    result.readMethod = "direct docx raw_content";
    result.rawPreview = rawContent.slice(0, 4000);
    result.rawLength = rawContent.length;

    return NextResponse.json(result);
  } catch (rawError) {
    result.rawError = errorMessage(rawError);
  }

  return NextResponse.json(result, { status: 502 });
}

function tokenFromUrl(url: string) {
  const match = url.match(/\/(?:wiki|docx)\/([^/?#]+)/);
  return match?.[1] || "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
