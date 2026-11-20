/**
 * English dictionary. Mirrors the shape of `ru.ts`; missing keys fall back to Russian.
 */
export const en = {
  tabs: {
    home: 'Home',
    schedule: 'Schedule',
    tasks: 'Tasks',
    progress: 'Progress',
    profile: 'Profile',
  },
  common: {
    minShort: 'min',
    dayShort: 'days',
    saving: 'Saving…',
    invalidValue: 'Invalid value',
  },
  settings: {
    title: 'Settings',
    sections: {
      notifications: 'Notifications',
      kgeu: 'KGEU schedule',
      sessions: 'Study sessions',
      planning: 'Planning',
      app: 'App',
    },
    language: {
      title: 'Language',
      system: 'System',
      ru: 'Русский',
      en: 'English',
      hint: 'Interface language. "System" follows your device. Schedule and your own notes are never translated.',
    },
    notifications: {
      reminders: 'Reminders',
      remindersHint: 'On-device notifications, no server involved',
      lesson: 'At lesson start',
      lessonBefore: 'Remind me before a lesson',
      deadline: 'Before a deadline',
      deadlineBefore: 'Remind me before a deadline',
      session: 'When a focus phase ends',
      sessionHint: 'When a pomodoro finishes while the app is in the background',
      break: 'When a break ends',
      digest: 'Morning summary',
      digestHint:
        'Lessons, deadlines and retakes for the day. On days without lessons — only if there are deadlines',
      digestTime: 'Summary time',
      deliveryNote:
        'Delivery depends on OS settings (battery savers and Do Not Disturb can delay notifications). We never send anything to a server.',
      enabledToast: 'Reminders enabled',
      saveError: 'Could not save the setting',
      unsupported: 'Local notifications are not supported in this environment.',
      denied:
        'The OS denied notification permission. Enable them in system settings, then try again here. The app keeps working without reminders.',
      unknown: 'Could not get notification permission. Try again later in system settings.',
    },
    kgeu: {
      autoSync: 'Update group schedule on launch',
      autoSyncHintOn: 'Group %{group}: at most once every 6 hours%{last}',
      autoSyncLast: ', last updated %{date} at %{time}',
      autoSyncHintOff: "Available after importing your group's schedule",
    },
    sessions: {
      work: 'Default focus length',
      shortBreak: 'Short break',
      longBreak: 'Long break',
      cycles: 'Cycles before a long break',
    },
    planning: {
      weekStart: 'Week starts on',
      monday: 'Monday',
      sunday: 'Sunday',
      windowStart: 'Study window: start',
      windowEnd: 'Study window: end',
      windowHint: 'The rescheduler places tasks only inside this window.',
      breakBetween: 'Break between tasks in the plan',
      horizon: 'Planning horizon',
      dailyGoal: 'Daily focus goal',
    },
  },
};
