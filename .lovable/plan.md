# Feature 3 — Deadline and capacity forecasting

## Goal
Tell the user, per deadline-bearing task and per day/week, whether the work fits the time they actually have — and warn early when it likely won't, with a realistic suggestion.

## What gets built

### 1. Capacity model (pure logic, tested)
- New `src/lib/capacity.ts`: computes available minutes per day from working hours, appointments, routines, and already-scheduled flexible blocks (reusing existing schedule-hub / routines sources).
- Demand: remaining estimated minutes per open task with a deadline (tasks without estimates get a sensible default from preferences).
- Output per task: `on_track | tight | at_risk | impossible` plus the gap in minutes and the first day the forecast turns red.

### 2. Forecast engine (server, authenticated)
- `src/lib/capacity.functions.ts` with `getCapacityForecast({ horizonDays })` (default 14): rolls the capacity model across the window, deterministic, timezone-explicit like the existing scheduler.
- Reuses existing task + schedule hub queries; no new data sources invented.

### 3. Early-warning UI
- "Capacity" card on Today and the dashboard: workload vs available time for today/this week, at-risk deadline list with the shortfall in hours, one-line recommendation ("move X" / "trim Y to 45 min").
- Amber/red badges on the Week Grid for overload days; task rows in the backlog show their forecast state.
- All warnings link to the existing planner/replan flow — consequential changes still go through preview + approve (no auto-moves).

### 4. Recommendations
- Per at-risk task, offer: re-scope (shorter estimate), re-deadline, or "find time" (jump into the existing smart scheduler filtered to that task).

### 5. No schema changes unless needed
- Audit first: if `tasks` already has estimate + deadline fields, no migration. Only if a durable field is missing, one additive migration with grants/RLS and advisor run.

### 6. Tests
- Pure capacity math: gaps, overlap with fixed blocks, timezone boundaries, tasks without deadlines, overload detection.
- Contract tests for the forecast server function shape.

## Constraints honored
- Verolane design, mobile-first, accessible.
- No auto-scheduling without consent; everything routes through existing preview/undo.
- No publish/deploy; commit to main only after checks (typecheck, full tests, build, lint baseline) pass.
