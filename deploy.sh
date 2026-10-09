#!/usr/bin/env bash
# One-shot deploy of the Gold Tracker backend to Supabase.
# Run from this folder:  ./deploy.sh
# Needs: Node 18+ (for npx) and curl. Docker is NOT needed.
set -euo pipefail
cd "$(dirname "$0")"

REF="ofbljjhdxowzcqwnudje"
CLIENT_ID="mcci_Ev-ROh5IYIrPUMrUB2r7sWcf"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  read -rsp "Supabase access token (sbp_…): " SUPABASE_ACCESS_TOKEN; echo
fi
read -rsp "Mogul client secret (mccs_…): " MOGUL_CLIENT_SECRET; echo
read -rp  "Mogul webhook secret (whsec_…, press Enter to skip for now): " MOGUL_WEBHOOK_SECRET
export SUPABASE_ACCESS_TOKEN
SB="npx -y supabase@latest"

echo "→ Creating tables"
BODY=$(node -e 'const fs=require("fs");const sql=fs.readdirSync("supabase/migrations").sort().map(f=>fs.readFileSync("supabase/migrations/"+f,"utf8")).join("\n");process.stdout.write(JSON.stringify({query:sql}))')
curl -fsS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d "$BODY" >/dev/null
echo "  done"

echo "→ Setting function secrets"
SECRETS=(MOGUL_CLIENT_ID="$CLIENT_ID" MOGUL_CLIENT_SECRET="$MOGUL_CLIENT_SECRET" MOGUL_API_BASE="https://api.usemogul.com/connect/v1" MOGUL_USER_ID_FIELD="externalId")
[ -n "$MOGUL_WEBHOOK_SECRET" ] && SECRETS+=(MOGUL_WEBHOOK_SECRET="$MOGUL_WEBHOOK_SECRET")
$SB secrets set --project-ref "$REF" "${SECRETS[@]}" >/dev/null
echo "  done"

echo "→ Deploying functions"
$SB functions deploy session-token source-connected results mogul-webhook --project-ref "$REF" --no-verify-jwt --use-api

echo "→ Smoke test: minting a Mogul Connect session token"
RES=$(curl -sS -X POST "https://$REF.supabase.co/functions/v1/session-token" -H "Content-Type: application/json" \
  -d "{\"visitorId\":\"deploy-check-$(date +%s)000000\"}")
if echo "$RES" | grep -q '"token"'; then echo "  ✓ Mogul Connect is reachable and returned a session token"
else echo "  ✗ $RES"; echo "  Paste the output of: $SB functions logs session-token --project-ref $REF   (or the Logs tab in the dashboard) back to Claude."; fi

echo
echo "Backend is live at https://$REF.supabase.co/functions/v1/"
echo "Webhook URL for the Mogul partner dashboard: https://$REF.supabase.co/functions/v1/mogul-webhook"
echo "When you're finished, revoke the access token at https://supabase.com/dashboard/account/tokens"
