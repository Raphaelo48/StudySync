/**
 * Глобальное состояние учебного таймера.
 *
 * Источник истины — сохранённые метки времени (таблица timer_state), а не
 * тики в памяти: состояние корректно восстанавливается после сворачивания
 * и даже полного закрытия приложения (пересчёт через advanceTimer).
 * Секундный интервал используется только для перерисовки UI.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { useDatabase, useSettings } from './AppContexts';
import {
  IDLE_TIMER_STATE,
  type TimerState,
  type SessionMode,
} from '../models/types';
import {
  advanceTimer,
  msUntilPhaseEnd,
  pauseTimer,
  resumeTimer,
  skipBreak as skipBreakModel,
  startTimer,
  timerView,
  type StartTimerParams,
  type TimerView,
} from '../logic/timerModel';
import { finishTimerSession, type FinishSessionResult } from '../logic/sessionService';
import { getNotificationClient } from '../notifications/client';
import {
  cancelTimerPhaseNotification,
  scheduleTimerPhaseNotification,
} from '../notifications/scheduler';
import { logger } from '../core/logger';

interface TimerContextValue {
  state: TimerState;
  view: TimerView;
  /** Тики «сейчас» — обновляется раз в секунду при работе таймера. */
  now: number;
  restoring: boolean;
  isActive: boolean;
  start(params: { mode: SessionMode; taskId?: string | null; subjectId?: string | null }): Promise<void>;
  startWithDurations(params: StartTimerParams): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  skipBreak(): Promise<void>;
  finish(): Promise<FinishSessionResult | null>;
  discard(): Promise<void>;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const { settings } = useSettings();
  const [state, setState] = useState<TimerState>(IDLE_TIMER_STATE);
  const [now, setNow] = useState<number>(() => Date.now());
  const [restoring, setRestoring] = useState(true);
  const stateRef = useRef<TimerState>(IDLE_TIMER_STATE);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const persist = useCallback(
    async (next: TimerState) => {
      stateRef.current = next;
      setState(next);
      try {
        await db.timer.save(next);
      } catch (e) {
        logger.error('timer', 'Не удалось сохранить состояние таймера', e);
      }
    },
    [db]
  );

  /** Восстановление при старте приложения. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = await db.timer.get(IDLE_TIMER_STATE);
        if (cancelled) return;
        const advanced = advanceTimer(restored, Date.now());
        stateRef.current = advanced;
        setState(advanced);
        if (advanced !== restored) await db.timer.save(advanced);
      } catch (e) {
        logger.error('timer', 'Ошибка восстановления таймера', e);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  /** Секундный тик только когда таймер идёт. */
  const running = state.status === 'running';
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  /** Пересчёт при возврате приложения на передний план. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') {
        const ts = Date.now();
        setNow(ts);
        const advanced = advanceTimer(stateRef.current, ts);
        if (advanced !== stateRef.current) {
          void persist(advanced);
        }
      }
    });
    return () => sub.remove();
  }, [persist]);

  /** Уведомление о завершении текущей фазы (когда приложение в фоне). */
  const syncPhaseNotification = useCallback(
    async (next: TimerState) => {
      const client = getNotificationClient();
      try {
        if (next.status !== 'running' || next.phase === 'none') {
          await cancelTimerPhaseNotification(client);
          return;
        }
        const ts = Date.now();
        const msLeft = msUntilPhaseEnd(next, ts);
        if (msLeft == null) {
          await cancelTimerPhaseNotification(client);
          return;
        }
        await scheduleTimerPhaseNotification(client, settingsRef.current, next.phase, ts + msLeft, ts);
      } catch (e) {
        logger.warn('timer', 'Не удалось синхронизировать уведомление фазы', { e });
      }
    },
    []
  );

  const startWithDurations = useCallback(
    async (params: StartTimerParams) => {
      const ts = Date.now();
      const next = startTimer(stateRef.current, params, ts);
      setNow(ts);
      await persist(next);
      await syncPhaseNotification(next);
    },
    [persist, syncPhaseNotification]
  );

  const start = useCallback(
    async (params: { mode: SessionMode; taskId?: string | null; subjectId?: string | null }) => {
      const s = settingsRef.current;
      await startWithDurations({
        mode: params.mode,
        taskId: params.taskId ?? null,
        subjectId: params.subjectId ?? null,
        workSec: s.defaultWorkMin * 60,
        breakSec: s.defaultBreakMin * 60,
        longBreakSec: s.defaultLongBreakMin * 60,
        cyclesBeforeLongBreak: s.cyclesBeforeLongBreak,
      });
    },
    [startWithDurations]
  );

  const pause = useCallback(async () => {
    const ts = Date.now();
    const next = pauseTimer(advanceTimer(stateRef.current, ts), ts);
    await persist(next);
    await cancelTimerPhaseNotification(getNotificationClient());
  }, [persist]);

  const resume = useCallback(async () => {
    const ts = Date.now();
    const next = resumeTimer(advanceTimer(stateRef.current, ts), ts);
    setNow(ts);
    await persist(next);
    await syncPhaseNotification(next);
  }, [persist, syncPhaseNotification]);

  const skipBreak = useCallback(async () => {
    const ts = Date.now();
    const next = skipBreakModel(advanceTimer(stateRef.current, ts), ts);
    await persist(next);
    await cancelTimerPhaseNotification(getNotificationClient());
  }, [persist]);

  const finish = useCallback(async (): Promise<FinishSessionResult | null> => {
    const ts = Date.now();
    const advanced = advanceTimer(stateRef.current, ts);
    try {
      const result = await finishTimerSession(db, advanced, ts);
      stateRef.current = IDLE_TIMER_STATE;
      setState(IDLE_TIMER_STATE);
      await cancelTimerPhaseNotification(getNotificationClient());
      return result;
    } catch (e) {
      logger.error('timer', 'Ошибка завершения сессии', e);
      return null;
    }
  }, [db]);

  const discard = useCallback(async () => {
    const idle: TimerState = { ...IDLE_TIMER_STATE, updatedAt: Date.now() };
    stateRef.current = idle;
    setState(idle);
    await db.timer.reset(idle);
    await cancelTimerPhaseNotification(getNotificationClient());
  }, [db]);

  const view = useMemo(() => timerView(state, now), [state, now]);
  const value = useMemo<TimerContextValue>(
    () => ({
      state,
      view,
      now,
      restoring,
      isActive: state.status !== 'idle' && state.phase !== 'none',
      start,
      startWithDurations,
      pause,
      resume,
      skipBreak,
      finish,
      discard,
    }),
    [state, view, now, restoring, start, startWithDurations, pause, resume, skipBreak, finish, discard]
  );

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimer вне TimerProvider');
  return ctx;
}

/** Безопасный доступ для экранов, где таймер может отсутствовать (тесты). */
export function useTimerSafe(): TimerContextValue | null {
  return useContext(TimerContext);
}
