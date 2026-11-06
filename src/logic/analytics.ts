/**
 * Аналитика продуктивности. Чистые функции над доменными данными.
 *
 * Все формулы задокументированы. Если данных недостаточно, соответствующий
 * показатель возвращает null — UI показывает честное сообщение вместо
 * выдуманного значения.
 *
 * Формулы:
 * - completionRate (процент выполнения) = выполнено задач с дедлайном в периоде
 *   / всего задач с дедлайном в периоде. Считаются задачи, у которых дедлайн
 *   попал в период; «выполнена» — статус done на момент расчёта.
 * - focusMinutes = сумма active_seconds учебных сессий, начатых в периоде (мин).
 * - plannedVsActual.ratio = сумма фактических минут / сумма плановых минут
 *   для задач, выполненных в периоде и имеющих измеренное фактическое время.
 * - deferRate = суммарное число переносов дедлайна / число задач,
 *   созданных в периоде (задачи без переносов дают 0).
 * - dayLoad.ratio = (минуты занятий дня + плановые минуты задач дня)
 *   / ёмкость учебного окна дня.
 */
import {
  DAY_MS,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfMonth,
  addDays,
  isSameDay,
} from '../core/time';
import { busyMinutesForDay } from './conflicts';
import type {
  CalendarEvent,
  Goal,
  StudySession,
  Subject,
  Task,
  UserSettings,
} from '../models/types';

export type StatsPeriodKind = 'week' | 'month' | 'all' | '7d' | '30d';

export interface Period {
  start: number;
  end: number;
  label: string;
}

export function resolvePeriod(kind: StatsPeriodKind, now: number, weekStart: 0 | 1): Period {
  switch (kind) {
    case 'week':
      return { start: startOfWeek(now, weekStart), end: endOfWeek(now, weekStart), label: 'Эта неделя' };
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now), label: 'Этот месяц' };
    case '7d':
      return { start: startOfDay(addDays(now, -6)), end: now, label: '7 дней' };
    case '30d':
      return { start: startOfDay(addDays(now, -29)), end: now, label: '30 дней' };
    case 'all':
      return { start: 0, end: Number.MAX_SAFE_INTEGER, label: 'Всё время' };
  }
}

export interface SubjectSlice {
  subjectId: string | null;
  name: string;
  color: string;
  minutes: number;
}

export interface DailyPoint {
  day: number;
  focusMinutes: number;
  completedTasks: number;
}

export interface ProgressStats {
  period: Period;
  completedCount: number;
  dueCount: number;
  completedAmongDue: number;
  /** 0..100 или null, если задач с дедлайном в периоде не было. */
  completionRate: number | null;
  overdueCount: number;
  focusMinutes: number;
  sessionsCount: number;
  avgSessionMinutes: number | null;
  bySubject: SubjectSlice[];
  daily: DailyPoint[];
  plannedVsActual: {
    plannedMinutes: number;
    actualMinutes: number;
    ratio: number | null;
    sampleSize: number;
  };
  deferStats: {
    totalDefers: number;
    tasksCreated: number;
    deferRate: number | null;
  };
  hasAnyData: boolean;
}

export function computeProgressStats(params: {
  tasks: Task[];
  sessions: StudySession[];
  subjects: Subject[];
  period: Period;
  now: number;
  weekStart: 0 | 1;
  dailyPoints?: '7d' | '30d';
}): ProgressStats {
  const { tasks, sessions, subjects, period, now, weekStart } = params;
  const inPeriod = (ts: number | null | undefined): boolean =>
    ts != null && ts >= period.start && ts <= period.end;

  const dueTasks = tasks.filter((t) => inPeriod(t.deadlineAt));
  const completedAmongDue = dueTasks.filter((t) => t.status === 'done').length;
  const completedTasks = tasks.filter((t) => inPeriod(t.completedAt));
  const overdue = tasks.filter(
    (t) => t.status !== 'done' && t.deadlineAt != null && t.deadlineAt < now
  );
  const periodSessions = sessions.filter((s) => inPeriod(s.startedAt));
  const focusMinutes = periodSessions.reduce((sum, s) => sum + s.activeSeconds / 60, 0);

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const bySubjectMap = new Map<string | null, number>();
  for (const s of periodSessions) {
    const key = s.subjectId ?? null;
    bySubjectMap.set(key, (bySubjectMap.get(key) ?? 0) + s.activeSeconds / 60);
  }
  const bySubject: SubjectSlice[] = [...bySubjectMap.entries()]
    .map(([subjectId, minutes]) => {
      const subject = subjectId ? subjectById.get(subjectId) : null;
      return {
        subjectId,
        name: subject ? subject.name : 'Без предмета',
        color: subject ? subject.color : '#8A91A5',
        minutes: Math.round(minutes),
      };
    })
    .sort((a, b) => b.minutes - a.minutes);

  // Дневная динамика
  const pointsKind = params.dailyPoints ?? '7d';
  const days = pointsKind === '30d' ? 30 : 7;
  const daily: DailyPoint[] = [];
  const firstDay = startOfDay(addDays(now, -(days - 1)));
  for (let i = 0; i < days; i += 1) {
    const day = addDays(firstDay, i);
    const dayEnd = day + DAY_MS;
    daily.push({
      day,
      focusMinutes: Math.round(
        sessions
          .filter((s) => s.startedAt >= day && s.startedAt < dayEnd)
          .reduce((sum, s) => sum + s.activeSeconds / 60, 0)
      ),
      completedTasks: tasks.filter(
        (t) => t.completedAt != null && t.completedAt >= day && t.completedAt < dayEnd
      ).length,
    });
  }

  // План/факт — только по выполненным в периоде задачам с измеренным временем
  const measured = completedTasks.filter((t) => t.actualMinutes > 0);
  const plannedMinutes = measured.reduce((s, t) => s + t.plannedMinutes, 0);
  const actualMinutes = measured.reduce((s, t) => s + t.actualMinutes, 0);

  // Переносы — по задачам, созданным в периоде
  const createdInPeriod = tasks.filter((t) => inPeriod(t.createdAt));
  const totalDefers = createdInPeriod.reduce((s, t) => s + t.deferCount, 0);

  const hasAnyData =
    tasks.length > 0 || sessions.length > 0;

  return {
    period,
    completedCount: completedTasks.length,
    dueCount: dueTasks.length,
    completedAmongDue,
    completionRate: dueTasks.length > 0 ? Math.round((completedAmongDue / dueTasks.length) * 100) : null,
    overdueCount: overdue.length,
    focusMinutes: Math.round(focusMinutes),
    sessionsCount: periodSessions.length,
    avgSessionMinutes:
      periodSessions.length > 0
        ? Math.round(focusMinutes / periodSessions.length)
        : null,
    bySubject,
    daily,
    plannedVsActual: {
      plannedMinutes,
      actualMinutes,
      ratio: plannedMinutes > 0 && measured.length > 0 ? actualMinutes / plannedMinutes : null,
      sampleSize: measured.length,
    },
    deferStats: {
      totalDefers,
      tasksCreated: createdInPeriod.length,
      deferRate: createdInPeriod.length > 0 ? totalDefers / createdInPeriod.length : null,
    },
    hasAnyData,
  };
}

/* ---------------------------------- Главная ---------------------------------- */

export type DayLoadLevel = 'free' | 'moderate' | 'busy' | 'overload';

export interface DayLoadInfo {
  scheduledMinutes: number;
  taskMinutes: number;
  capacityMinutes: number;
  ratio: number;
  level: DayLoadLevel;
}

/**
 * Загруженность дня.
 * capacity = полное учебное окно дня (настройки пользователя).
 * load = занятость событиями (склеенная, без двойного счёта) + плановые минуты
 * незавершённых задач с дедлайном в этот день или запланированных на него.
 */
export function computeDayLoad(
  dayEvents: CalendarEvent[],
  dayTasks: Task[],
  settings: UserSettings,
  dayTs: number
): DayLoadInfo {
  const dayStart = startOfDay(dayTs);
  const scheduledMinutes = busyMinutesForDay(dayEvents, dayStart);
  // Задачи, у которых на этот день уже есть учебные блоки, учтены в scheduledMinutes
  // через события — второй раз их плановые минуты не добавляем.
  const tasksWithBlocks = new Set(
    dayEvents.filter((e) => e.kind === 'study' && e.taskId != null).map((e) => e.taskId as string)
  );
  const taskMinutes = dayTasks
    .filter((t) => t.status !== 'done' && !tasksWithBlocks.has(t.id))
    .reduce((sum, t) => {
      const dueToday = t.deadlineAt != null && isSameDay(t.deadlineAt, dayStart);
      const schedToday = t.scheduledStartAt != null && isSameDay(t.scheduledStartAt, dayStart);
      return dueToday || schedToday ? sum + t.plannedMinutes : sum;
    }, 0);
  const capacityMinutes = Math.max(0, settings.studyWindowEndMin - settings.studyWindowStartMin);
  const ratio = capacityMinutes > 0 ? (scheduledMinutes + taskMinutes) / capacityMinutes : 0;
  const level: DayLoadLevel =
    ratio > 1.05 ? 'overload' : ratio > 0.8 ? 'busy' : ratio >= 0.5 ? 'moderate' : 'free';
  return { scheduledMinutes, taskMinutes, capacityMinutes, ratio, level };
}

export const DAY_LOAD_LABELS: Record<DayLoadLevel, string> = {
  free: 'Свободный день',
  moderate: 'Умеренная загрузка',
  busy: 'Плотный день',
  overload: 'Перегруз — рекомендуем перепланировать',
};

/* ---------------------------------- Цели ---------------------------------- */

export interface GoalProgress {
  goal: Goal;
  current: number;
  target: number;
  /** 0..1+, null — если период цели не определён. */
  progress: number | null;
  periodLabel: string;
}

export function computeGoalProgress(
  goals: Goal[],
  sessions: StudySession[],
  tasks: Task[],
  now: number,
  weekStart: 0 | 1
): GoalProgress[] {
  return goals.map((goal) => {
    let start: number;
    let end: number;
    let label: string;
    if (goal.period === 'week') {
      start = startOfWeek(now, weekStart);
      end = endOfWeek(now, weekStart);
      label = 'Неделя';
    } else if (goal.period === 'month') {
      start = startOfMonth(now);
      end = endOfMonth(now);
      label = 'Месяц';
    } else {
      start = goal.periodStartAt ?? now;
      end = goal.periodEndAt ?? now;
      label = 'Семестр';
    }
    const inRange = (ts: number | null | undefined) => ts != null && ts >= start && ts <= end;
    const matchesSubject = (subjectId: string | null) =>
      goal.subjectId == null || subjectId === goal.subjectId;

    let current: number;
    if (goal.metric === 'study_minutes') {
      current = Math.round(
        sessions
          .filter((s) => inRange(s.startedAt) && matchesSubject(s.subjectId))
          .reduce((sum, s) => sum + s.activeSeconds / 60, 0)
      );
    } else {
      current = tasks.filter((t) => {
        if (!inRange(t.completedAt)) return false;
        if (goal.subjectId == null) return true;
        return t.subjectId === goal.subjectId;
      }).length;
    }
    return {
      goal,
      current,
      target: goal.targetValue,
      progress: goal.targetValue > 0 ? Math.min(current / goal.targetValue, 1.5) : null,
      periodLabel: label,
    };
  });
}
