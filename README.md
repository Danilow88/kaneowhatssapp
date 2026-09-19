# WhatsApp ↔ Kaneo Ticketing Bridge

🇧🇷 [Ler em português](README.pt-BR.md)

Turns WhatsApp into a support ticketing channel — no app, no portal. Customers open and follow up on tickets by chatting on WhatsApp; agents work the queue in [Kaneo](https://github.com/usekaneo/kaneo), an open-source, self-hosted Jira/Linear alternative. The only custom code is a small **bridge** service that translates between the two systems.

## How it works

1. A customer messages the WhatsApp number and is guided through a short conversational flow: name → email → customer type (internal/external) → category → description → confirmation.
2. On confirmation, the bridge creates a task in Kaneo (`POST /task/{projectId}`) with the customer's phone number, name, email, and customer type attached as custom fields.
3. The customer gets the Kaneo task number back as their ticket protocol.
4. An agent works the ticket entirely inside Kaneo's own UI. Commenting on the task relays the message back to the customer on WhatsApp in real time (via Kaneo's Generic Webhook integration).
5. If the customer replies again, the message is appended as a comment on the same open ticket, and the ticket is moved out of "waiting on customer" back into "in progress" automatically.
6. Customers can also check status any time by sending `status <ticket number>`.

## Architecture

```
WhatsApp  <---->  bridge (Fastify)  <---->  Kaneo (REST API + Generic Webhook)
                        |
                    Postgres (Prisma)
```

Kaneo is run unmodified from its official image — the bridge only ever talks to its public REST API and subscribes to its outbound webhook feed. This is a deliberate constraint: no forking, no patches, so upstream `kaneo:latest` can be pulled indefinitely without a merge-maintenance burden. Everything the bridge needs that Kaneo doesn't model natively (which phone number owns which task, and the state of an in-progress conversation) lives in the bridge's own Postgres database.

### Why a ticket is just a Kaneo task

There's no separate `Ticket` model. A ticket **is** a Kaneo task in a dedicated project:

- Custom fields (created once via `npm run setup:kaneo`): `Telefone`, `Tipo de Cliente` (dropdown), `Nome`, `Email`.
- Kaneo's four default board columns are used as-is by slug — `to-do`, `in-progress`, `in-review`, `done` — only their display labels need renaming in the Kaneo UI (e.g. "New", "In progress", "Waiting on customer", "Resolved").
- Customer replies become comments prefixed with `📱 Cliente via WhatsApp: `. The bridge filters on that prefix (not on actor ID) when relaying Kaneo comments back to WhatsApp, so an agent's own reply is never echoed back to itself — and it works regardless of how many agents share the workspace, no dedicated bot account required.

## Tech stack

- **Bridge**: Node.js (`--experimental-strip-types`, no build step needed in dev) + TypeScript + [Fastify](https://fastify.dev/)
- **Persistence**: PostgreSQL via [Prisma](https://www.prisma.io/) — only `ConversationState` and `TicketLink`
- **WhatsApp**: [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api) (default), or [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) as a swappable provider for local testing
- **Tickets**: [Kaneo](https://github.com/usekaneo/kaneo) (`ghcr.io/usekaneo/kaneo:latest`, unmodified)
- **Orchestration**: Docker Compose (4 services, isolated Postgres per app)

## Project structure

```
whatsapp-ticketing/
├── docker-compose.yml         # kaneo, kaneo-db, bridge, bridge-db
├── .env.example                # vars consumed by docker-compose.yml itself
└── bridge/
    ├── src/
    │   ├── config.ts            # typed/validated env vars (zod)
    │   ├── kaneo-client.ts      # Kaneo REST client (task, comment, status)
    │   ├── whatsapp-client.ts   # outbound send + inbound signature verification
    │   ├── conversation/
    │   │   ├── state-store.ts   # Prisma access for ConversationState / TicketLink
    │   │   └── flow.ts          # the conversation state machine
    │   ├── routes/
    │   │   ├── whatsapp-inbound.ts         # Meta Cloud API webhook
    │   │   ├── whatsapp-inbound-twilio.ts  # Twilio Sandbox webhook
    │   │   └── kaneo-webhook.ts            # Kaneo Generic Webhook receiver
    │   └── main.ts
    ├── scripts/setup-kaneo.ts   # one-off script to create the 4 custom fields
    ├── prisma/schema.prisma
    └── .env.example             # vars consumed by the bridge process itself
```

## Getting started

### Prerequisites

- Docker + Docker Compose
- Node.js 22+ (only needed if you want to run the bridge outside Docker for hot-reload development)
- A tunnel tool (e.g. [ngrok](https://ngrok.com/)) to expose your local machine for the two inbound webhooks (WhatsApp → bridge, Kaneo → bridge) during development

### 1. Configure and start Kaneo

```bash
cp .env.example .env
# fill in KANEO_POSTGRES_PASSWORD, KANEO_AUTH_SECRET (openssl rand -hex 32),
# BRIDGE_POSTGRES_PASSWORD, and BRIDGE_DATABASE_URL (assembled from the
# BRIDGE_POSTGRES_* values above, host bridge-db, port 5432)

docker compose up -d kaneo kaneo-db
```

Open `http://localhost:5173`, create the first user (becomes admin automatically), create a workspace and a project.

### 2. Create the Kaneo custom fields and get an API key

Generate an API key for your user from the Kaneo UI, then:

```bash
cd bridge
cp .env.example .env
# fill in KANEO_API_URL, KANEO_API_KEY, KANEO_PROJECT_ID in bridge/.env

npm install
npm run setup:kaneo
# copy the 4 printed KANEO_FIELD_*_ID lines into bridge/.env
```

### 3. Configure WhatsApp

Pick one in `bridge/.env` via `WHATSAPP_PROVIDER`:

- **`meta`** (default, production target): fill in `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` from a Meta for Developers app. Point the app's webhook at `https://<your-tunnel>/webhooks/whatsapp/inbound`, subscribe to the `messages` field, and add your test number to the allowed recipients list.
- **`twilio`** (temporary alternative, e.g. while Meta business verification is pending): fill in `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `PUBLIC_WEBHOOK_BASE_URL`. Point the Twilio Sandbox webhook at `https://<your-tunnel>/webhooks/whatsapp/twilio-inbound`.

### 4. Run the bridge

Either fully dockerized:

```bash
docker compose up -d --build bridge bridge-db
```

...or locally with hot reload against the dockerized Kaneo/Postgres (`bridge/.env`'s `DATABASE_URL` already points at `localhost:5433`, the published port of `bridge-db`):

```bash
cd bridge
docker compose up -d bridge-db   # from the repo root, in another terminal
npm run prisma:migrate
npm run dev
```

### 5. Wire up Kaneo's outbound webhook

In the Kaneo UI: **Settings → Projects → Integrations → Generic Webhook**. Set the URL to `https://<your-tunnel>/webhooks/kaneo`, set a secret (must match `KANEO_WEBHOOK_SECRET` in `bridge/.env`), and enable at least `task.comment_created` (required for replies to reach WhatsApp) and `task.status_changed` (used for the "ticket resolved" notification).

> Kaneo validates the webhook URL server-side and will reject anything that resolves to a private/non-routable address (SSRF protection) — the URL must be genuinely publicly reachable, which is exactly what the tunnel is for in development.

## Environment variables

**Root `.env`** (consumed by `docker-compose.yml` interpolation):

| Variable | Purpose |
|---|---|
| `KANEO_CLIENT_URL` | Public URL Kaneo reports itself as (defaults to `http://localhost:5173`) |
| `KANEO_POSTGRES_DB` / `_USER` / `_PASSWORD` | Kaneo's own Postgres database |
| `KANEO_AUTH_SECRET` | Kaneo's session signing secret (`openssl rand -hex 32`) |
| `BRIDGE_POSTGRES_DB` / `_USER` / `_PASSWORD` | Bridge's own Postgres database |
| `BRIDGE_DATABASE_URL` | Full connection string handed to the bridge container as `DATABASE_URL` |

**`bridge/.env`** (consumed by the bridge process, via `env_file` when dockerized):

| Variable | Purpose |
|---|---|
| `PORT` | Bridge HTTP port (default `3000`) |
| `DATABASE_URL` | Only used when running the bridge outside Docker |
| `WHATSAPP_PROVIDER` | `meta` or `twilio` |
| `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` | Required when `WHATSAPP_PROVIDER=meta` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `PUBLIC_WEBHOOK_BASE_URL` | Required when `WHATSAPP_PROVIDER=twilio` |
| `KANEO_API_URL`, `KANEO_API_KEY`, `KANEO_PROJECT_ID` | Kaneo REST API access |
| `KANEO_FIELD_PHONE_ID`, `KANEO_FIELD_CUSTOMER_TYPE_ID`, `KANEO_FIELD_NAME_ID`, `KANEO_FIELD_EMAIL_ID` | Custom field IDs printed by `npm run setup:kaneo` |
| `KANEO_WEBHOOK_SECRET` | Must match the secret set on Kaneo's Generic Webhook integration |

## Available scripts (`bridge/`)

| Script | Description |
|---|---|
| `npm run dev` | Run with hot reload (`--watch`), no build step |
| `npm run build` | `prisma generate` + `tsc` |
| `npm start` | Run the compiled output (`dist/main.js`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Apply Prisma migrations |
| `npm run setup:kaneo` | One-off: create the 4 Kaneo custom fields, prints their IDs |

## Endpoints exposed by the bridge

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET`/`POST` | `/webhooks/whatsapp/inbound` | Meta Cloud API — verification handshake / inbound messages (`WHATSAPP_PROVIDER=meta`) |
| `POST` | `/webhooks/whatsapp/twilio-inbound` | Twilio Sandbox inbound messages (`WHATSAPP_PROVIDER=twilio`) |
| `POST` | `/webhooks/kaneo` | Kaneo Generic Webhook receiver |

## Security

- Both webhook directions are signature-verified: inbound WhatsApp payloads check `X-Hub-Signature-256` (Meta) or the Twilio request signature; inbound Kaneo events check `X-Kaneo-Signature`. All comparisons are HMAC-SHA256 with a constant-time equality check.
- Inbound WhatsApp messages are deduplicated by provider message ID before processing, since WhatsApp redelivers a webhook if it doesn't get a fast `200`.
- No secrets are committed: `.env` files are gitignored, and `docker-compose.yml` never assembles a credential-shaped string inline — `DATABASE_URL` is a single opaque variable sourced entirely from the untracked `.env`.

## Known limitations

- No fallback to WhatsApp message templates outside Meta's 24-hour customer-service messaging window — an agent reply outside that window will currently fail to send until the customer messages again.
- No automated test suite yet.
- Ticket category is free text embedded in the task title/description, not a queryable custom field.
