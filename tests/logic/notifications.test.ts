/**
 * Сценарий 16: корректное поведение при отказе в разрешении на уведомления.
 * Плюс: отсутствие дубликатов после редактирования, полная синхронизация,
 * отключение уведомлений настройками.
 */
import { openTestDb, fixedNow, seedBasicData } from '../support/helpers';
import type { NotificationClient, PermissionStatus } from '../../src/notifications/client';
import {
  cancelAllKnown,
  eventStartNotificationId,
  resyncAllNotifications,
  scheduleTimerPhaseNotification,
  syncEventNotification,
  syncTaskDeadlineNotification,
  taskDeadlineNotificationId,
} from '../../src/notifications/scheduler';
import { DEFAULT_SETTINGS, type UserSettings } from '../../src/models/types';
import { DAY_MS, HOUR_MS } from '../../src/core/time';

const NOW = fixedNow();

class FakeNotificationClient implements NotificationClient {
  supported = true;
  permission: PermissionStatus = 'granted';
  scheduled = new Map<string, { title: string; body: string; fireAt: number }>();
  cancelCalls: string[] = [];
  scheduleAttempts = 0;

  isSupported(): boolean {
    return this.supported;
  }
  async getPermissionStatus(): Promise<PermissionStatus> {
    return this.permission;
  }
  async requestPermission(): Promise<PermissionStatus> {
    return this.permission;
  }
  async schedule(identifier: string, title: string, body: string, fireAt: number): Promise<boolean> {
    this.scheduleAttempts += 1;
    if (this.permission !== 'granted' && this.permission !== 'provisional') return false;
    if (fireAt <= NOW) return false;
    this.scheduled.set(identifier, { title, body, fireAt });
    return true;
  }
  async cancel(identifier: string): Promise<void> {
    this.cancelCalls.push(identifier);
    this.scheduled.delete(identifier);
  }
  async cancelMany(identifiers: string[]): Promise<void> {
    for (const id of identifiers) await this.cancel(id);
  }
}

function settings(patch: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_SETTINGS, ...patch, createdAt: NOW, updatedAt: NOW };
}

describe('Уведомления событий и дедлайнов', () => {
  it('планирует напоминание о занятии с учётом смещения', async () => {
    const { db } = await openTestDb();
    const client = new FakeNotificationClient();
    const event = await db.events.create(
      { title: 'Лекция', startAt: NOW + 2 * HOUR_MS, endAt: NOW + 3 * HOUR_MS, notifyOffsetMinutes: 15 },
      NOW
    );
    const ok = await syncEventNotification(client, settings(), event, NOW);
    expect(ok).toBe(true);
    const scheduled = client.scheduled.get(eventStartNotificationId(event.id));
    expect(scheduled?.fireAt).toBe(NOW + 2 * HOUR_MS - 15 * 60_000);
    expect(scheduled?.title).toContain('Лекция');
  });

  it('редактирование события не создаёт дубликатов уведомлений', async () => {
    const { db } = await openTestDb();
    const client = new FakeNotificationClient();
    const event = await db.events.create(
      { title: 'Семинар', startAt: NOW + 5 * HOUR_MS, endAt: NOW + 6 * HOUR_MS },
      NOW
    );
    await syncEventNotification(client, settings(), event, NOW);
    expect(client.scheduled.size).toBe(1);

    // «Перенесли» событие и пересинхронизировали
    const moved = (await db.events.update(event.id, { startAt: NOW + 8 * HOUR_MS, endAt: NOW + 9 * HOUR_MS }, NOW))!;
    await syncEventNotification(client, settings(), moved, NOW);
    expect(client.scheduled.size).toBe(1); // тот же идентификатор — дубликата нет
    const scheduled = client.scheduled.get(eventStartNotificationId(event.id));
    expect(scheduled?.fireAt).toBe(NOW + 8 * HOUR_MS - 15 * 60_000); // смещение из настроек
    expect(client.cancelCalls).toContain(eventStartNotificationId(event.id));
  });

  it('напоминание о дедлайне планируется и снимается после выполнения задачи', async () => {
    const { db } = await openTestDb();
    const client = new FakeNotificationClient();
    const task = await db.tasks.create(
      { title: 'Реферат', deadlineAt: NOW + 2 * DAY_MS, plannedMinutes: 60 },
      NOW
    );
    const ok = await syncTaskDeadlineNotification(client, settings({ notifyDeadlineBeforeMin: 60 }), task, NOW);
    expect(ok).toBe(true);
    expect(client.scheduled.get(taskDeadlineNotificationId(task.id))?.fireAt).toBe(NOW + 2 * DAY_MS - HOUR_MS);

    const done = (await db.tasks.setStatus(task.id, 'done', { now: NOW }))!;
    await syncTaskDeadlineNotification(client, settings(), done, NOW);
    expect(client.scheduled.has(taskDeadlineNotificationId(task.id))).toBe(false);
  });

  it('прошедшие события не напоминают', async () => {
    const { db } = await openTestDb();
    const client = new FakeNotificationClient();
    const past = await db.events.create({ title: 'Прошлое', startAt: NOW - HOUR_MS, endAt: NOW - 1 }, NOW);
    const ok = await syncEventNotification(client, settings(), past, NOW);
    expect(ok).toBe(false);
    expect(client.scheduled.size).toBe(0);
  });
});

describe('Отказ разрешения и отключение (сценарий 16)', () => {
  it('при отказе ОС ничего не планируется, приложение не падает', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW);
    const client = new FakeNotificationClient();
    client.permission = 'denied';

    const result = await resyncAllNotifications(db, client, NOW);
    expect(result.skippedNoPermission).toBe(true);
    expect(result.scheduled).toBe(0);
    expect(client.scheduled.size).toBe(0);

    // Прямое планирование тоже безопасно возвращает false
    const event = await db.events.create({ title: 'X', startAt: NOW + DAY_MS, endAt: NOW + DAY_MS + HOUR_MS }, NOW);
    const ok = await syncEventNotification(client, settings(), event, NOW);
    expect(ok).toBe(false);
  });

  it('на неподдерживаемой платформе клиент — noop', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW);
    const client = new FakeNotificationClient();
    client.supported = false;
    const result = await resyncAllNotifications(db, client, NOW);
    expect(result.skippedNoPermission).toBe(true);
    expect(client.scheduleAttempts).toBe(0);
  });

  it('полное отключение уведомлений в настройках отменяет запланированные', async () => {
    const { db } = await openTestDb();
    const { lesson } = await seedBasicData(db, NOW);
    const client = new FakeNotificationClient();

    await db.settings.update({ notificationsEnabled: true });
    await resyncAllNotifications(db, client, NOW);
    expect(client.scheduled.size).toBeGreaterThan(0);

    await db.settings.update({ notificationsEnabled: false });
    const result = await resyncAllNotifications(db, client, NOW);
    expect(result.scheduled).toBe(0);
    expect(client.scheduled.size).toBe(0);
    expect(client.cancelCalls).toContain(eventStartNotificationId(lesson.id));
  });

  it('отдельное отключение напоминаний о дедлайнах учитывается', async () => {
    const { db } = await openTestDb();
    const client = new FakeNotificationClient();
    const task = await db.tasks.create({ title: 'T', deadlineAt: NOW + DAY_MS, plannedMinutes: 30 }, NOW);
    const ok = await syncTaskDeadlineNotification(client, settings({ notifyDeadline: false }), task, NOW);
    expect(ok).toBe(false);
    expect(client.scheduled.size).toBe(0);
  });
});

describe('Полная синхронизация и таймер', () => {
  it('resync планирует будущие занятия и активные дедлайны', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW); // занятие сегодня 12:00 + задачи с дедлайнами
    await db.events.create({ title: 'Завтрашняя пара', startAt: NOW + DAY_MS, endAt: NOW + DAY_MS + 2 * HOUR_MS }, NOW);
    const client = new FakeNotificationClient();
    const result = await resyncAllNotifications(db, client, NOW);
    expect(result.scheduled).toBeGreaterThanOrEqual(3); // занятие + 2 завтрашних события/дедлайна минимум
    expect(client.scheduled.has(eventStartNotificationId((await db.events.listUpcoming(NOW))[0]!.id))).toBe(true);
  });

  it('cancelAllKnown отменяет все идентификаторы', async () => {
    const { db } = await openTestDb();
    const { lesson, task1 } = await seedBasicData(db, NOW);
    const client = new FakeNotificationClient();
    await resyncAllNotifications(db, client, NOW);
    const cancelled = await cancelAllKnown(db, client, NOW);
    expect(cancelled).toBeGreaterThan(0);
    expect(client.scheduled.size).toBe(0);
    expect(client.cancelCalls).toContain(eventStartNotificationId(lesson.id));
    expect(client.cancelCalls).toContain(taskDeadlineNotificationId(task1.id));
  });

  it('уведомление фазы таймера планируется и отключается настройкой', async () => {
    const client = new FakeNotificationClient();
    const ok = await scheduleTimerPhaseNotification(client, settings({ notifyBreak: true }), 'break', NOW + 5 * 60_000, NOW);
    expect(ok).toBe(true);
    expect(client.scheduled.has('timer-phase:current')).toBe(true);

    const ok2 = await scheduleTimerPhaseNotification(client, settings({ notifyBreak: false }), 'break', NOW + 5 * 60_000, NOW);
    expect(ok2).toBe(false);
    expect(client.scheduled.has('timer-phase:current')).toBe(false); // предыдущее отменено
  });
});
