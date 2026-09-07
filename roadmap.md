# Chronos-V roadmap

Work one milestone at a time. Wait for the user to say "next" before starting each
milestone after Feature 1. Audit and preserve existing implementations before
rebuilding anything.

## 1. Per-user Microsoft Outlook sync — DONE (verify/commit/push before moving on)

Connect / status / reconnect / disconnect, calendar selection, calendarView delta
sync with pagination + resync fallback, two-way create/update/delete, provider-isolated
dedupe and deletion queue, encrypted service-role-only connection key storage,
tests + migration + advisors verified.

## 2. Replan Preview + Undo — DONE

Preview proposed schedule changes before applying, explain why each item moves,
protect fixed commitments, selective approval per change, dependable undo and audit trail.

## 3. Deadline and capacity forecasting — DONE

Workload vs available time, early warning of likely misses/overload, realistic scope
or scheduling recommendations.

## 4. Learning from user decisions — DONE

Learn from accepted / rejected / moved / shortened / deferred / completed plans.
Explainable, reversible, private, user-controllable.

## 5. Mobile capture and notification actions — DONE

Fast natural-language capture; actionable notifications (done, snooze, reschedule,
accept plan, open navigation); safe sync and offline handling.

## 6. Native device calendars — DONE

Explicit read-only mobile permission, per-calendar selection, local preview before
upload, dependable refresh/deduplication, and deletion limited to Chronos-V copies.

## 7. Outlook Smart Inbox — DONE

User-initiated read-only Outlook email scans, approval before adding, provider-isolated
deduplication, independently pausable access, and deletion limited to Chronos-V copies.

## Capability list to preserve and complete over time

- Universal schedule hub: Google Calendar, Outlook, device calendars, Gmail/Outlook
  email detection, manual events, tasks, appointments, reminders, birthdays, recurring
  commitments in one timeline.
- AI Daily Planner from appointments, deadlines, priorities, travel time, working
  hours, energy preferences, available gaps.
- Automatic replanning of flexible work after misses/surprises, never disturbing
  fixed commitments.
- "What should I do now?" based on time available, priority, location, energy, deadlines.
- Smart Inbox detecting appointments, reservations, meetings, deliveries, school
  events, renewals, deadlines from email — always ask before adding.
- Natural-language capture ("Dentist Thursday at 2", "find 90 minutes this week for taxes").
- Task + calendar fusion: tasks get real time blocks.
- Conflict prevention with least-disruptive alternatives.
- Travel intelligence: routes, buffers, leave-by times.
- Personal routines: medication, exercise, school pickup, meals, chores, bills, pet
  care, birthdays, anniversaries.
- Shared/family scheduling without exposing private details.
- Adaptive reminders tuned to importance, travel, modality, next-day commitments.
- Weekly Reset: what happened, what slipped, capacity risks, proposed next week.
- Privacy controls: what is read, why, what is stored, independent disconnect/delete
  per connection or imported copy.

## Standing constraints

Verolane visual system on desktop and mobile; accessible interactions; consent plus
preview/undo for consequential actions; strong RLS / service-role boundaries;
provider-safe data isolation; no secret leakage; focused tests; migration + advisor
verification on schema changes; no deployment without explicit approval; never
rewrite published history.
