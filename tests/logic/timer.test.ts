/**
 * Сценарий 7: работа таймера, пауза и продолжение.
 * Плюс: восстановление состояния по меткам времени после «закрытия приложения»,
 * отсутствие фиктивных сессий, корректный учёт активного времени.
 */
import { openTestDb, fixedNow, seedBasicData } from '../support/helpers';
import {
  IDLE_TIMER_STATE,
  type TimerState,
} from '../../src/models/types';
import {
  advanceTimer,
  commitRunningSegment,
  currentPhaseElapsedMs,
  pauseTimer,
  resumeTimer,
  skipBreak,
  startTimer,
  summarizeSession,
  timerView,
} from '../../src/logic/timerModel';
import { finishTimerSession, buildTimerStartParams } from '../../src/logic/sessionService';
import { DEFAULT_SETTINGS } from '../../src/models/types';

const NOW = fixedNow();
const MIN = 60_000;

const POMODORO_PARAMS = {
  mode: 'pomodoro' as const,
  taskId: null,
  subjectId: null,
  workSec: 25 * 60,
  breakSec: 5 * 60,
  longBreakSec: 15 * 60,
  cyclesBeforeLongBreak: 4,
};

describe('Базовый цикл таймера (сценарий 7)', () => {
  it('старт → пауза → продолжение: активное время не включает паузу', () => {
    let s: TimerState = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    expect(s.status).toBe('running');
    expect(s.phase).toBe('work');

    // 10 минут работы
    s = pauseTimer(s, NOW + 10 * MIN);
    expect(s.status).toBe('paused');
    const view1 = timerView(s, NOW + 10 * MIN);
    expect(view1.totalWorkMs).toBe(10 * MIN);

    // Пауза 30 минут — не должна попасть в активное время
    const viewDuringPause = timerView(s, NOW + 40 * MIN);
    expect(viewDuringPause.totalWorkMs).toBe(10 * MIN);

    // Продолжаем ещё 5 минут
    s = resumeTimer(s, NOW + 40 * MIN);
    const view2 = timerView(s, NOW + 45 * MIN);
    expect(view2.totalWorkMs).toBe(15 * MIN);
    expect(view2.phaseElapsedMs).toBe(15 * MIN);
    expect(view2.phaseRemainingMs).toBe(10 * MIN);
  });

  it('несколько пауз в одной фазе суммируются корректно', () => {
    let s = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    s = pauseTimer(s, NOW + 5 * MIN); // 5 мин
    s = resumeTimer(s, NOW + 20 * MIN); // пауза 15 мин
    s = pauseTimer(s, NOW + 25 * MIN); // +5 мин
    s = resumeTimer(s, NOW + 100 * MIN); // длинная пауза
    const view = timerView(s, NOW + 105 * MIN); // +5 мин
    expect(view.totalWorkMs).toBe(15 * MIN);
  });

  it('автопереход работа → перерыв по меткам времени', () => {
    const s0 = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    // Приложение «пролежало» 26 минут
    const s1 = advanceTimer(s0, NOW + 26 * MIN);
    expect(s1.phase).toBe('break');
    expect(s1.workIndex).toBe(1);
    expect(s1.status).toBe('running');
    const view = timerView(s0, NOW + 26 * MIN);
    expect(view.totalWorkMs).toBe(25 * MIN); // ровно план, без накрутки
    expect(view.phaseElapsedMs).toBe(1 * MIN); // 1 минута перерыва
  });

  it('после перерыва новый цикл НЕ стартует автоматически (нет фиктивной работы)', () => {
    const s0 = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    // 25 мин работа + 5 мин перерыв + ещё 40 минут бездействия
    const view = timerView(s0, NOW + 70 * MIN);
    expect(view.status).toBe('paused');
    expect(view.phase).toBe('work');
    expect(view.completedCycles).toBe(1);
    // Активное время — только один завершённый цикл
    expect(view.totalWorkMs).toBe(25 * MIN);
    expect(view.awaitingNextCycle).toBe(true);
  });

  it('длинный перерыв после cyclesBeforeLongBreak циклов', () => {
    let s = startTimer(IDLE_TIMER_STATE, { ...POMODORO_PARAMS, cyclesBeforeLongBreak: 2, breakSec: 5 * 60, longBreakSec: 15 * 60 }, NOW);
    // Цикл 1: 25 работа + 5 перерыв
    s = advanceTimer(s, NOW + 25 * MIN); // → перерыв 5 мин
    s = advanceTimer(s, NOW + 30 * MIN); // → пауза перед циклом 2
    s = resumeTimer(s, NOW + 31 * MIN);
    s = advanceTimer(s, NOW + 31 * MIN + 25 * MIN); // цикл 2 завершён → длинный перерыв
    expect(s.phase).toBe('break');
    expect(s.workIndex).toBe(2);
    const view = timerView(s, NOW + 56 * MIN + 3 * MIN);
    // длинный перерыв 15 мин: через 3 минуты ещё идёт
    expect(view.phase).toBe('break');
    expect(view.status).toBe('running');
  });

  it('секундомер: бесконечная фаза, всё время — активное', () => {
    const s0 = startTimer(IDLE_TIMER_STATE, { ...POMODORO_PARAMS, mode: 'stopwatch' }, NOW);
    const view = timerView(s0, NOW + 93 * MIN);
    expect(view.phase).toBe('work');
    expect(view.status).toBe('running');
    expect(view.totalWorkMs).toBe(93 * MIN);
    expect(view.phaseRemainingMs).toBeNull();
  });

  it('пропуск перерыва переводит в паузу перед следующим циклом', () => {
    let s = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    s = advanceTimer(s, NOW + 26 * MIN); // перерыв
    s = skipBreak(s, NOW + 26 * MIN);
    expect(s.phase).toBe('work');
    expect(s.status).toBe('paused');
  });
});

describe('Итоги сессии и сохранение (без фиктивных данных)', () => {
  it('summarizeSession учитывает текущий незакоммиченный отрезок', () => {
    const s0 = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    const summary = summarizeSession(s0, NOW + 12 * MIN);
    expect(summary.activeSeconds).toBe(12 * 60);
    expect(summary.worthSaving).toBe(true);
    expect(summary.completed).toBe(false); // цикл не завершён
  });

  it('короткая сессия (<1 мин) не сохраняется', () => {
    const s0 = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    const summary = summarizeSession(s0, NOW + 30_000);
    expect(summary.worthSaving).toBe(false);
  });

  it('finishTimerSession сохраняет сессию и увеличивает фактическое время задачи', async () => {
    const { db } = await openTestDb();
    const { task1, math } = await seedBasicData(db, NOW);

    const state = startTimer(IDLE_TIMER_STATE, { ...POMODORO_PARAMS, taskId: task1.id, subjectId: math.id }, NOW);
    const result = await finishTimerSession(db, state, NOW + 30 * MIN);

    expect(result.saved).toBe(true);
    expect(result.summary.activeSeconds).toBe(30 * 60);
    expect(result.session?.taskId).toBe(task1.id);

    const task = await db.tasks.get(task1.id);
    expect(task?.actualMinutes).toBe(30);
    expect(task?.status).toBe('in_progress'); // planned → in_progress

    // Таймер сброшен
    const timerState = await db.timer.get(IDLE_TIMER_STATE);
    expect(timerState.status).toBe('idle');
  });

  it('короткая сессия не создаёт запись в БД (фиктивные сессии запрещены)', async () => {
    const { db } = await openTestDb();
    const state = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    const result = await finishTimerSession(db, state, NOW + 20_000);
    expect(result.saved).toBe(false);
    const sessions = await db.sessions.listRecent();
    expect(sessions.length).toBe(0);
  });

  it('сессия без активного времени отклоняется на уровне репозитория', async () => {
    const { db } = await openTestDb();
    await expect(
      db.sessions.create({ startedAt: NOW, endedAt: NOW + MIN, activeSeconds: 0 })
    ).rejects.toThrow();
  });
});

describe('Персистентность и восстановление таймера', () => {
  it('состояние восстанавливается из БД после «убийства» приложения', async () => {
    const { db } = await openTestDb();
    const state = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    await db.timer.save(state, NOW);

    // «Приложение перезапущено» через 10 минут — состояние читается из БД
    const restored = await db.timer.get(IDLE_TIMER_STATE);
    expect(restored.status).toBe('running');
    expect(restored.phaseStartedAt).toBe(NOW);

    const advanced = advanceTimer(restored, NOW + 10 * MIN);
    const view = timerView(advanced, NOW + 10 * MIN);
    expect(view.totalWorkMs).toBe(10 * MIN);
  });

  it('восстановление после долгого отсутствия: завершённые фазы фиксируются, лишние циклы не накручиваются', async () => {
    const { db } = await openTestDb();
    await db.timer.save(startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW), NOW);

    // Возврат через 3 часа
    const restored = await db.timer.get(IDLE_TIMER_STATE);
    const advanced = advanceTimer(restored, NOW + 180 * MIN);
    const view = timerView(advanced, NOW + 180 * MIN);

    expect(view.completedCycles).toBe(1);
    expect(view.totalWorkMs).toBe(25 * MIN); // только один реальный цикл
    expect(view.status).toBe('paused');
    expect(view.phase).toBe('work');
  });

  it('пауза, сохранённая в БД, не начисляет время при восстановлении', async () => {
    const { db } = await openTestDb();
    let s = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    s = pauseTimer(s, NOW + 7 * MIN);
    await db.timer.save(s, NOW + 7 * MIN);

    const restored = await db.timer.get(IDLE_TIMER_STATE);
    const view = timerView(restored, NOW + 500 * MIN);
    expect(view.totalWorkMs).toBe(7 * MIN);
    expect(view.status).toBe('paused');
  });

  it('currentPhaseElapsedMs корректен при паузах внутри фазы', () => {
    let s = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    s = pauseTimer(s, NOW + 4 * MIN);
    s = resumeTimer(s, NOW + 10 * MIN);
    expect(currentPhaseElapsedMs(s, NOW + 13 * MIN)).toBe(7 * MIN);
  });

  it('commitRunningSegment фиксирует отрезок при завершении', () => {
    const s = startTimer(IDLE_TIMER_STATE, POMODORO_PARAMS, NOW);
    const committed = commitRunningSegment(s, NOW + 9 * MIN);
    expect(committed.accumulatedWorkMs).toBe(9 * MIN);
    expect(committed.status).toBe('paused');
  });
});

describe('Настройки по умолчанию', () => {
  it('buildTimerStartParams использует настройки пользователя', () => {
    const params = buildTimerStartParams({
      defaultWorkMin: DEFAULT_SETTINGS.defaultWorkMin,
      defaultBreakMin: DEFAULT_SETTINGS.defaultBreakMin,
      defaultLongBreakMin: DEFAULT_SETTINGS.defaultLongBreakMin,
      cyclesBeforeLongBreak: DEFAULT_SETTINGS.cyclesBeforeLongBreak,
      taskId: 'task-1',
    });
    expect(params.workSec).toBe(25 * 60);
    expect(params.breakSec).toBe(5 * 60);
    expect(params.taskId).toBe('task-1');
  });
});
