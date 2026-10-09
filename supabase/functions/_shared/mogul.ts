// Mogul Connect API client (server-side only — uses the client secret).
// Docs: "Mogul Connect Technical Overview" + "Mogul Connect SDK Installation".
// Spec: https://api.usemogul.dev/v3/api-docs/connect

const env = (k: string, d?: string) => {
  const v = Deno.env.get(k) ?? d;
  if (v === undefined) throw new Error(`Missing env var ${k}`);
  return v;
};

const BASE = () => env("MOGUL_API_BASE", "https://api.usemogul.com/connect/v1").replace(/\/$/, "");
const AUTH = () => "Basic " + btoa(`${env("MOGUL_CLIENT_ID")}:${env("MOGUL_CLIENT_SECRET")}`);

export class MogulError extends Error {
  constructor(public status: number, public body: string, path: string) {
    super(`Mogul API ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE() + path, {
    method,
    headers: { Authorization: AUTH(), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new MogulError(res.status, text, path);
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

// deno-lint-ignore no-explicit-any
const pick = (o: any, ...keys: string[]) => keys.map((k) => o?.[k]).find((v) => v !== undefined && v !== null);

/** POST /sessions — provisions (or looks up) the end user and mints a session token. */
export async function createSession(userId: string, name: string): Promise<{ token: string; accountId: string | null; expiresAt: string | null }> {
  // deno-lint-ignore no-explicit-any
  const r: any = await call("POST", "/sessions", { userId, name });
  if (!r?.token) throw new Error("POST /sessions returned no token");
  return { token: String(r.token), accountId: r.accountId ?? null, expiresAt: r.expiresAt ?? null };
}

export interface MogulReportRef { id: number; sourceId: number; cadence?: string; period?: string; originalFileName?: string }
export interface MogulSource {
  id: number;
  target: string;
  syncStatus: string | null;
  lastSync: string | null;
  accounts?: Array<{ id: string; name: string }>;
  availableReports: MogulReportRef[];
}

/** GET /sources/:id */
export async function getSource(sourceId: number): Promise<MogulSource> {
  // deno-lint-ignore no-explicit-any
  const r: any = await call("GET", `/sources/${sourceId}`);
  const s = r?.source ?? r;
  return { ...s, availableReports: s?.availableReports ?? s?.reports ?? [] };
}

/** GET /sources/reports/:id → presigned S3 URL → file text. */
export async function downloadReport(reportId: number): Promise<string> {
  const res = await fetch(`${BASE()}/sources/reports/${reportId}`, { headers: { Authorization: AUTH() } });
  if (!res.ok) throw new MogulError(res.status, await res.text(), `/sources/reports/${reportId}`);
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  let url: string | undefined;
  if (type.includes("json")) {
    const j = JSON.parse(body);
    url = j?.url;
  } else if (/^https?:\/\//.test(body.trim())) {
    url = body.trim();
  } else {
    return body; // API followed the redirect and handed us the file
  }
  if (!url) throw new Error(`No presigned URL for report ${reportId}`);
  const file = await fetch(url);
  if (!file.ok) throw new Error(`S3 download failed for report ${reportId}: ${file.status}`);
  return await file.text();
}
