/**
 * Планировщик напоминаний StudySync.
 *
 * Правила:
 * - Идентификаторы уведомлений детерминированы (`event-start:<id>`,
 *   `task-deadline:<id>`): перед повторным планированием старое уведомление
 *   отменяется, поэтому редактирование события не создаёт дубликатов.
 * - Все действия учитывают настройки пользователя; при полном отключении
 *   уведомлений запланированные ранее — отменяются.
 * - Отсутствие разрешения ОС не является ошибкой: планирование просто
 *   не выполняется (клиент возвращает false), приложение продолжает работать.
 */
import type { AppDatabase } from '../db/database';
import { formatTime, formatDateWithWeekday, formatTime as fmtTime } from '../core/time';
import { logger } from '../core/logger';
import type { NotificationClient } from './client';
import type { CalendarEvent, Task, UserSettings } from '../models/types';
import { DAY_MS, startOfDay } from '../core/time';
import { buildDigest, digestFireTimes, digestNotificationId, DIGEST_DAYS } from '../logic/morningDigest';

export const eventStartNotificationId = (eventId: string): string => `event-start:${eventId}`;
export const taskDeadlineNotificationId = (taskId: string): string => `task-deadline:${taskId}`;
export const timerPhaseNotificationId = 'timer-phase:current';
export const debtRetakeNotificationId = (debtId: string): string => `debt-retake:${debtId}`;
/** За сколько минут напоминать об отработке. */
export const DEBT_REMIND_BEFORE_MIN = 60;

/** Префиксы «наших» уведомлений, которые полная синхронизация пересобирает с нуля. */
const OWN_PREFIXES = ['event-start:', 'task-deadline:', 'digest:', 'debt-retake:'];

export interface SyncResult {
  scheduled: number;
  cancelled: number;
  skippedNoPermission: boolean;
}

/** Синхронизировать уведомления одного события (создание/редактирование). */
export async function syncEventNotification(
  client: NotificationClient,
  settings: UserSettings,
  event: CalendarEvent,
  now: number = Date.now()
): Promise<boolean> {
  const identifier = eventStartNotificationId(event.id);
  await client.cancel(identifier);

  const enabled =
    settings.notificationsEnabled &&
    (event.kind === 'personal' ? true : settings.notifyLesson) &&
    event.startAt > now;
  if (!enabled) return false;

  const offsetMin = event.notifyOffsetMinutes ?? settings.notifyLessonBeforeMin;
  const fireAt = event.startAt - offsetMin * 60_000;
  if (fireAt <= now) return false; // напоминание уже неактуально

  const kindLabel = event.kind === 'personal' ? 'Событие' : 'Занятие';
  return client.schedule(
    identifier,
    `${kindLabel}: ${event.title}`,
    `Начало в ${formatTime(event.startAt)}${event.location ? ` · ${event.location}` : ''}`,
    fireAt
  );
}

/** Синхронизировать напоминание о дедлайне одной задачи. */
export async function syncTaskDeadlineNotification(
  client: NotificationClient,
  settings: UserSettings,
  task: Task,
  now: number = Date.now()
): Promise<boolean> {
  const identifier = taskDeadlineNotificationId(task.id);
  await client.cancel(identifier);

  const enabled =
    settings.notificationsEnabled &&
    settings.notifyDeadline &&
    task.status !== 'done' &&
    task.deadlineAt != null &&
    task.deadlineAt > now;
  if (!enabled) return false;

  const fireAt = task.deadlineAt! - settings.notifyDeadlineBeforeMin * 60_000;
  if (fireAt <= now) return false;

  return client.schedule(
    identifier,
    'Приближается дедлайн',
    `«${task.title}» — срок ${formatDateWithWeekday(task.deadlineAt!)} в ${fmtTime(task.deadlineAt!)}`,
    fireAt
  );
}

/**
 * Полная синхронизация: перепланировать уведомления всех будущих событий
 * и активных задач с дедлайнами. Вызывается при старте приложения,
 * после импорта и после изменения настроек.
 */
export async function resyncAllNotifications(
  db: AppDatabase,
  client: NotificationClient,
  now: number = Date.now()
): Promise<SyncResult> {
  const result: SyncResult = { scheduled: 0, cancelled: 0, skippedNoPermission: false };
  const settings = await db.settings.get();

  if (!settings.notificationsEnabled) {
    await cancelAllKnown(db, client, now);
    return result;
  }
  if (!client.isSupported()) {
    result.skippedNoPermission = true;
    return result;
  }
  const permission = await client.getPermissionStatus();
  if (permission !== 'granted' && permission !== 'provisional') {
    result.skippedNoPermission = true;
    return result;
  }

  const valid = new Set<string>();
  const events = await db.events.listUpcoming(now, 300);
  for (const event of events) {
    const ok = await syncEventNotification(client, settings, event, now);
    if (ok) {
      result.scheduled += 1;
      valid.add(eventStartNotificationId(event.id));
    } else result.cancelled += 1;
  }
  const tasks = await db.tasks.list({ status: 'active' }, now);
  for (const task of tasks) {
    const ok = await syncTaskDeadlineNotification(client, settings, task, now);
    if (ok) {
      result.scheduled += 1;
      valid.add(taskDeadlineNotificationId(task.id));
    } else result.cancelled += 1;
  }

  // Отработки и пересдачи: напоминание за час.
  const retakes = await db.debts.listRetakesBetween(now, now + 60 * DAY_MS);
  for (const debt of retakes) {
    const id = debtRetakeNotificationId(debt.id);
    await client.cancel(id);
    const fireAt = (debt.retakeAt as number) - DEBT_REMIND_BEFORE_MIN * 60_000;
    if (fireAt <= now) continue;
    const ok = await client.schedule(
      id,
      `Отработка через час: ${debt.subject?.name ?? debt.title}`,
      [debt.title, formatTime(debt.retakeAt as number), debt.location].filter(Boolean).join(' · '),
      fireAt
    );
    if (ok) {
      result.scheduled += 1;
      valid.add(id);
    }
  }

  // Утренняя сводка на ближайшие дни.
  for (const id of await syncMorningDigests(db, client, settings, now)) valid.add(id);
  // Напоминания удалённых/выполненных задач и удалённых событий (в том числе
  // учебных блоков, снятых планом или каскадным удалением) больше никто не
  // отменит — снимаем всё «наше», чего нет среди актуальных.
  const orphans = (await listOwnScheduledIds(client)).filter((id) => !valid.has(id));
  if (orphans.length > 0) {
    await client.cancelMany(orphans);
    result.cancelled += orphans.length;
  }
  logger.info('notifications', 'Синхронизация напоминаний завершена', {
    scheduled: result.scheduled,
    cancelled: result.cancelled,
  });
  return result;
}

/** Отменить уведомления всех известных будущих событий и активных задач. */
export async function cancelAllKnown(
  db: AppDatabase,
  client: NotificationClient,
  now: number = Date.now()
): Promise<number> {
  const events = await db.events.listUpcoming(now, 300);
  const tasks = await db.tasks.list({ status: 'active' }, now);
  const today = startOfDay(now);
  const retakes = await db.debts.listRetakesBetween(now, now + 60 * DAY_MS);
  const ids = new Set([
    ...events.map((e) => eventStartNotificationId(e.id)),
    ...tasks.map((t) => taskDeadlineNotificationId(t.id)),
    ...retakes.map((d) => debtRetakeNotificationId(d.id)),
    ...Array.from({ length: DIGEST_DAYS + 1 }, (_, i) => digestNotificationId(today + i * DAY_MS)),
    ...(await listOwnScheduledIds(client)),
  ]);
  await client.cancelMany([...ids]);
  return ids.size;
}

/** Запланированные уведомления событий и дедлайнов (без таймера). */
async function listOwnScheduledIds(client: NotificationClient): Promise<string[]> {
  if (!client.listScheduledIds) return [];
  const ids = await client.listScheduledIds();
  return ids.filter((id) => OWN_PREFIXES.some((p) => id.startsWith(p)));
}

/**
 * Поставить утренние сводки на DIGEST_DAYS дней вперёд. Возвращает идентификаторы
 * поставленных уведомлений; сводки прежних настроек снимаются.
 */
export async function syncMorningDigests(
  db: AppDatabase,
  client: NotificationClient,
  settings: UserSettings,
  now: number = Date.now()
): Promise<string[]> {
  const today = startOfDay(now);
  // Снимаем прежние сводки (время могло измениться, а клиент может не уметь их перечислять).
  for (let i = 0; i <= DIGEST_DAYS; i += 1) await client.cancel(digestNotificationId(today + i * DAY_MS));
  if (!settings.notificationsEnabled || !settings.morningDigestEnabled) return [];

  const slots = digestFireTimes(settings.morningDigestTimeMin, now);
  if (slots.length === 0) return [];
  const from = slots[0]!.dayStart;
  const to = slots[slots.length - 1]!.dayStart + 2 * DAY_MS;
  const events = await db.events.listRange(from, to);
  const tasks = await db.tasks.list({ status: 'active' }, now);
  const retakes = (await db.debts.listRetakesBetween(from, to)).map((d) => ({
    title: d.subject?.name ? `${d.subject.name} — ${d.title}` : d.title,
    at: d.retakeAt as number,
    location: d.location,
  }));

  const stages = (await db.subtasks.listDueBetween(from, to)).map((s) => ({
    title: s.title,
    taskTitle: s.taskTitle,
    dueAt: s.dueAt as number,
  }));

  const ids: string[] = [];
  for (const { dayStart, fireAt } of slots) {
    const content = buildDigest(dayStart, events, tasks, retakes, stages);
    if (!content) continue;
    const id = digestNotificationId(dayStart);
    if (await client.schedule(id, content.title, content.body, fireAt)) ids.push(id);
  }
  return ids;
}

/** Отменить уведомление конкретного события (при удалении). */
export async function cancelEventNotification(client: NotificationClient, eventId: string): Promise<void> {
  await client.cancel(eventStartNotificationId(eventId));
}

/** Отменить уведомление конкретной задачи (при удалении/выполнении). */
export async function cancelTaskNotification(client: NotificationClient, taskId: string): Promise<void> {
  await client.cancel(taskDeadlineNotificationId(taskId));
}

/* ---------------------------------- Таймер ---------------------------------- */

/** Напоминание о завершении фазы таймера (перерыв / окончание работы). */
export async function scheduleTimerPhaseNotification(
  client: NotificationClient,
  settings: UserSettings,
  phase: 'work' | 'break',
  fireAt: number,
  now: number = Date.now()
): Promise<boolean> {
  await client.cancel(timerPhaseNotificationId);
  if (!settings.notificationsEnabled) return false;
  if (phase === 'break' && !settings.notifyBreak) return false;
  if (phase === 'work' && !settings.notifySession) return false;
  if (fireAt <= now) return false;
  return client.schedule(
    timerPhaseNotificationId,
    phase === 'work' ? 'Рабочая фаза завершена' : 'Перерыв закончился',
    phase === 'work'
      ? 'Время отдохнуть. Нажмите, чтобы открыть StudySync.'
      : 'Готовы продолжить? Нажмите, чтобы открыть StudySync.',
    fireAt
  );
}

export async function cancelTimerPhaseNotification(client: NotificationClient): Promise<void> {
  await client.cancel(timerPhaseNotificationId);
}
