import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of service · Chronos-V" },
      {
        name: "description",
        content:
          "The plain-language terms for using Chronos-V, the AI schedule planner by Verolane Digital Solutions Limited.",
      },
      { property: "og:title", content: "Terms of service · Chronos-V" },
      {
        property: "og:description",
        content:
          "Plain-language terms covering your account, your content, connected services, AI suggestions, and liability.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://verolane.online/terms" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://verolane.online/terms" }],
  }),
});

const linkClass = "font-medium text-foreground underline underline-offset-2";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function SupportEmail() {
  return (
    <a href="mailto:support@verolane.online" className={linkClass}>
      support@verolane.online
    </a>
  );
}

function TermsPage() {
  return (
    <div className="verolane-wash relative min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 paper-grain opacity-20" />
      <div className="relative mx-auto max-w-[760px] px-4 py-10 sm:px-6 lg:py-14">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink">
            <img src="/favicon.png" alt="" className="h-6 w-6" />
          </span>
          Chronos-V
        </Link>

        <h1 className="mt-6 font-serif text-3xl text-foreground sm:text-4xl">Terms of service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: October 30, 2026</p>

        <Section title="Agreement to these terms">
          <p>
            By creating an account or using Chronos-V, you agree to these terms. If you do not
            agree, please do not use the service.
          </p>
        </Section>

        <Section title="Who we are">
          <p>
            Chronos-V is provided by Verolane Digital Solutions Limited, Regina, Saskatchewan,
            Canada. You can contact us at <SupportEmail />.
          </p>
        </Section>

        <Section title="Eligibility">
          <p>
            You must be at least 13 years old, and old enough to form a binding contract where
            you live — or have a parent or guardian's permission to use Chronos-V.
          </p>
        </Section>

        <Section title="Your account">
          <p>
            Keep your sign-in details secure. You are responsible for activity that happens on
            your account. Tell us promptly if you think someone else has accessed it.
          </p>
        </Section>

        <Section title="Acceptable use">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Do not use Chronos-V for anything unlawful.</li>
            <li>Do not abuse, overload, or interfere with the service or other users.</li>
            <li>Do not reverse engineer the service, except where the law allows it.</li>
            <li>Do not scrape, copy, or resell the service.</li>
          </ul>
        </Section>

        <Section title="Your content">
          <p>
            You own your appointments, tasks, and other data. You grant us only the limited
            permission needed to store, process, and display that content to provide the
            service to you.
          </p>
        </Section>

        <Section title="Third-party connections">
          <p>
            Google, Microsoft, and other services you connect are governed by their own terms.
            You can disconnect them at any time. Our handling of Google data follows our{" "}
            <Link to="/privacy-policy" className={linkClass}>
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

        <Section title="AI suggestions">
          <p>
            AI suggestions may be inaccurate or incomplete. Nothing is added to your plan
            without your approval, and you are responsible for checking important times and
            details.
          </p>
        </Section>

        <Section title="Purchases and licences">
          <p>
            Any paid features or licences are described at the point of purchase. The fees and
            refund terms shown there apply.
          </p>
        </Section>

        <Section title="Service availability">
          <p>
            Chronos-V is provided "as is" and "as available". We may change, suspend, or
            discontinue features at any time.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, we are not liable for indirect or
            consequential losses, missed appointments, or lost data. Our total liability is
            limited to the amounts you paid us in the 12 months before the claim.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            You can delete your account at any time — see "Delete your account" in our{" "}
            <Link to="/privacy-policy" className={linkClass}>
              Privacy Policy
            </Link>
            . We may suspend accounts that break these terms.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            If we change these terms, we will update this page and the date above. Continuing
            to use Chronos-V means you accept the updated terms.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These terms are governed by the laws of the Province of Saskatchewan and the federal
            laws of Canada applicable there.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms: email <SupportEmail />.
          </p>
        </Section>
      </div>
    </div>
  );
}
