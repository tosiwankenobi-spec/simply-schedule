# Chronos-V authentication

Chronos-V uses Supabase Auth for identity and sessions. The React/TanStack Start application supports email/password authentication directly through Supabase and Google sign-in through Lovable Cloud Auth. Authenticated data access uses the signed-in user's bearer token and Supabase Row Level Security (RLS). A separate server-only Supabase client exists for explicitly trusted operations that must bypass RLS.

## Components

| Component                                         | Responsibility                                                                                                            | Trust level                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/routes/auth.tsx`                             | Sign-in and sign-up UI; starts email/password or Google authentication                                                    | Browser                         |
| `src/routes/_authenticated/route.tsx`             | Checks the current user before loading authenticated routes                                                               | Browser route guard             |
| `src/integrations/supabase/client.ts`             | Lazily creates the public Supabase client with the project URL and publishable key                                        | Browser/public configuration    |
| `src/integrations/supabase/previewAuthStorage.ts` | Stores sessions locally or brokers them to a trusted Lovable editor ancestor in preview environments                      | Browser session storage         |
| `src/integrations/lovable/index.ts`               | Starts Lovable OAuth and installs returned OAuth tokens into the Supabase session                                         | Browser OAuth bridge            |
| `src/integrations/supabase/auth-attacher.ts`      | Adds the current access token as a Bearer token on TanStack server-function requests                                      | Browser-to-server boundary      |
| `src/integrations/supabase/auth-middleware.ts`    | Validates the bearer token, creates a user-scoped Supabase client, and exposes the user ID and claims to server functions | Server, user-scoped             |
| `src/integrations/supabase/client.server.ts`      | Creates the service-role client for narrowly scoped trusted server work                                                   | Server, privileged              |
| `supabase/migrations/`                            | Defines RLS policies and grants for application tables                                                                    | Database authorization boundary |

## Email/password request flow

1. The user submits the form on `/auth`.
2. Sign-up calls `supabase.auth.signUp()`. Sign-in calls `supabase.auth.signInWithPassword()`.
3. Supabase Auth verifies the credentials and returns a session containing an access token and refresh token.
4. The public Supabase client persists the session and automatically refreshes access tokens.
5. The authenticated route guard calls `supabase.auth.getUser()`. Missing or invalid users are redirected to `/auth`.
6. Browser queries made through the public client carry the user's session, so Supabase evaluates database RLS policies as that user.

Passwords are sent to Supabase Auth over HTTPS and are not stored or processed by Chronos-V application code.

## Server-function request flow

Authenticated TanStack server functions use the following path:

```text
browser Supabase session
  -> auth-attacher reads the access token
  -> Authorization: Bearer <access-token>
  -> requireSupabaseAuth validates the token with Supabase
  -> middleware exposes userId, claims, and a user-scoped Supabase client
  -> server function queries Supabase as that user
  -> RLS authorizes rows using auth.uid()
```

`src/start.ts` registers the client middleware globally for server-function calls. The server middleware rejects missing, malformed, empty, or invalid bearer tokens and requires a subject (`sub`) claim. It disables session persistence and token refresh because each server request is authenticated independently.

The browser route guard improves navigation and user experience, but it is not the security boundary. Server-side token validation and database RLS enforce access even if a client bypasses the route guard.

## Tokens and session storage

The Supabase session contains a short-lived access token and a refresh token. The access token represents the authenticated user and is sent to Supabase or attached to authenticated server-function requests. The refresh token is used by `@supabase/supabase-js` to renew the session; application code does not manually refresh it.

The public client is configured with:

- `persistSession: true`
- `autoRefreshToken: true`
- `brokeredPreviewStorage()` as its storage adapter

On ordinary origins, the adapter uses browser `localStorage`. Signing out through `supabase.auth.signOut()` removes the active session. Treat browser storage as sensitive: do not log tokens, put them in URLs, send them to analytics, or copy them into application data.

### Lovable preview storage

Lovable previews can run inside an editor frame. On recognized Lovable preview hostnames, `previewAuthStorage.ts` extracts a UUID-shaped project ID only from trusted hostname positions and brokers storage operations to the editor ancestor with `postMessage`.

The broker:

- activates only when the page is framed and the preview hostname/project ID match expected forms;
- accepts replies only from allow-listed Lovable editor origins (plus localhost for development preview zones);
- sends messages with an explicit `targetOrigin`, never `*`;
- correlates replies with a per-request ID and times out after two seconds;
- keeps a local copy as a fallback and handles logout tombstones so an old local session is not resurrected.

If those preview conditions are not met, storage falls back to `localStorage`.

## Google OAuth through Lovable

1. `/auth` calls `lovable.auth.signInWithOAuth("google")` with the application origin as the redirect URI.
2. Lovable Cloud Auth coordinates the Google OAuth interaction.
3. If a redirect is required, the browser leaves the page and later returns through the configured OAuth redirect flow.
4. When Lovable returns tokens directly, the integration calls `supabase.auth.setSession(result.tokens)`.
5. Supabase becomes the source of truth for the browser session, and the user continues to `/app`.

Chronos-V does not perform the Google authorization-code exchange or store a Google client secret in browser code. The allowed redirect URLs and Google provider configuration must be maintained in the connected Lovable/Supabase project.

## RLS and service-role trust boundaries

The browser and normal authenticated server functions use the Supabase publishable key. A publishable key identifies the Supabase project; it is not an authorization bypass and is expected to be present in the browser bundle. User identity comes from the access token. RLS policies in `supabase/migrations/` restrict application rows with checks such as `auth.uid() = user_id`.

`client.server.ts` is different: it reads `SUPABASE_SERVICE_ROLE_KEY` and creates a non-persistent admin client. The service-role key bypasses RLS and therefore must:

- exist only in server-side secret storage or an ignored local environment file;
- never use a `VITE_` prefix;
- never be imported into route files, browser components, or `*.functions.ts` modules that can enter a client bundle;
- never be logged, returned to a client, committed, or included in `.env.example`;
- be used only after the server has independently authenticated and authorized the requested operation.

Prefer the user-scoped client from `requireSupabaseAuth` whenever RLS can express the access rule. Use the service-role client only for a documented operation that genuinely requires elevated database privileges.

## Local environment setup

1. Copy `.env.example` to `.env`.
2. In the Supabase dashboard, obtain the project URL and current publishable key.
3. Set both the Vite-prefixed browser variables and their server equivalents:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   ```

4. Install the locked dependencies with `bun install --frozen-lockfile` and start the app with `bun run dev`.
5. Configure the local origin as an allowed redirect URL in Supabase/Lovable before testing Google sign-in or email-confirmation links.

The checked-in `.env.example` intentionally contains only non-secret Supabase placeholders. If a local trusted server operation requires `SUPABASE_SERVICE_ROLE_KEY`, add it only to the ignored `.env` or your secret manager. Other integrations used by Chronos-V have their own server-only credentials and are intentionally outside this authentication example.

## Operational rules

- Do not commit `.env` or any environment-specific variant. The repository ignores `.env` and `.env.*`, while explicitly allowing `.env.example`.
- Do not rotate a publishable key merely because it was visible in client configuration; it is designed to be public. Rotate it if it was replaced, revoked, or mistakenly treated as a secret in another security control.
- Immediately rotate any service-role key, OAuth client secret, or third-party API key that is exposed in source control, logs, browser bundles, or shared output.
- Review every new Supabase table for enabled RLS and least-privilege policies before exposing it through the public client.
- Keep OAuth redirect allow-lists narrow and environment-specific.
