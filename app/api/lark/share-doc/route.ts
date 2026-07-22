import { NextRequest, NextResponse } from "next/server";
import { grantLarkDocumentPermission } from "../../../lib/lark";

type ShareDocRequest = {
  token?: string;
  url?: string;
  fileType?: string;
  memberType?: "email" | "openid" | "userid" | "openchat";
  memberId?: string;
  permission?: "view" | "edit" | "full_access";
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ShareDocRequest;
  const token = body.token || tokenFromUrl(body.url || "");

  if (!token || !body.memberType || !body.memberId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Send token/url, memberType, and memberId.",
      },
      { status: 400 },
    );
  }

  try {
    const member = await grantLarkDocumentPermission({
      token,
      fileType: body.fileType || "docx",
      memberType: body.memberType,
      memberId: body.memberId,
      permission: body.permission || "edit",
    });

    return NextResponse.json({
      ok: true,
      token,
      fileType: body.fileType || "docx",
      member,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

function tokenFromUrl(url: string) {
  const match = url.match(/\/(?:docx|wiki)\/([^/?#]+)/);
  return match?.[1] || "";
}
