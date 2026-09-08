import { describe, expect, it } from "vitest";

import { managedPublicEnvDefines } from "../src/build/public-env";

describe("managedPublicEnvDefines", () => {
  it("maps Lovable-managed public Supabase values into Vite client variables", () => {
    expect(
      managedPublicEnvDefines({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-placeholder",
        SUPABASE_PROJECT_ID: "example",
      }),
    ).toEqual({
      "import.meta.env.VITE_SUPABASE_URL": '"https://example.supabase.co"',
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '"publishable-placeholder"',
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": '"example"',
    });
  });

  it("omits missing values and never exposes privileged Supabase keys", () => {
    expect(
      managedPublicEnvDefines({
        SUPABASE_SERVICE_ROLE_KEY: "must-stay-server-only",
      }),
    ).toEqual({});
  });
});
