// Mogul → us. Svix-signed. Handles source.created / source.updated / source.deleted.
import { Webhook } from "npm:svix@1.37.0";
import { background, db, ingestSource } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  const payload = await req.text();
  let evt: { type?: string; event?: string; data?: Record<string, unknown> } & Record<string, unknown>;
  try {
    evt = new Webhook(Deno.env.get("MOGUL_WEBHOOK_SECRET")!).verify(payload, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as typeof evt;
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const type = String(evt.type ?? evt.event ?? "");
  const data = (evt.data ?? evt) as { id?: number };
  const sourceId = Number(data.id);
  if (!sourceId) return new Response("ok");

  const sb = db();
  const { data: known } = await sb.from("sources").select("id").eq("id", sourceId).maybeSingle();

  if (type === "source.deleted") {
    if (known) await sb.from("sources").delete().eq("id", sourceId);
  } else if (known) {
    // source.created arrives before the browser posts onSuccess; source-connected handles that case.
    background(ingestSource(sourceId));
  }
  return new Response("ok");
});
