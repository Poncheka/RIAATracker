// POST { visitorId, sourceId, accountId, connectedIdentity } → { resultsToken }
// Called from the SDK's onSuccess. Registers the source and kicks off ingestion.
import { getSource } from "../_shared/mogul.ts";
import { background, cors, db, ingestSource, json } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { visitorId, sourceId, accountId, connectedIdentity } = await req.json();
    if (!Number.isInteger(sourceId)) return json({ error: "sourceId required" }, 400);

    const sb = db();
    const { data: v } = await sb.from("visitors").select("id, mogul_user_id").eq("external_id", visitorId).maybeSingle();
    if (!v?.mogul_user_id) return json({ error: "Unknown visitor" }, 404);

    // Confirms the source exists under our partner credentials before we store it.
    // TODO: once the API exposes the owning user on GET /sources/:id, also check it matches v.mogul_user_id.
    const src = await getSource(sourceId);

    const { data: existing } = await sb.from("sources").select("visitor_id, results_token").eq("id", sourceId).maybeSingle();
    if (existing && existing.visitor_id !== v.id) return json({ error: "Source belongs to another visitor" }, 403);

    const { data: row, error } = await sb.from("sources").upsert({
      id: sourceId, visitor_id: v.id, mogul_account_id: accountId ?? null,
      target: src.target ?? "DISTROKID", identity: connectedIdentity ?? null, sync_status: src.syncStatus,
    }, { onConflict: "id" }).select("results_token").single();
    if (error) throw error;

    background(ingestSource(sourceId));
    return json({ resultsToken: row.results_token });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not register the connection" }, 502);
  }
});
