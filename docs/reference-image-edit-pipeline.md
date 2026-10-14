# Reference-image editing pipeline (initial backend slice)

## Current implementation

`POST /product/chat/images/edit` accepts `{assetId, instruction, conversationId?}` under authenticated GSW Mail user context. Railway validates ownership and ready image state, fetches the **original bytes** from R2, forwards them to the dedicated Modal editing endpoint, validates the returned image, and saves a new GSW Files asset. The response includes both `sourceAssetId` and `assetId`.

## Required Modal contract (not deployed by this PR)

Configure `MODAL_IMAGE_EDIT_URL` to an HTTPS endpoint and `MODAL_PROXY_TOKEN` through the existing config. The endpoint must accept a JSON POST with Bearer authentication:

```json
{
  "model": "image-edit",
  "prompt": "Make the existing text purple and background black",
  "image": { "mime_type": "image/png", "b64_json": "<base64 original image>" },
  "response_format": "b64_json"
}
```

It must return `{ "data": [{ "b64_json": "<base64 edited image>" }] }`. The worker must use a **reference-image capable editing model**, not text-to-image Qwen-Image generation. Do not point the setting at the current `/v1/images/generations` endpoint.

## Follow-up work required before release

- Implement and deploy the Modal worker and confirm its actual image-editing model API.
- Add tests for ownership, missing configuration, invalid MIME, bad provider payload, size limits, and successful output persistence.
- Add durable job state and retry/idempotency for slow or cold GPU runs; current endpoint is synchronous and capped at 90 seconds.
- Integrate edit intent routing in chat, preserving the original message attachment and linking output metadata in conversation history.
- Add an attachment edit action to mobile and web and verify preview/save/share on a real device.
- Record durable source-to-output lineage (not just the immediate response) and instrument edit success/failure.

This PR is a **backend foundation**, not a completed end-to-end image editing workflow.
