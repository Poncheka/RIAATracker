// Mogul → us. Svix-signed. Handles source.created / source.updated / source.deleted.
// Accepts both header styles Svix can send (svix-* and webhook-*), and logs
// every delivery attempt to public.webhook_events for debugging.
import { Webhook } from "npm:svix@1.37.0";
import { background, db, ingestSource } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  const payload = await req.text();
  const h = (k: string) => req.headers.get(`svix-${k}`) ?? req.headers.get(`webhook-${k}`) ?? "";
  const sb = db();
  const log = (row: Record<string, unknown>) =>
    sb.from("webhook_events").insert({
      msg_id: h("id") || null,
      headers: Object.fromEntries([...req.headers].filter(([k]) => /^(svix|webhook)-|user-agent|content-type/.test(k) && !k.endsWith("signature"))),
      body: payload.slice(0, 4000),
      ...row,
    });

  // deno-lint-ignore no-explicit-any
  let evt: any;
  try {
    evt = new Webhook(Deno.env.get("MOGUL_WEBHOOK_SECRET") ?? "").verify(payload, {
      "svix-id": h("id"), "svix-timestamp": h("timestamp"), "svix-signature": h("signature"),
    });
  } catch (e) {
    await log({ outcome: "bad_signature", detail: String(e).slice(0, 300) });
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const type = String(evt.type ?? evt.event ?? evt.eventType ?? "");
    const data = evt.data ?? evt.payload ?? evt;
    const sourceId = Number(data?.id ?? data?.sourceId);
    if (!sourceId) { await log({ outcome: "error", event_type: type, detail: "no source id in payload" }); return new Response("ok"); }

    const { data: known } = await sb.from("sources").select("id").eq("id", sourceId).maybeSingle();
    if (!known) { await log({ outcome: "unknown_source", event_type: type, source_id: sourceId }); return new Response("ok"); }

    if (type === "source.deleted") await sb.from("sources").delete().eq("id", sourceId);
    else background(ingestSource(sourceId));
    await log({ outcome: "ok", event_type: type, source_id: sourceId });
    return new Response("ok");
  } catch (e) {
    await log({ outcome: "error", detail: String(e).slice(0, 300) });
    return new Response("error", { status: 500 });
  }
});
