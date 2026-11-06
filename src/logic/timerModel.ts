/**
 * Чистая модель учебного таймера.
 *
 * Принципы:
 * - Состояние полностью восстанавливается по сохранённым меткам времени
 *   (phaseStartedAt + накопленные миллисекунды). Частые тики в памяти НЕ являются
 *   источником истины: UI лишь перечитывает вычисленное состояние.
 * - Время на паузе не считается активным.
 * - Фазы не «накручиваются» фиктивно: если приложение было закрыто и фаза работы
 *   завершилась, завершённая фаза фиксируется, следующая фаза наступает,
 *   а ещё одна новая рабочая фаза автоматически НЕ стартует — таймер переходит
 *   в состояние «пауза» и ждёт явного действия пользователя.
 * - Все функции детерминированы: (state, now) → результат.
 */
import type { SessionMode, TimerState } from '../models/types';

export const MAX_FAST_FORWARD_TRANSITIONS = 8;

/** Длительность запланированной фазы в мс (для stopwatch — Infinity). */
export function plannedPhaseMs(state: TimerState): number {
  if (state.mode === 'stopwatch') return Number.POSITIVE_INFINITY;
  if (state.phase === 'work') return state.plannedWorkSec * 1000;
  if (state.phase === 'break') {
    const isLong =
      state.cyclesBeforeLongBreak > 0 &&
      state.workIndex > 0 &&
      state.workIndex % state.cyclesBeforeLongBreak === 0;
    return (isLong ? state.plannedLongBreakSec : state.plannedBreakSec) * 1000;
  }
  return 0;
}

/** Сколько миллисекунд текущей фазы уже накоплено (завершённые отрезки после пауз). */
export interface TimerCommitInfo {
  /** мс текущей фазы, зафиксированные до текущего отрезка. */
  committedPhaseMs: number;
}

/**
 * Накопленный прогресс текущей фазы.
 *
 * Для work-фазы: накопленное рабочее время minus время всех ЗАВЕРШЁННЫХ предыдущих
 * циклов. Чтобы не хранить отдельное поле, мы выводим его так:
 * accumulatedWorkMs включает завершённые циклы + закоммиченные части текущей фазы.
 * Прогресс текущей фазы = accumulatedWorkMs - workIndex * plannedWorkMs (+ отрезок).
 */
export function currentPhaseElapsedMs(state: TimerState, now: number): number {
  const runningPart =
    state.status === 'running' && state.phaseStartedAt != null
      ? Math.max(0, now - state.phaseStartedAt)
      : 0;
  if (state.phase === 'work') {
    const completedCyclesMs = state.workIndex * state.plannedWorkSec * 1000;
    return Math.max(0, state.accumulatedWorkMs - completedCyclesMs) + runningPart;
  }
  if (state.phase === 'break') {
    // Для перерыва accumulatedBreakMs включает только закоммиченное текущее
    // состояние перерыва (перерывы не суммируются между циклами — см. commit).
    return Math.max(0, state.accumulatedBreakMs) + runningPart;
  }
  return runningPart;
}

export interface TimerView {
  status: TimerState['status'];
  mode: SessionMode;
  phase: TimerState['phase'];
  /** Прогресс текущей фазы, мс. */
  phaseElapsedMs: number;
  /** План текущей фазы, мс; для stopwatch — null. */
  phasePlannedMs: number | null;
  /** Остаток фазы, мс; для stopwatch — null. */
  phaseRemainingMs: number | null;
  /** Суммарное активное рабочее время всей сессии, мс (включая текущую фазу). */
  totalWorkMs: number;
  totalBreakMs: number;
  /** Завершено рабочих циклов (помидоров). */
  completedCycles: number;
  sessionStartedAt: number | null;
  taskId: string | null;
  subjectId: string | null;
  /** Фаза работы завершилась, ждём старта следующей (авто-пауза после перерыва). */
  awaitingNextCycle: boolean;
}

export function timerView(state: TimerState, now: number): TimerView {
  const advanced = advanceTimer(state, now);
  const planned = plannedPhaseMs(advanced);
  const elapsed = currentPhaseElapsedMs(advanced, now);
  const totalWorkMs =
    advanced.accumulatedWorkMs +
    (advanced.phase === 'work' && advanced.status === 'running' && advanced.phaseStartedAt != null
      ? Math.max(0, now - advanced.phaseStartedAt)
      : 0);
  const totalBreakMs =
    (advanced.completedBreakMs ?? 0) +
    (advanced.phase === 'break' ? advanced.accumulatedBreakMs : 0) +
    (advanced.phase === 'break' && advanced.status === 'running' && advanced.phaseStartedAt != null
      ? Math.max(0, now - advanced.phaseStartedAt)
      : 0);
  return {
    status: advanced.status,
    mode: advanced.mode,
    phase: advanced.phase,
    phaseElapsedMs: elapsed,
    phasePlannedMs: Number.isFinite(planned) ? planned : null,
    phaseRemainingMs: Number.isFinite(planned) ? Math.max(0, planned - elapsed) : null,
    totalWorkMs,
    totalBreakMs,
    completedCycles: advanced.workIndex,
    sessionStartedAt: advanced.sessionStartedAt,
    taskId: advanced.taskId,
    subjectId: advanced.subjectId,
    awaitingNextCycle: advanced.phase === 'work' && advanced.status === 'paused' && advanced.workIndex > 0 &&
      // «ждём старта» только если пауза возникла автопереходом, а не вручную:
      // различаем по тому, что накоплено ровно полных циклов и текущая фаза не начата
      elapsed === 0,
  };
}

/**
 * Продвинуть состояние таймера до момента `now` (fast-forward).
 *
 * Правила:
 * - paused/idle — время не начисляется, состояние не меняется.
 * - running work (pomodoro): если фаза завершилась — зафиксировать цикл,
 *   перейти в перерыв (start = момент завершения work-фазы).
 * - running break: если перерыв завершился — зафиксировать, перейти в work,
 *   но в статусе paused (новый цикл не стартует без пользователя).
 * - stopwatch: одна бесконечная work-фаза, никаких переходов.
 */
export function advanceTimer(state: TimerState, now: number): TimerState {
  if (state.status !== 'running' || state.phaseStartedAt == null) return state;
  if (state.mode === 'stopwatch') return state;

  let current: TimerState = state;
  for (let i = 0; i < MAX_FAST_FORWARD_TRANSITIONS; i += 1) {
    const planned = plannedPhaseMs(current);
    if (!Number.isFinite(planned)) return current;
    const elapsed = currentPhaseElapsedMs(current, now);
    if (elapsed < planned) return current;

    if (current.phase === 'work') {
      const startedAt = current.phaseStartedAt;
      if (startedAt == null) return current;
      // Завершить рабочий цикл: накопленное = полные циклы (без «хвоста» пауз).
      const committedTotal = current.workIndex * current.plannedWorkSec * 1000 + planned;
      const phaseEnd = startedAt + Math.max(0, planned - phaseCommittedMs(current));
      current = {
        ...current,
        accumulatedWorkMs: committedTotal,
        workIndex: current.workIndex + 1,
        phase: 'break',
        phaseStartedAt: phaseEnd,
        accumulatedBreakMs: 0,
        updatedAt: now,
      };
      // Если перерыв нулевой — сразу завершаем его.
      if (plannedPhaseMs(current) === 0) {
        current = { ...current, phase: 'work', phaseStartedAt: null, status: 'paused', accumulatedBreakMs: 0 };
        return current;
      }
      // Перерыв тоже мог завершиться, пока приложение было закрыто.
      const breakPlanned = plannedPhaseMs(current);
      if (current.phaseStartedAt != null && now - current.phaseStartedAt >= breakPlanned) {
        current = {
          ...current,
          accumulatedBreakMs: 0,
          completedBreakMs: (current.completedBreakMs ?? 0) + breakPlanned,
          phase: 'work',
          phaseStartedAt: null,
          status: 'paused',
          updatedAt: now,
        };
        return current;
      }
      return current;
    }

    if (current.phase === 'break') {
      const breakPlanned = plannedPhaseMs(current);
      current = {
        ...current,
        accumulatedBreakMs: 0,
        completedBreakMs: (current.completedBreakMs ?? 0) + breakPlanned,
        phase: 'work',
        phaseStartedAt: null,
        status: 'paused',
        updatedAt: now,
      };
      return current;
    }
    return current;
  }
  return current;
}

/** Мс текущей фазы, закоммиченные до текущего running-отрезка. */
function phaseCommittedMs(state: TimerState): number {
  if (state.phase === 'work') {
    return Math.max(0, state.accumulatedWorkMs - state.workIndex * state.plannedWorkSec * 1000);
  }
  if (state.phase === 'break') return Math.max(0, state.accumulatedBreakMs);
  return 0;
}

/* ---------------------------------- Переходы ---------------------------------- */

export interface StartTimerParams {
  mode: SessionMode;
  taskId?: string | null;
  subjectId?: string | null;
  workSec: number;
  breakSec: number;
  longBreakSec: number;
  cyclesBeforeLongBreak: number;
}

/** Начать новую сессию (или перезапустить). */
export function startTimer(state: TimerState, params: StartTimerParams, now: number): TimerState {
  return {
    ...state,
    status: 'running',
    mode: params.mode,
    phase: 'work',
    taskId: params.taskId ?? null,
    subjectId: params.subjectId ?? null,
    phaseStartedAt: now,
    workIndex: 0,
    accumulatedWorkMs: 0,
    accumulatedBreakMs: 0,
    completedBreakMs: 0,
    plannedWorkSec: Math.max(1, params.workSec),
    plannedBreakSec: Math.max(0, params.breakSec),
    plannedLongBreakSec: Math.max(0, params.longBreakSec),
    cyclesBeforeLongBreak: Math.max(1, params.cyclesBeforeLongBreak),
    sessionStartedAt: now,
    updatedAt: now,
  };
}

/** Пауза: зафиксировать текущий отрезок, не теряя прогресс фазы. */
export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.status !== 'running' || state.phaseStartedAt == null) return state;
  const segment = Math.max(0, now - state.phaseStartedAt);
  const patch: Partial<TimerState> = {
    status: 'paused',
    phaseStartedAt: null,
    updatedAt: now,
  };
  if (state.phase === 'work') {
    patch.accumulatedWorkMs = state.accumulatedWorkMs + segment;
  } else if (state.phase === 'break') {
    patch.accumulatedBreakMs = state.accumulatedBreakMs + segment;
  }
  return { ...state, ...patch };
}

/** Продолжить текущую фазу. */
export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.status !== 'paused') return state;
  if (state.phase === 'none') return state;
  return { ...state, status: 'running', phaseStartedAt: now, updatedAt: now };
}

/** Пропустить текущий перерыв → пауза перед следующим рабочим циклом. */
export function skipBreak(state: TimerState, now: number): TimerState {
  if (state.phase !== 'break') return state;
  const advanced = state.status === 'running' ? pauseTimer(state, now) : state;
  return {
    ...advanced,
    status: 'paused',
    phase: 'work',
    phaseStartedAt: null,
    // Отгулянная часть перерыва попадает в итог сессии.
    accumulatedBreakMs: 0,
    completedBreakMs: (advanced.completedBreakMs ?? 0) + advanced.accumulatedBreakMs,
    updatedAt: now,
  };
}

export interface SessionSummary {
  activeSeconds: number;
  breakSeconds: number;
  completedCycles: number;
  startedAt: number;
  endedAt: number;
  /** Считать ли сессию «завершённой» (был ли закончен хотя бы один полный цикл). */
  completed: boolean;
  /** Меньше минуты активной работы — фиксировать нечего. */
  worthSaving: boolean;
}

/** Итоги сессии в момент завершения (включая текущий незакоммиченный отрезок). */
export function summarizeSession(state: TimerState, now: number): SessionSummary {
  const advanced = state.status === 'running' ? commitRunningSegment(state, now) : state;
  const activeSeconds = Math.floor(advanced.accumulatedWorkMs / 1000);
  const currentBreakMs = advanced.phase === 'break' ? advanced.accumulatedBreakMs : 0;
  const breakSeconds = Math.floor(((advanced.completedBreakMs ?? 0) + currentBreakMs) / 1000);
  return {
    activeSeconds,
    breakSeconds,
    completedCycles: advanced.workIndex,
    startedAt: advanced.sessionStartedAt ?? now,
    endedAt: now,
    completed: advanced.workIndex > 0,
    worthSaving: activeSeconds >= 60,
  };
}

/** Зафиксировать текущий running-отрезок (используется при завершении сессии). */
export function commitRunningSegment(state: TimerState, now: number): TimerState {
  if (state.status !== 'running' || state.phaseStartedAt == null) return state;
  const segment = Math.max(0, now - state.phaseStartedAt);
  if (state.phase === 'work') {
    return { ...state, accumulatedWorkMs: state.accumulatedWorkMs + segment, phaseStartedAt: null, status: 'paused', updatedAt: now };
  }
  if (state.phase === 'break') {
    return { ...state, accumulatedBreakMs: state.accumulatedBreakMs + segment, phaseStartedAt: null, status: 'paused', updatedAt: now };
  }
  return { ...state, phaseStartedAt: null, status: 'paused', updatedAt: now };
}

/** Сколько миллисекунд осталось до конца текущей фазы (для планирования уведомления). */
export function msUntilPhaseEnd(state: TimerState, now: number): number | null {
  if (state.status !== 'running') return null;
  const planned = plannedPhaseMs(state);
  if (!Number.isFinite(planned)) return null;
  return Math.max(0, planned - currentPhaseElapsedMs(state, now));
}
