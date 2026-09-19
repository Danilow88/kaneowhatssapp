# Ponte WhatsApp ↔ Kaneo para Chamados

🇺🇸 [Read in English](README.md)

Transforma o WhatsApp num canal de abertura de chamados — sem app, sem portal. Clientes abrem e acompanham chamados batendo papo no WhatsApp; atendentes trabalham a fila no [Kaneo](https://github.com/usekaneo/kaneo), uma alternativa open-source e self-hosted ao Jira/Linear. O único código próprio é um pequeno serviço **bridge** que traduz entre os dois sistemas.

## Como funciona

1. O cliente manda mensagem para o número de WhatsApp e é guiado por um fluxo conversacional curto: nome → e-mail → tipo de cliente (interno/externo) → categoria → descrição → confirmação.
2. Ao confirmar, o bridge cria uma task no Kaneo (`POST /task/{projectId}`) com telefone, nome, e-mail e tipo de cliente anexados como custom fields.
3. O cliente recebe o número da task do Kaneo como protocolo do chamado.
4. O atendente trabalha o chamado inteiramente pela própria UI do Kaneo. Comentar na task repassa a mensagem de volta ao cliente no WhatsApp em tempo real (via integração Generic Webhook do Kaneo).
5. Se o cliente responder de novo, a mensagem vira comentário no mesmo chamado aberto, e o chamado sai de "aguardando cliente" e volta para "em atendimento" automaticamente.
6. O cliente também pode consultar o status a qualquer momento enviando `status <número do chamado>`.

## Arquitetura

```
WhatsApp  <---->  bridge (Fastify)  <---->  Kaneo (API REST + Generic Webhook)
                        |
                    Postgres (Prisma)
```

O Kaneo roda sem nenhuma modificação, direto da imagem oficial — o bridge só conversa com sua API REST pública e assina seu feed de webhooks de saída. É uma restrição deliberada: sem fork, sem patch, então dá pra atualizar `kaneo:latest` indefinidamente sem carregar o ônus de manter merges. Tudo que o bridge precisa e o Kaneo não modela nativamente (qual telefone é dono de qual task, e o estado de uma conversa em andamento) vive no Postgres próprio do bridge.

### Por que um chamado é só uma task do Kaneo

Não existe um model `Ticket` separado. Um chamado **é** uma task do Kaneo, num projeto dedicado:

- Custom fields (criados uma vez via `npm run setup:kaneo`): `Telefone`, `Tipo de Cliente` (dropdown), `Nome`, `Email`.
- As quatro colunas padrão do Kaneo são usadas como estão, pelo slug — `to-do`, `in-progress`, `in-review`, `done` — só é preciso renomear o rótulo exibido na UI do Kaneo (ex: "Novo", "Em atendimento", "Aguardando cliente", "Resolvido").
- Respostas do cliente viram comentários prefixados com `📱 Cliente via WhatsApp: `. O bridge filtra por esse prefixo (não pelo ID do autor) ao repassar comentários do Kaneo de volta pro WhatsApp, então a resposta do próprio atendente nunca ecoa de volta pra ele mesmo — e funciona independente de quantos atendentes dividem o workspace, sem precisar de uma conta bot dedicada.

## Stack

- **Bridge**: Node.js (`--experimental-strip-types`, sem etapa de build necessária em dev) + TypeScript + [Fastify](https://fastify.dev/)
- **Persistência**: PostgreSQL via [Prisma](https://www.prisma.io/) — só `ConversationState` e `TicketLink`
- **WhatsApp**: [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api) (padrão), ou [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) como provider alternável para testes locais
- **Chamados**: [Kaneo](https://github.com/usekaneo/kaneo) (`ghcr.io/usekaneo/kaneo:latest`, sem modificações)
- **Orquestração**: Docker Compose (4 serviços, Postgres isolado por aplicação)

## Estrutura do projeto

```
whatsapp-ticketing/
├── docker-compose.yml         # kaneo, kaneo-db, bridge, bridge-db
├── .env.example                # variáveis consumidas pelo próprio docker-compose.yml
└── bridge/
    ├── src/
    │   ├── config.ts            # env vars tipadas/validadas (zod)
    │   ├── kaneo-client.ts      # cliente REST do Kaneo (task, comment, status)
    │   ├── whatsapp-client.ts   # envio de saída + verificação de assinatura de entrada
    │   ├── conversation/
    │   │   ├── state-store.ts   # acesso Prisma a ConversationState / TicketLink
    │   │   └── flow.ts          # a máquina de estados da conversa
    │   ├── routes/
    │   │   ├── whatsapp-inbound.ts         # webhook da Meta Cloud API
    │   │   ├── whatsapp-inbound-twilio.ts  # webhook do Twilio Sandbox
    │   │   └── kaneo-webhook.ts            # receiver do Generic Webhook do Kaneo
    │   └── main.ts
    ├── scripts/setup-kaneo.ts   # script único para criar os 4 custom fields
    ├── prisma/schema.prisma
    └── .env.example             # variáveis consumidas pelo próprio processo do bridge
```

## Como rodar

### Pré-requisitos

- Docker + Docker Compose
- Node.js 22+ (só necessário se quiser rodar o bridge fora do Docker, para dev com hot-reload)
- Uma ferramenta de túnel (ex: [ngrok](https://ngrok.com/)) para expor sua máquina local para os dois webhooks de entrada (WhatsApp → bridge, Kaneo → bridge) durante o desenvolvimento

### 1. Configurar e subir o Kaneo

```bash
cp .env.example .env
# preencha KANEO_POSTGRES_PASSWORD, KANEO_AUTH_SECRET (openssl rand -hex 32),
# BRIDGE_POSTGRES_PASSWORD, e BRIDGE_DATABASE_URL (montado a partir dos
# valores BRIDGE_POSTGRES_* acima, host bridge-db, porta 5432)

docker compose up -d kaneo kaneo-db
```

Abra `http://localhost:5173`, crie o primeiro usuário (vira admin automaticamente), crie um workspace e um projeto.

### 2. Criar os custom fields do Kaneo e gerar uma API key

Gere uma API key para seu usuário pela UI do Kaneo, depois:

```bash
cd bridge
cp .env.example .env
# preencha KANEO_API_URL, KANEO_API_KEY, KANEO_PROJECT_ID em bridge/.env

npm install
npm run setup:kaneo
# copie as 4 linhas KANEO_FIELD_*_ID impressas para bridge/.env
```

### 3. Configurar o WhatsApp

Escolha um em `bridge/.env` via `WHATSAPP_PROVIDER`:

- **`meta`** (padrão, alvo de produção): preencha `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` a partir de um app no Meta for Developers. Aponte o webhook do app para `https://<seu-tunel>/webhooks/whatsapp/inbound`, inscreva no campo `messages`, e adicione seu número de teste à lista de destinatários permitidos.
- **`twilio`** (alternativa temporária, ex: enquanto a verificação de negócio da Meta não sai): preencha `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `PUBLIC_WEBHOOK_BASE_URL`. Aponte o webhook do Twilio Sandbox para `https://<seu-tunel>/webhooks/whatsapp/twilio-inbound`.

### 4. Rodar o bridge

Totalmente dockerizado:

```bash
docker compose up -d --build bridge bridge-db
```

...ou localmente com hot reload contra o Kaneo/Postgres dockerizados (o `DATABASE_URL` de `bridge/.env` já aponta para `localhost:5433`, a porta publicada do `bridge-db`):

```bash
cd bridge
docker compose up -d bridge-db   # a partir da raiz do repo, em outro terminal
npm run prisma:migrate
npm run dev
```

### 5. Configurar o webhook de saída do Kaneo

Na UI do Kaneo: **Settings → Projects → Integrations → Generic Webhook**. Configure a URL como `https://<seu-tunel>/webhooks/kaneo`, defina um secret (precisa bater com `KANEO_WEBHOOK_SECRET` em `bridge/.env`), e habilite pelo menos `task.comment_created` (essencial para as respostas chegarem no WhatsApp) e `task.status_changed` (usado para o aviso de "chamado resolvido").

> O Kaneo valida a URL do webhook do lado do servidor e rejeita qualquer endereço que resolva para um destino privado/não roteável (proteção contra SSRF) — a URL precisa ser genuinamente pública, que é exatamente pra isso que serve o túnel em desenvolvimento.

## Variáveis de ambiente

**`.env` da raiz** (consumidas pela interpolação do `docker-compose.yml`):

| Variável | Propósito |
|---|---|
| `KANEO_CLIENT_URL` | URL pública que o próprio Kaneo reporta (padrão `http://localhost:5173`) |
| `KANEO_POSTGRES_DB` / `_USER` / `_PASSWORD` | Postgres próprio do Kaneo |
| `KANEO_AUTH_SECRET` | Secret de assinatura de sessão do Kaneo (`openssl rand -hex 32`) |
| `BRIDGE_POSTGRES_DB` / `_USER` / `_PASSWORD` | Postgres próprio do bridge |
| `BRIDGE_DATABASE_URL` | String de conexão completa, repassada ao container do bridge como `DATABASE_URL` |

**`bridge/.env`** (consumidas pelo processo do bridge, via `env_file` quando dockerizado):

| Variável | Propósito |
|---|---|
| `PORT` | Porta HTTP do bridge (padrão `3000`) |
| `DATABASE_URL` | Só usada rodando o bridge fora do Docker |
| `WHATSAPP_PROVIDER` | `meta` ou `twilio` |
| `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` | Obrigatórias quando `WHATSAPP_PROVIDER=meta` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `PUBLIC_WEBHOOK_BASE_URL` | Obrigatórias quando `WHATSAPP_PROVIDER=twilio` |
| `KANEO_API_URL`, `KANEO_API_KEY`, `KANEO_PROJECT_ID` | Acesso à API REST do Kaneo |
| `KANEO_FIELD_PHONE_ID`, `KANEO_FIELD_CUSTOMER_TYPE_ID`, `KANEO_FIELD_NAME_ID`, `KANEO_FIELD_EMAIL_ID` | IDs dos custom fields impressos por `npm run setup:kaneo` |
| `KANEO_WEBHOOK_SECRET` | Precisa bater com o secret configurado na integração Generic Webhook do Kaneo |

## Scripts disponíveis (`bridge/`)

| Script | Descrição |
|---|---|
| `npm run dev` | Roda com hot reload (`--watch`), sem etapa de build |
| `npm run build` | `prisma generate` + `tsc` |
| `npm start` | Roda o output compilado (`dist/main.js`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Aplica as migrations do Prisma |
| `npm run setup:kaneo` | Script único: cria os 4 custom fields no Kaneo, imprime os IDs |

## Endpoints expostos pelo bridge

| Método | Rota | Propósito |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET`/`POST` | `/webhooks/whatsapp/inbound` | Meta Cloud API — handshake de verificação / mensagens de entrada (`WHATSAPP_PROVIDER=meta`) |
| `POST` | `/webhooks/whatsapp/twilio-inbound` | Mensagens de entrada do Twilio Sandbox (`WHATSAPP_PROVIDER=twilio`) |
| `POST` | `/webhooks/kaneo` | Receiver do Generic Webhook do Kaneo |

## Segurança

- As duas direções de webhook são validadas por assinatura: mensagens de entrada do WhatsApp checam `X-Hub-Signature-256` (Meta) ou a assinatura de requisição do Twilio; eventos de entrada do Kaneo checam `X-Kaneo-Signature`. Todas as comparações são HMAC-SHA256 com checagem de igualdade em tempo constante.
- Mensagens de entrada do WhatsApp são deduplicadas pelo ID de mensagem do provedor antes de processar, já que o WhatsApp reentrega um webhook se não receber um `200` rápido.
- Nenhum segredo é commitado: arquivos `.env` estão no gitignore, e o `docker-compose.yml` nunca monta uma string com formato de credencial inline — `DATABASE_URL` é uma única variável opaca, vinda inteiramente do `.env` não rastreado.

## Limitações conhecidas

- Sem fallback para Message Templates do WhatsApp fora da janela de 24h de mensageria da Meta — hoje, uma resposta do atendente fora dessa janela falha ao enviar até o cliente mandar mensagem de novo.
- Ainda sem suíte de testes automatizados.
- Categoria do chamado é texto livre embutido no título/descrição da task, não um custom field consultável.
