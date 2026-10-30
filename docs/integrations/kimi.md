# Kimi provider

The API reads `KIMI_API_KEY` from its server environment. In Railway, set it on the GSW API service. Do not add it to a Vite/frontend variable.

Defaults:

- `KIMI_BASE_URL=https://api.moonshot.ai/v1`
- `KIMI_MODEL=kimi-k3.1-pro`

Select **Settings → AI → AI model → Kimi** in the mailbox and save. Backend settings validation rejects Kimi if its server key is absent. The saved choice is used by chat, background AI workflows and the mailbox API `POST /integrations/v1/ai/chat`. It does not replace separate image/video/transcription providers. Setting `AI_PROVIDER=kimi` alone does not override existing saved mailbox model choices.

The adapter uses the documented Chat Completions contract with `reasoning_effort=low`, no unsupported sampling settings and `max_completion_tokens=16384`. Tool continuations retain `reasoning_content` in memory so the next Kimi request can continue correctly. That field is not shown as assistant text or returned by the mailbox AI endpoint. Invalid tool JSON, truncated responses, provider failures and timeouts return safe errors rather than executing partial actions or echoing provider secrets.

Official references checked during implementation:

- https://platform.kimi.ai/docs/models.md
- https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart.md

Tests mock the provider and verify routing, credential headers, tool/reasoning continuation and error handling. A real inference call with the deployed Railway credential remains a separate acceptance check.
