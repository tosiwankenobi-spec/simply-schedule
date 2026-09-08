import { describe, expect, it } from "vitest";

import {
  injectSupabasePublicConfig,
  SUPABASE_PUBLISHABLE_KEY_META_NAME,
  SUPABASE_URL_META_NAME,
} from "../src/integrations/supabase/public-runtime-config";

describe("injectSupabasePublicConfig", () => {
  it("adds the two public Supabase values to the document head", () => {
    const html = injectSupabasePublicConfig("<html><head></head><body></body></html>", {
      url: "https://example.supabase.co",
      publishableKey: "publishable-placeholder",
    });

    expect(html).toContain(
      `<meta name="${SUPABASE_URL_META_NAME}" content="https://example.supabase.co">`,
    );
    expect(html).toContain(
      `<meta name="${SUPABASE_PUBLISHABLE_KEY_META_NAME}" content="publishable-placeholder">`,
    );
  });

  it("escapes attribute content and never invents privileged configuration", () => {
    const html = injectSupabasePublicConfig("<head></head>", {
      url: 'https://example.test/?a=1&b="two"',
      publishableKey: "public<key>",
    });

    expect(html).toContain("a=1&amp;b=&quot;two&quot;");
    expect(html).toContain("public&lt;key&gt;");
    expect(html).not.toContain("service-role");
  });
});
