/**
 * Регрессионные тесты на ошибки средней важности, найденные при ревью:
 * нагрузка дня, учёт перерывов, настройки и «осиротевшие» уведомления,
 * статус задачи после снятия отметки, перенос срока, правила повтора.
 */
import { openTestDb, fixedNow, seedBasicData } from '../support/helpers';
import { computeDayLoad } from '../../src/logic/analytics';
import { advanceTimer, resumeTimer, skipBreak, startTimer, summarizeSession, timerView } from '../../src/logic/timerModel';
import { finishTimerSession } from '../../src/logic/sessionService';
import { expandRecurrence, sameRecurrenceRule } from '../../src/logic/recurrence';
import type { NotificationClient, PermissionStatus } from '../../src/notifications/client';
import {
  cancelAllKnown,
  resyncAllNotifications,
  scheduleTimerPhaseNotification,
  taskDeadlineNotificationId,
} from '../../src/notifications/scheduler';
import { DEFAULT_SETTINGS, IDLE_TIMER_STATE, type UserSettings } from '../../src/models/types';
import { DAY_MS, HOUR_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow(); // пн 12.10.2026 10:00
const MIN = 60_000;
const day = (d: number, h = 0, m = 0) => startOfDay(NOW) + d * DAY_MS + h * HOUR_MS + m * MIN;

const POMODORO = {
  mode: 'pomodoro' as const,
  taskId: null,
  subjectId: null,
  workSec: 25 * 60,
  breakSec: 5 * 60,
  longBreakSec: 15 * 60,
  cyclesBeforeLongBreak: 4,
};

class ListingClient implements NotificationClient {
  scheduled = new Map<string, number>();
  isSupported(): boolean {
    return true;
  }
  async getPermissionStatus(): Promise<PermissionStatus> {
    return 'granted';
  }
  async requestPermission(): Promise<PermissionStatus> {
    return 'granted';
  }
  async schedule(id: string, _t: string, _b: string, fireAt: number): Promise<boolean> {
    if (fireAt <= NOW) return false;
    this.scheduled.set(id, fireAt);
    return true;
  }
  async cancel(id: string): Promise<void> {
    this.scheduled.delete(id);
  }
  async cancelMany(ids: string[]): Promise<void> {
    for (const id of ids) this.scheduled.delete(id);
  }
  async listScheduledIds(): Promise<string[]> {
    return [...this.scheduled.keys()];
  }
}

const settings = (patch: Partial<UserSettings> = {}): UserSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('Нагрузка дня', () => {
  it('учебный блок задачи не считается дважды', async () => {
    const { db } = await openTestDb();
    const task = await db.tasks.create({ title: 'Курсовая', deadlineAt: day(0, 21), plannedMinutes: 120 }, NOW);
    await db.events.create(
      { title: 'Курсовая', kind: 'study', taskId: task.id, startAt: day(0, 14), endAt: day(0, 16) },
      NOW
    );
    const events = await db.events.listDay(day(0));
    const load = computeDayLoad(events, [task], DEFAULT_SETTINGS, day(0));
    expect(load.scheduledMinutes).toBe(120);
    expect(load.taskMinutes).toBe(0);
  });
});

describe('Перерывы таймера', () => {
  it('в итог сессии попадают все перерывы, а не только последний', () => {
    let s = startTimer(IDLE_TIMER_STATE, POMODORO, NOW);
    s = advanceTimer(s, NOW + 25 * MIN); // перерыв 1
    s = advanceTimer(s, NOW + 30 * MIN); // перерыв 1 закончился
    s = resumeTimer(s, NOW + 30 * MIN);
    s = advanceTimer(s, NOW + 55 * MIN); // перерыв 2
    s = advanceTimer(s, NOW + 60 * MIN);
    const summary = summarizeSession(s, NOW + 60 * MIN);
    expect(summary.breakSeconds).toBe(600);
    expect(timerView(s, NOW + 60 * MIN).totalBreakMs).toBe(10 * MIN);
  });

  it('пропущенный перерыв учитывается в отгулянной части', () => {
    let s = startTimer(IDLE_TIMER_STATE, POMODORO, NOW);
    s = advanceTimer(s, NOW + 25 * MIN);
    s = skipBreak(s, NOW + 27 * MIN); // отдохнули 2 минуты
    expect(summarizeSession(s, NOW + 27 * MIN).breakSeconds).toBe(120);
  });

  it('счётчик перерывов сохраняется в БД и сбрасывается после завершения', async () => {
    const { db } = await openTestDb();
    let s = startTimer(IDLE_TIMER_STATE, POMODORO, NOW);
    s = advanceTimer(s, NOW + 25 * MIN);
    s = advanceTimer(s, NOW + 30 * MIN);
    await db.timer.ensureRow(IDLE_TIMER_STATE, NOW);
    await db.timer.save(s, NOW + 30 * MIN);
    expect((await db.timer.get(IDLE_TIMER_STATE)).completedBreakMs).toBe(5 * MIN);

    const result = await finishTimerSession(db, s, NOW + 30 * MIN);
    expect(result.session?.breakSeconds).toBe(300);
    expect((await db.timer.get(IDLE_TIMER_STATE)).completedBreakMs).toBe(0);
  });
});

describe('Уведомления', () => {
  it('настройка «О завершении рабочей фазы» выключает уведомление рабочей фазы', async () => {
    const client = new ListingClient();
    const off = await scheduleTimerPhaseNotification(client, settings({ notifySession: false }), 'work', NOW + 25 * MIN, NOW);
    expect(off).toBe(false);
    const on = await scheduleTimerPhaseNotification(client, settings(), 'work', NOW + 25 * MIN, NOW);
    expect(on).toBe(true);
  });

  it('полная синхронизация снимает напоминания удалённых и выполненных задач', async () => {
    const { db } = await openTestDb();
    const client = new ListingClient();
    const a = await db.tasks.create({ title: 'A', deadlineAt: NOW + 3 * DAY_MS }, NOW);
    const b = await db.tasks.create({ title: 'B', deadlineAt: NOW + 3 * DAY_MS }, NOW);
    await resyncAllNotifications(db, client, NOW);
    expect(client.scheduled.has(taskDeadlineNotificationId(a.id))).toBe(true);

    await db.tasks.delete(a.id);
    await db.tasks.setStatus(b.id, 'done', { now: NOW });
    client.scheduled.set('event-start:deleted-block', NOW + DAY_MS); // блок, удалённый каскадом
    client.scheduled.set('timer-phase:current', NOW + MIN); // таймер не трогаем

    await resyncAllNotifications(db, client, NOW);
    expect(client.scheduled.has(taskDeadlineNotificationId(a.id))).toBe(false);
    expect(client.scheduled.has(taskDeadlineNotificationId(b.id))).toBe(false);
    expect(client.scheduled.has('event-start:deleted-block')).toBe(false);
    expect(client.scheduled.has('timer-phase:current')).toBe(true);
  });

  it('отключение уведомлений снимает и «осиротевшие» напоминания', async () => {
    const { db } = await openTestDb();
    const client = new ListingClient();
    client.scheduled.set('task-deadline:gone', NOW + DAY_MS);
    await cancelAllKnown(db, client, NOW);
    expect(client.scheduled.size).toBe(0);
  });
});

describe('Статусы задач', () => {
  it('после снятия отметки задача с отработанным временем — «в работе»', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);
    await db.tasks.addActualMinutes(task1.id, 30, NOW);
    await db.tasks.toggleDone(task1.id, NOW);
    const back = await db.tasks.toggleDone(task1.id, NOW);
    expect(back?.status).toBe('in_progress');

    const fresh = await db.tasks.create({ title: 'Новая' }, NOW);
    await db.tasks.toggleDone(fresh.id, NOW);
    expect((await db.tasks.toggleDone(fresh.id, NOW))?.status).toBe('planned');
  });

  it('перенос срока помечает задачу отложенной, снятие срока — нет', async () => {
    const { db } = await openTestDb();
    const t = await db.tasks.create({ title: 'Реферат', deadlineAt: NOW + DAY_MS }, NOW);
    const deferred = await db.tasks.defer(t.id, NOW + 5 * DAY_MS, NOW);
    expect(deferred?.status).toBe('deferred');
    expect(deferred?.deferCount).toBe(1);

    const t2 = await db.tasks.create({ title: 'Эссе', deadlineAt: NOW + DAY_MS }, NOW);
    expect((await db.tasks.defer(t2.id, null, NOW))?.status).toBe('planned');
  });
});

describe('Повторяющиеся события', () => {
  it('дата окончания дальше 16 недель не обрезается', () => {
    const until = day(26 * 7, 23, 59);
    const inst = expandRecurrence({ freq: 'weekly', daysOfWeek: [1], until }, day(0, 9), day(0, 10));
    expect(inst.length).toBe(27);
  });

  it('сравнение правил повтора', () => {
    expect(sameRecurrenceRule({ freq: 'weekly', daysOfWeek: [3, 1], until: null }, { freq: 'weekly', daysOfWeek: [1, 3], until: null })).toBe(true);
    expect(sameRecurrenceRule({ freq: 'weekly', daysOfWeek: [1], until: null }, { freq: 'weekly', daysOfWeek: [1, 3], until: null })).toBe(false);
    expect(sameRecurrenceRule({ freq: 'daily', until: 1 }, { freq: 'daily', until: 2 })).toBe(false);
  });
});
