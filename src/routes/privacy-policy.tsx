import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy-policy")({
  component: PrivacyPolicyPage,
  head: () => ({
    meta: [
      { title: "Privacy policy · Chronos-V" },
      {
        name: "description",
        content:
          "How Chronos-V collects, uses, and protects your data: account information, calendar and email connections, AI processing, and your controls.",
      },
      { property: "og:title", content: "Privacy policy · Chronos-V" },
      {
        property: "og:description",
        content:
          "How Chronos-V collects, uses, and protects your data, and the controls you have over each connection.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://verolane.online/privacy-policy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://verolane.online/privacy-policy" }],
  }),
});

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

function PrivacyPolicyPage() {
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

        <h1 className="mt-6 font-serif text-3xl text-foreground sm:text-4xl">
          Privacy policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: October 30, 2026 · Chronos-V is operated by Verolane Digital
          Solutions Limited, Regina, Saskatchewan, Canada (verolane.online).
        </p>

        <Section title="Overview">
          <p>
            Chronos-V is a personal schedule planner. You can add appointments and tasks by
            typing, pasting text, or connecting your own calendar and email accounts. This
            policy explains what we collect, why, how long we keep it, and the controls you
            have.
          </p>
          <p>
            Your data is stored in your own private account on our hosted backend and is
            protected by row-level security: only you can read or change your schedule,
            tasks, and settings through your signed-in session.
          </p>
        </Section>

        <Section title="What we store">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-foreground">Account details.</span> The email
              address and name associated with the sign-in method you choose (for example,
              Google or Microsoft).
            </li>
            <li>
              <span className="font-medium text-foreground">Your plan.</span> Appointments,
              tasks, routines, notes, reminders, and notification preferences you create or
              approve.
            </li>
            <li>
              <span className="font-medium text-foreground">Connection settings.</span> Which
              calendars you selected, your sync and privacy choices, and a short activity log
              of recent sync runs.
            </li>
            <li>
              <span className="font-medium text-foreground">Imported copies.</span> Details of
              calendar events and appointment-like emails you approve, plus identifiers needed
              to avoid importing the same item twice. Rejected or dismissed email suggestions
              are remembered for up to 30 days.
            </li>
            <li>
              <span className="font-medium text-foreground">Optional learning statistics.</span>
              If you opt in, anonymous counters about how you use the planner (for example,
              how often you keep or edit suggested blocks). This feature is deterministic and
              does not use AI, does not store free text, and can be reset or turned off at any
              time.
            </li>
            <li>
              <span className="font-medium text-foreground">Verification documents.</span> Only
              if you voluntarily upload a PDF or DOCX (10 MB maximum) during a connection
              review. These are stored privately in your account and can be deleted by you at
              any time.
            </li>
          </ul>
        </Section>

        <Section title="Calendar and email connections">
          <p>
            Chronos-V connects to third-party services only with your explicit approval, using
            your own accounts:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <span className="font-medium text-foreground">Google Calendar.</span> Reads event
              titles, times, locations, and descriptions from the calendars you select, and
              creates, updates, or deletes events you choose to send to Google Calendar.
            </li>
            <li>
              <span className="font-medium text-foreground">Gmail.</span> Reads recent inbox
              messages that look like appointments, deliveries, deadlines, or renewals, and
              can send replies you write. Message text matching the appointment scan is sent
              to an AI service to decide whether it is worth suggesting; ambiguous messages
              are skipped.
            </li>
            <li>
              <span className="font-medium text-foreground">Outlook email and calendar.</span>
              Reads recent matching Outlook messages and synchronizes your Outlook calendar
              with your Chronos-V plan. Microsoft's connection credentials are stored
              encrypted on the server and are never sent to your browser.
            </li>
          </ul>
          <p>
            Raw email bodies are not permanently stored in Chronos-V. Connection tokens stay
            with the connection provider and are not written into our application tables.
          </p>
        </Section>

        <Section title="AI processing">
          <p>
            When you paste or speak a note, Chronos-V sends that text to an AI service to
            extract the title, time, and location. Email scans described above are processed
            the same way. Nothing is added to your plan automatically — every AI suggestion
            waits for your review and approval. Your plan data is not used to train AI
            models.
          </p>
        </Section>

        <Section title="Google user data">
          <p>
            Chronos-V's use and transfer to any other app of information received from Google
            APIs will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>
            Google user data is used only to provide and improve the user-facing scheduling
            features you enabled. It is not used for advertising, not sold, and not used to
            train generalized AI models. Humans do not read it except with your explicit
            consent, for security or abuse investigation, to comply with law, or when it is
            aggregated and anonymized for internal operations. Email text sent to an AI service
            is processed only on your behalf to produce suggestions.
          </p>
        </Section>

        <Section title="Sharing and household features">
          <p>
            Your plan is private by default. Household features only reveal what you choose to
            share: busy-only sharing shows that a time is taken but never the title, notes, or
            location, and full-details sharing is a separate, reversible choice. Travel
            guidance is calculated inside Chronos-V and is not sent to a mapping provider.
          </p>
        </Section>

        <Section title="Your controls">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Pause or resume access for each connection at any time.</li>
            <li>Delete imported copies from a connection without changing the originals.</li>
            <li>Disconnect Google or Microsoft entirely in your account settings.</li>
            <li>Reset or turn off the optional learning statistics.</li>
            <li>Export your plan as an iCalendar (.ics) file.</li>
            <li>
              Delete your account and all associated data yourself — see the next section.
            </li>
          </ul>
        </Section>

        <Section title="Delete your account">
          <p>
            You can permanently delete your account and everything stored with it at any
            time. Sign in, open{" "}
            <Link to="/settings" className="font-medium text-foreground underline underline-offset-2">
              Settings
            </Link>
            , choose <span className="font-medium text-foreground">Delete account</span>, and
            confirm. This immediately erases your appointments, tasks, routines, plans,
            reminders, learning data, connection settings, and uploaded documents. Originals
            in your Google or Microsoft accounts are not affected. Deletion cannot be undone.
          </p>
          <p>
            If you cannot sign in, email{" "}
            <a
              href="mailto:privacy@verolane.online"
              className="font-medium text-foreground underline underline-offset-2"
            >
              privacy@verolane.online
            </a>{" "}
            from the address on the account and we will process the deletion for you.
          </p>
        </Section>

        <Section title="Data retention and location">
          <p>
            We keep your data while your account is active. Sync activity logs are short-lived,
            and dismissed suggestion identifiers are removed after 30 days. Data is stored on
            our managed cloud infrastructure and is not sold or shared with advertisers.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Chronos-V is not directed at children under 13, and we do not knowingly collect
            their personal information.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If we make material changes, we will update this page and revise the date above.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions, deletion requests, or data requests: email{" "}
            <a
              href="mailto:privacy@verolane.online"
              className="font-medium text-foreground underline underline-offset-2"
            >
              privacy@verolane.online
            </a>
            .
          </p>
          <p>
            See also our{" "}
            <Link to="/terms" className="font-medium text-foreground underline underline-offset-2">
              Terms of service
            </Link>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
