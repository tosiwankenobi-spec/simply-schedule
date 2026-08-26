import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native Android shell for V-Chronos.
 *
 * The app is a server-rendered web app, so the native shell loads the hosted
 * site instead of bundling a static build. Point `server.url` at your published
 * Lovable URL (or your custom domain) before building the APK.
 *
 * Build steps (run locally, requires Android Studio + JDK 17):
 *   1. bunx cap add android
 *   2. bunx cap sync android
 *   3. bunx cap open android   -> Run / Build APK from Android Studio
 */
const config: CapacitorConfig = {
  appId: "app.chronos.planner",
  appName: "V-Chronos",
  webDir: "public",
  server: {
    url: "https://project--3efdbf41-41b9-4a36-a987-83eec491b4cd.lovable.app",
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    backgroundColor: "#faf3e3",
  },
};

export default config;
