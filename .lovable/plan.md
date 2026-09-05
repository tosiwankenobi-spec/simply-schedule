# Per-User Microsoft Outlook Sync via App User Connectors — Investigation Report & Plan

## (1) Is a Microsoft Outlook app-user client linked today?

**No.** Findings from inspecting the project and workspace:

- The workspace **App User Connector** catalog includes `microsoft_outlook` (enabled), but `list_clients` for `microsoft_outlook` returns **zero configured clients** — so nothing can be linked to this project yet.
- The project contains **no app-user connector runtime code**: no `appUserConnector.ts` helper, no `connectAppUser` / `callAsAppUser` / `disconnectAppUser` usage, no `lovack_*` connection-key handling, and no `app_user_connections` table.
- What exists today is the builder-facing guide page `src/routes/_authenticated/setup.outlook.tsx` (checklist, callback-URL copy box, least-privilege scope plan) — preparation only. Existing Gmail/Calendar sync (`src/lib/calendar.server.ts`, `gmail.server.ts`, `setup.sync.tsx`) uses **workspace App connectors** (builder-owned credentials), not per-user OAuth, and only covers Google.

## (2) Runtime API/SDK contract for the generated app

Per the active App User Connector (connection-key) flow for TanStack Start:

**Environment variables (server-only, read inside handlers):**
- `MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY` — client API key synced into the project when the workspace client is linked (`<CONNECTOR_ID>_APP_USER_CONNECTOR_CLIENT_API_KEY`).
- `APP_USER_CONNECTION_KEY_SECRET` — base64 32-byte AES-GCM key auto-provisioned when an app-user connector is linked; used to encrypt stored connection keys.
- `LOVABLE_API_KEY` — gateway auth secret (never in browser code).

**Gateway URL/path conventions:**
- Gateway base: `https://connector-gateway.lovable.dev` (connector segment: `/microsoft_outlook`).
- Microsoft Graph calls are made from server code via `callAsAppUser({ gatewayBaseUrl, connectorId: "microsoft_outlook", connectionAPIKey: <stored lovack_* key>, path: "/me/events?..." })`, where `path` is **relative to `https://graph.microsoft.com/v1.0/`** (e.g. `/me/calendarView?startDateTime=...&endDateTime=...`, `/me/events/{id}`).
- OAuth redirect URI registered in Microsoft Entra must be exactly `https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback` — never the app URL.

**Flow contract (helpers from the stack's App User Connector module, server-side `appUserConnector.ts`):**
- **Connection status:** server fn reads the user's stored encrypted `lovack_*` key from `app_user_connections` (service-role only); present = connected.
- **Start OAuth:** browser opens the consent popup via `connectAppUser` with `connectorId: "microsoft_outlook"` and `credentialsConfiguration.scopes` = `openid profile email offline_access Calendars.Read` (add `Calendars.ReadWrite` / `Mail.Read` only when features need them); `credentialsConfiguration.domain_hint: "consumers"` for personal accounts, `prompt: "select_account"`.
- **Callback:** the redirect callback passes a one-time code to `exchangeAppUserOAuthCode` **on the server**, which returns the connection key; the key is encrypted (AES-256-GCM, `APP_USER_CONNECTION_KEY_SECRET`) and upserted into `app_user_connections` keyed by `(user_id, connector_id)`. Never receive the key via browser `web_message`.
- **Call Graph:** `callAsAppUser` with the decrypted key; gateway handles token refresh (`offline_access` required).
- **Disconnect:** call `disconnectAppUser` on the server, then delete the user's `app_user_connections` row for `microsoft_outlook`.

**Storage table (Lovable Cloud migration):**
```text
public.app_user_connections (id, user_id, connector_id, connection_key_ciphertext,
  created_at, updated_at, UNIQUE(user_id, connector_id))
GRANT … TO service_role only;  RLS enabled;  no anon/authenticated grants.
```

## (3) Auth bridge for this Supabase Auth project

- **app_user_id = Supabase `user.id`** (stable opaque UUID from the existing auth) — never email or a placeholder.
- All connector server functions use the existing `requireSupabaseAuth` middleware (bearer token already attached via `attachSupabaseAuth` in `src/start.ts`); `context.userId` keys all connection-key reads/writes.
- The `app_user_connections` table is accessed only through `supabaseAdmin` (service role) inside server handlers; browser code never touches it.
- No additional identity provider is needed — the App User Connector flow layers on top of existing Supabase sign-in.

## (4) Builder-only configuration still required (blocked on you)

1. **Microsoft Entra app registration** (one-time, by you): supported account types must include the account kinds you want (work/school and/or personal); add the gateway callback URL above as a Web redirect URI; add delegated Graph permissions (start: `User.Read`, `Calendars.Read`, `offline_access`).
2. **Configure the App User Connector client** in workspace **App User Connectors** settings for `microsoft_outlook` with the Entra client ID/secret — none exists yet, and in this session I cannot create it. **`allow_offline_access` must be enabled** on the client, or no `lovack_*` key is issued and per-user calls cannot work.
3. After that, I can link the client to the project (`connect_client`) and implement the runtime.

## Implementation plan (once the client exists — not part of this read-only turn)

1. Link the `microsoft_outlook` client; verify `MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY` and `APP_USER_CONNECTION_KEY_SECRET` are present.
2. Migration: `app_user_connections` table (service-role-only, RLS on).
3. `src/server/connectionKeyCrypto.ts` (AES-256-GCM encrypt/decrypt) and `src/server/appUserConnections.server.ts` (save/load/delete helpers).
4. Server-only `appUserConnector.ts` helper + server fns: `getOutlookConnectionStatus`, `completeOutlookOAuth` (code exchange + encrypted upsert), `disconnectOutlook`.
5. UI: real **Connect Outlook** button + connected/disconnected state on `/setup/outlook` (replacing the checklist-only page), using the popup flow with the scopes above.
6. Outlook calendar sync engine (`outlook.server.ts`) modeled on `calendar.server.ts`: incremental pull, conflict policy reuse, `provider = 'microsoft_outlook'` in `sync_state`/`schedule_hub_events` source labels.
7. Verify with typecheck/build; commit (auto-syncs to GitHub). Do not publish.

**No secrets were read or displayed during this inspection.**
