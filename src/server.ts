import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { injectSupabasePublicConfig } from "./integrations/supabase/public-runtime-config";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

function runtimeString(env: unknown, name: string): string | undefined {
  const directBinding =
    env != null && typeof env === "object" ? (env as Record<string, unknown>)[name] : undefined;
  const workerBindings = (globalThis as typeof globalThis & { __env__?: Record<string, unknown> })
    .__env__;
  const workerBinding = workerBindings?.[name];
  const value =
    typeof directBinding === "string"
      ? directBinding
      : typeof workerBinding === "string"
        ? workerBinding
        : process.env[name];
  return value?.trim() || undefined;
}

async function injectPublicRuntimeConfig(response: Response, env: unknown): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("text/html")) return response;

  const url = runtimeString(env, "SUPABASE_URL");
  const publishableKey = runtimeString(env, "SUPABASE_PUBLISHABLE_KEY");
  if (!url || !publishableKey) return response;

  const html = await response.text();
  const body = injectSupabasePublicConfig(html, { url, publishableKey });
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return await injectPublicRuntimeConfig(normalized, env);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
