export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export const SUPABASE_URL_META_NAME = "chronos-v:supabase-url";
export const SUPABASE_PUBLISHABLE_KEY_META_NAME = "chronos-v:supabase-publishable-key";

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function injectSupabasePublicConfig(html: string, config: SupabasePublicConfig): string {
  if (!html.includes("</head>")) return html;

  const url = escapeHtmlAttribute(config.url);
  const publishableKey = escapeHtmlAttribute(config.publishableKey);
  const meta = [
    `<meta name="${SUPABASE_URL_META_NAME}" content="${url}">`,
    `<meta name="${SUPABASE_PUBLISHABLE_KEY_META_NAME}" content="${publishableKey}">`,
  ].join("");

  return html.replace("</head>", `${meta}</head>`);
}
