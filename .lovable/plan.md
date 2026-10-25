# Validate Chronos-V Outlook per-user OAuth

- Preserve the existing Outlook connection and unrelated generated authentication files.
- Confirm the linked workspace client and key presence without exposing values.
- Exercise signed-out and signed-in browser flows; start consent using the existing reviewer test account only. Stop at Microsoft login if genuine test-account consent is unavailable.
- Repair verified blockers for personal and Microsoft 365 account selection and expired-access handling.
- Add synthetic integration tests for per-user encrypted storage, one-time exchange, isolation, calendar sync, read-only mail, disconnect and native return handling.
- Run the automated suite and inspect harness typecheck/build results. Report real-provider and mocked outcomes separately; do not publish.

## Technical details
Use the existing App User Connector, authenticated server functions and encrypted connection storage. Requests retain User.Read, Calendars.ReadWrite, Mail.Read and offline_access, with no email mutation. Microsoft registration settings not exposed by workspace tools remain unverified.