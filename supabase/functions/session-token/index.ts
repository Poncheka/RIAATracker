// POST { visitorId } → { token }
// Called by the Mogul Connect SDK's getToken() on ready and on every refresh.
import { createSession } from "../_shared/mogul.ts";
import { background, cors, db, json } from "../_shared/ingest.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { visitorId } = await req.json();
    if (typeof visitorId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(visitorId)) return json({ error: "visitorId required" }, 400);

    const { token, accountId, expiresAt } = await createSession(visitorId, "Gold Tracker visitor");
    // Record the visitor after responding so the embed isn't kept waiting on our database.
    background(Promise.resolve(db().from("visitors").upsert({ external_id: visitorId, mogul_user_id: accountId ?? visitorId }, { onConflict: "external_id" })));
    return json({ token, expiresAt });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not start a Mogul Connect session", detail: String(e).slice(0, 400) }, 502);
  }
});
