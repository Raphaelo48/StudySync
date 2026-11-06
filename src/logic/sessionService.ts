/**
 * Сервис учебных сессий: завершение таймера → запись StudySession,
 * обновление фактического времени задачи, сброс состояния таймера.
 *
 * Правила:
 * - Не создаём «фиктивные» сессии: меньше 60 секунд активной работы — не пишем.
 * - Время на паузе в активное не попадает (гарантируется timerModel).
 * - Запись сессии и обновление задачи — в одной транзакции.
 */
import type { AppDatabase } from '../db/database';
import type { ID, StudySession, TimerState } from '../models/types';
import { summarizeSession, type SessionSummary } from './timerModel';

export interface FinishSessionResult {
  saved: boolean;
  session: StudySession | null;
  summary: SessionSummary;
  reason?: string;
}

export async function finishTimerSession(
  db: AppDatabase,
  state: TimerState,
  now: number = Date.now()
): Promise<FinishSessionResult> {
  const summary = summarizeSession(state, now);

  if (!summary.worthSaving) {
    await db.timer.reset(
      {
        status: 'idle',
        mode: state.mode,
        phase: 'none',
        taskId: null,
        subjectId: null,
        phaseStartedAt: null,
        workIndex: 0,
        accumulatedWorkMs: 0,
        accumulatedBreakMs: 0,
        completedBreakMs: 0,
        plannedWorkSec: state.plannedWorkSec,
        plannedBreakSec: state.plannedBreakSec,
        plannedLongBreakSec: state.plannedLongBreakSec,
        cyclesBeforeLongBreak: state.cyclesBeforeLongBreak,
        sessionStartedAt: null,
        updatedAt: now,
      },
      now
    );
    return {
      saved: false,
      session: null,
      summary,
      reason: 'Меньше минуты активной работы — сессия не сохранена',
    };
  }

  // Задачу или предмет могли удалить, пока шла сессия: в памяти таймера ссылка
  // осталась, а в БД её уже нет. Сохраняем сессию без висячих ссылок.
  const taskId = state.taskId && (await db.tasks.get(state.taskId)) ? state.taskId : null;
  const subjectId = state.subjectId && (await db.subjects.get(state.subjectId)) ? state.subjectId : null;

  let session: StudySession | null = null;
  await db.driver.transaction(async () => {
    session = await db.sessions.create({
      taskId,
      subjectId,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      activeSeconds: summary.activeSeconds,
      breakSeconds: summary.breakSeconds,
      mode: state.mode,
      completed: summary.completed,
    });
    if (taskId) {
      const minutes = Math.round(summary.activeSeconds / 60);
      await db.tasks.addActualMinutes(taskId, minutes, now);
      const task = await db.tasks.get(taskId);
      if (task && task.status === 'planned') {
        await db.tasks.setStatus(task.id, 'in_progress', { now });
      }
    }
    await db.timer.reset(
      {
        status: 'idle',
        mode: state.mode,
        phase: 'none',
        taskId: null,
        subjectId: null,
        phaseStartedAt: null,
        workIndex: 0,
        accumulatedWorkMs: 0,
        accumulatedBreakMs: 0,
        completedBreakMs: 0,
        plannedWorkSec: state.plannedWorkSec,
        plannedBreakSec: state.plannedBreakSec,
        plannedLongBreakSec: state.plannedLongBreakSec,
        cyclesBeforeLongBreak: state.cyclesBeforeLongBreak,
        sessionStartedAt: null,
        updatedAt: now,
      },
      now
    );
  });

  return { saved: true, session: session as StudySession | null, summary };
}

/** Быстрый запуск сессии «без задачи» — только настройки. */
export function buildTimerStartParams(settings: {
  defaultWorkMin: number;
  defaultBreakMin: number;
  defaultLongBreakMin: number;
  cyclesBeforeLongBreak: number;
  mode?: 'pomodoro' | 'stopwatch';
  taskId?: ID | null;
  subjectId?: ID | null;
}) {
  return {
    mode: settings.mode ?? ('pomodoro' as const),
    taskId: settings.taskId ?? null,
    subjectId: settings.subjectId ?? null,
    workSec: Math.max(1, settings.defaultWorkMin) * 60,
    breakSec: Math.max(0, settings.defaultBreakMin) * 60,
    longBreakSec: Math.max(0, settings.defaultLongBreakMin) * 60,
    cyclesBeforeLongBreak: Math.max(1, settings.cyclesBeforeLongBreak),
  };
}
