export type WelcomeProgressCounts = {
  profileCount: number;
  calendarSyncCount: number;
  importedCalendarEventCount: number;
  taskCount: number;
};

export type WelcomeProgress = {
  rhythmReady: boolean;
  calendarReady: boolean;
  taskCaptured: boolean;
  completed: number;
  total: 3;
};

export function summarizeWelcomeProgress(counts: WelcomeProgressCounts): WelcomeProgress {
  const rhythmReady = counts.profileCount > 0;
  const calendarReady = counts.calendarSyncCount > 0 || counts.importedCalendarEventCount > 0;
  const taskCaptured = counts.taskCount > 0;

  return {
    rhythmReady,
    calendarReady,
    taskCaptured,
    completed: [rhythmReady, calendarReady, taskCaptured].filter(Boolean).length,
    total: 3,
  };
}
