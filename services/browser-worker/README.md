# GSW Browser Worker

Isolated Playwright service used by the GSW Mail agent browser tools.

## Endpoints

- `GET /health`
- `POST /v1/actions`

`/v1/actions` requires:

- `Authorization: Bearer <BROWSER_WORKER_TOKEN>`
- `x-gsw-user-id`
- `x-gsw-account-id`

Supported actions:

- `search`
- `open`
- `read`
- `screenshot`
- `click`
- `type`

The service blocks localhost, private/link-local IP ranges, non-HTTP(S) network navigation, form submissions, and file upload controls.

It is intended to run as a separate Railway service reachable only through Railway private networking.
