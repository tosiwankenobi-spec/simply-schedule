# Chronos-V roadmap

## Feature 1 — Per-user Microsoft Outlook calendar sync (App User Connector)

**Status: BLOCKED — no `microsoft_outlook` App User Connector client exists in the workspace.**

Verified in this session:
- `list_connectors` → `microsoft_outlook` is available and enabled.
- `list_clients(microsoft_outlook)` → **zero configured clients**, so nothing is linked to this project.
- Server env has `LOVABLE_API_KEY` but **not** `MICROSOFT_OUTLOOK_APP_USER_CONNECTOR_CLIENT_API_KEY`
  and **not** `APP_USER_CONNECTION_KEY_SECRET` (both are provisioned only on link).
- No `connect_client` tool is available in this headless session, so the client cannot be
  created or linked from here.

### Unblock steps (builder / workspace admin)
1. Microsoft Entra app registration: supported account types set; redirect URI exactly
   `https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback`; delegated Graph
   permissions `User.Read`, `Calendars.Read` (+ `Calendars.ReadWrite` for two-way), `offline_access`.
2. Workspace **App User Connectors** settings → create a `microsoft_outlook` client with that
   client ID/secret, **`allow_offline_access` enabled**.
3. Link the client to this project.

### Work queued once unblocked
- [ ] Migration: `app_user_connections` (service-role only, RLS on, REVOKE from PUBLIC/anon/authenticated).
- [ ] Migration: provider/account/calendar-aware uniqueness on `appointments` replacing the legacy
      global `(user_id, calendar_event_id)` index, with Google backfill.
- [ ] Migration: provider identity columns on `pending_calendar_deletions`.
- [ ] Migration: Outlook columns on `appointments` (provider, provider_account_id, etag/change key,
      remote updated, all-day/timezone/recurrence) + `outlook_sync_enabled`/calendar selection on `sync_settings`.
- [ ] `src/server/connectionKeyCrypto.ts` (AES-256-GCM) + `src/server/appUserConnections.server.ts`.
- [ ] `src/integrations/lovable/appUserConnector.ts` (server-only gateway helpers).
- [ ] Server fns: start connect, complete OAuth (code exchange), status, disconnect, delete local copies.
- [ ] `/oauth/outlook/return` popup landing route.
- [ ] `outlook.server.ts`: initial import + `calendarView` delta sync, pagination, delta-token recovery,
      bounded retry/backoff, conflict policy reuse, provider-isolated deletes.
- [ ] `/setup/outlook` real connect/reconnect/disconnect/sync UI + health states + calendar selection.
- [ ] Schedule-hub provider labels, privacy controls, sync alert integration.
- [ ] Tests: auth boundaries, crypto round-trip + wrong-key failure, pagination/delta persistence,
      expired-token fallback, retry, dedupe, conflict policy, provider-isolated deletes,
      disconnect preservation, local-copy cleanup.

## Later (not started — do not begin without instruction)
- Replan Preview / Undo.
