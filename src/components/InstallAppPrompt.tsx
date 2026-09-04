import { useEffect, useState } from "react";
import { Download, MonitorSmartphone, Share2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const DISMISSED_AT_KEY = "chronos-v:install-invitation-dismissed:v1";
const REMIND_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

type InstallChoice = { outcome: "accepted" | "dismissed"; platform?: string };

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<InstallChoice>;
  userChoice: Promise<InstallChoice>;
};

function isRunningStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isAppleMobileBrowser() {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function wasRecentlyDismissed() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISSED_AT_KEY));
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < REMIND_AFTER_MS;
  } catch {
    return false;
  }
}

export function InstallAppPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAppleInstructions, setShowAppleInstructions] = useState(false);
  const [isAppleMobile, setIsAppleMobile] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isRunningStandalone() || wasRecentlyDismissed()) return;

    const appleMobile = isAppleMobileBrowser();
    setIsAppleMobile(appleMobile);
    setIsVisible(appleMobile);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setIsVisible(true);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsVisible(false);
      setShowAppleInstructions(false);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // The invitation can still be dismissed for this page view when storage is unavailable.
    }
    setIsVisible(false);
    setShowAppleInstructions(false);
  }

  async function install() {
    if (installPrompt) {
      try {
        await installPrompt.prompt();
      } catch {
        // The browser may withdraw eligibility between showing the invitation and this tap.
      } finally {
        setInstallPrompt(null);
        setIsVisible(false);
      }
      return;
    }
    if (isAppleMobile) setShowAppleInstructions(true);
  }

  if (!isVisible) return null;

  return (
    <>
      <aside
        aria-label="Install Chronos-V"
        className="fixed inset-x-3 bottom-[5.6rem] z-30 mx-auto max-w-md rounded-2xl border border-paper/10 bg-ink p-4 text-paper shadow-2xl shadow-ink/25 sm:left-auto sm:right-5 sm:mx-0 lg:bottom-5 lg:right-5"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss installation invitation"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-paper/55 transition-colors hover:bg-paper/10 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-8">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-paper/10 ring-1 ring-paper/15">
            <img src="/favicon.png" alt="" className="h-7 w-7" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-leaf">
              Keep your day close
            </p>
            <h2 className="mt-1 font-serif text-xl leading-tight">Install Chronos-V</h2>
            <p className="mt-1.5 text-xs leading-5 text-paper/65">
              Open your schedule in its own focused window, right from your home screen.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void install()}
          className="mt-4 h-10 w-full rounded-xl bg-paper text-ink hover:bg-paper/90 hover:text-ink"
        >
          {isAppleMobile ? (
            <Share2 className="mr-2 h-4 w-4" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {isAppleMobile ? "Show installation steps" : "Install app"}
        </Button>
      </aside>

      <Sheet open={showAppleInstructions} onOpenChange={setShowAppleInstructions}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto rounded-t-3xl px-5 pb-8 sm:px-8"
        >
          <div className="mx-auto max-w-lg">
            <SheetHeader className="text-left">
              <span className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-ink text-paper">
                <MonitorSmartphone className="h-5 w-5" />
              </span>
              <SheetTitle className="font-serif text-3xl text-ink">
                Add Chronos-V to your Home Screen
              </SheetTitle>
              <SheetDescription>
                Follow these steps to open your schedule like an app on this device.
              </SheetDescription>
            </SheetHeader>
            <ol className="mt-6 space-y-3">
              <InstallStep number="1" text="Open this page in Safari." />
              <InstallStep number="2" text="Tap the Share button in the browser toolbar." />
              <InstallStep number="3" text="Choose Add to Home Screen." />
              <InstallStep number="4" text="Turn on Open as Web App, then tap Add." />
            </ol>
            <div className="mt-6 flex items-start gap-2 rounded-2xl bg-secondary/70 p-4 text-sm text-muted-foreground">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ember" />
              Your Chronos-V icon will appear beside your other apps and open in its own window.
            </div>
            <Button type="button" onClick={dismiss} className="mt-6 h-11 w-full rounded-xl">
              Got it
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function InstallStep({ number, text }: { number: string; text: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-ink font-serif text-sm text-paper">
        {number}
      </span>
      <span className="text-sm font-medium text-ink">{text}</span>
    </li>
  );
}
