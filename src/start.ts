import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Replayed/probe requests hit /_serverFn/* with a plain `{}` body instead of the
// framework's serialized payload. Those blow up in the payload parser as an
// opaque 500 that surfaces in the app as a blank error screen. Reject them early.
async function isMalformedServerFnCall(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  if (!new URL(request.url).pathname.startsWith("/_serverFn/")) return false;
  if (request.headers.get("x-tsr-serverfn") === "true") return false;
  if (!request.headers.get("content-type")?.includes("application/json")) return false;
  try {
    const body = (await request.clone().text()).trim();
    if (!body) return false;
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && !("t" in parsed);
  } catch {
    return false;
  }
}

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  if (new URL(request.url).pathname.startsWith("/lovable/")) {
    return next();
  }
  if (await isMalformedServerFnCall(request)) {
    return new Response(JSON.stringify({ error: "Malformed server function request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
