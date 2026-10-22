import { verifyUnsubscribe } from "@/lib/unsubscribe";
import { database } from "@/lib/database";
export async function POST(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) throw Error("Missing token");
    const { w, a } = verifyUnsubscribe(token);
    const db = database();
    await db.begin(async (tx) => {
      await tx`select id from workspaces where id=${w} for update`;
      await tx`insert into suppressions(workspace_id,address,reason) values(${w},${a},'opt_out') on conflict(workspace_id,address) do nothing`;
      await tx`update leads set data=data||'{"stopped":true,"email_permission":"denied"}'::jsonb where workspace_id=${w} and lower(data->>'email')=${a}`;
      await tx`update jobs set status='cancelled',last_error='opt_out' where workspace_id=${w} and (lower(payload#>>'{recipient,to}')=${a} or payload->>'lead_id' in (select id::text from leads where workspace_id=${w} and lower(data->>'email')=${a})) and status='queued'`;
      await tx`insert into audit_log(workspace_id,event) values(${w},'contact.opt_out')`;
    });
    return new Response(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed</title><body style="font-family:Arial;padding:60px;line-height:1.7"><h1>You’re unsubscribed.</h1><p>You will receive no further outreach from this workspace.</p></body></html>',
      {
        headers: {
          "Content-Type": "text/html;charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "The unsubscribe link is invalid or temporarily unavailable. Please retry or contact the sender.",
      },
      { status: 400 },
    );
  }
}
