# mice-ai-
## End-to-end UI scenario (workflow steps 0–5)

`e2e/steps0-5.mjs` drives the real UI in headless Chromium (Playwright) against **already running** servers:

```bash
bash scripts/db-start.sh && npm run migrate -w apps/api && npm run seed -w apps/api -- --reset
AI_PROVIDER=mock npm start -w apps/api        # :3001
(cd apps/web && npx vite)                      # :5173, proxies /api → :3001
node e2e/steps0-5.mjs                          # BASE_URL=…, SHOTS=<dir> (default e2e/shots), HEADED=1
```

Flow: clerk intake → admin mobile inbox (assignment) → items / shortlist / 3 RFQs → admin `rfq_send` → supplier links
(`POST /api/rfqs/:id/link`) → 3 suppliers answer on `/s/rfq/<token>` → pasted supplier e-mail parsed + verified →
comparison + negotiation draft → 2-option quote (forced margin block, then fixed) → admin approval → send → customer
accepts on `/q/<token>` (PO) → contract from template → compare → condition-risk + contract approval (dev biometric) →
sign → locked + finance entries → empty inbox ("Her şey yolunda") → seeded projects, field panel, weekly report render.
Every run creates a fresh project, so it can be rerun on the same database. Exit code 1 + `PROBLEMS` list on any
unexpected API 5xx/404, page error or failed assertion; screenshots (deviceScaleFactor 1) land in `SHOTS`.
