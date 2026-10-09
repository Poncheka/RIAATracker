// POST { visitorId } → { token }
// Called by the Mogul Connect SDK's getToken() on ready and on every refresh.
import { createSession } from "../_shared/mogul.ts";
import { cors, db, json } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { visitorId } = await req.json();
    if (typeof visitorId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(visitorId)) return json({ error: "visitorId required" }, 400);

    const sb = db();
    const { token, accountId } = await createSession(visitorId, "Gold Tracker visitor");
    // mogul_user_id holds the Mogul account id the session belongs to
    const { error } = await sb.from("visitors").upsert({ external_id: visitorId, mogul_user_id: accountId ?? visitorId }, { onConflict: "external_id" });
    if (error) throw error;
    return json({ token });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not start a Mogul Connect session", detail: String(e).slice(0, 400) }, 502);
  }
});
