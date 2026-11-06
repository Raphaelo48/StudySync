import { openTestDb, fixedNow } from '../support/helpers';
import { buildDigest, digestFireTimes, digestNotificationId } from '../../src/logic/morningDigest';
import { syncMorningDigests, resyncAllNotifications, cancelAllKnown } from '../../src/notifications/scheduler';
import type { NotificationClient, PermissionStatus } from '../../src/notifications/client';
import type { CalendarEvent, Task } from '../../src/models/types';
import { DAY_MS, HOUR_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow(); // пн 12.10.2026 10:00
const MIN = 60_000;
const day = (d: number, h = 0, m = 0) => startOfDay(NOW) + d * DAY_MS + h * HOUR_MS + m * MIN;

const lesson = (title: string, start: number, location: string | null = null): CalendarEvent => ({
  id: title + start, title, kind: 'lesson', subjectId: null, taskId: null, location, startAt: start, endAt: start + 90 * MIN,
  notes: null, seriesId: null, recurrence: null, notifyOffsetMinutes: null, source: 'kgeu', sourceRef: null, createdAt: 0, updatedAt: 0,
});
const task = (title: string, deadlineAt: number | null, status: Task['status'] = 'planned'): Task => ({
  id: title, title, description: null, subjectId: null, deadlineAt, plannedMinutes: 60, difficulty: 2, priority: 2, status,
  createdAt: 0, updatedAt: 0, completedAt: null, actualMinutes: 0, deferCount: 0, scheduledStartAt: null, scheduledEndAt: null,
  source: 'manual', sourceRef: null,
} as Task);

class Client implements NotificationClient {
  items = new Map<string, { title: string; body: string; fireAt: number }>();
  isSupported() { return true; }
  async getPermissionStatus(): Promise<PermissionStatus> { return 'granted'; }
  async requestPermission(): Promise<PermissionStatus> { return 'granted'; }
  async schedule(id: string, title: string, body: string, fireAt: number) {
    if (fireAt <= NOW) return false;
    this.items.set(id, { title, body, fireAt });
    return true;
  }
  async cancel(id: string) { this.items.delete(id); }
  async cancelMany(ids: string[]) { ids.forEach((i) => this.items.delete(i)); }
  async listScheduledIds() { return [...this.items.keys()]; }
}

describe('Текст утренней сводки', () => {
  it('пары, первая пара с аудиторией, дедлайны сегодня и завтра', () => {
    const d = buildDigest(
      day(1),
      [lesson('Базы данных', day(1, 11, 20)), lesson('Маркетинг ИТ-продуктов', day(1, 9, 40), 'Б-301'), lesson('Физика', day(2, 9, 40))],
      [task('Лаба по БД', day(2, 23, 59)), task('Эссе', day(1, 18)), task('Старое', day(1, 12), 'done')]
    );
    expect(d).toEqual({
      title: 'Сегодня 2 пары · первая в 09:40, Б-301',
      body: 'Маркетинг ИТ-продуктов, Базы данных\nДедлайн: Эссе — сегодня до 18:00\nДедлайн: Лаба по БД — завтра',
    });
  });

  it('день без пар и дедлайнов — сводки нет; без пар, но с дедлайном — есть', () => {
    expect(buildDigest(day(3), [], [task('A', day(6))])).toBeNull();
    expect(buildDigest(day(3), [], [task('A', day(4, 10))])?.title).toBe('Сегодня пар нет');
  });

  it('подгруппы и сдвоенные пары не дублируются, лишние дедлайны сворачиваются', () => {
    const d = buildDigest(
      day(1),
      [lesson('Физика (подгр. 1)', day(1, 8)), lesson('Физика (подгр. 1)', day(1, 9, 40))],
      [task('A', day(1, 20)), task('B', day(1, 21)), task('C', day(2, 10))]
    )!;
    expect(d.title).toBe('Сегодня 2 пары · первая в 08:00');
    expect(d.body.split('\n')).toEqual(['Физика', 'Дедлайн: A — сегодня до 20:00', 'Дедлайн: B — сегодня до 21:00', 'и ещё 1 дедлайн']);
  });

  it('отработки попадают в сводку', () => {
    const d = buildDigest(day(1), [], [], [{ title: 'Физика — Лаба 3', at: day(1, 14), location: 'А-212' }])!;
    expect(d.body).toBe('Отработка: Физика — Лаба 3 в 14:00, А-212');
  });

  it('время отправки: сегодня уже прошло — начинаем с завтра', () => {
    const slots = digestFireTimes(7 * 60 + 30, NOW);
    expect(slots).toHaveLength(7);
    expect(slots[0]!.fireAt).toBe(day(1, 7, 30));
    expect(digestNotificationId(day(1))).toBe('digest:2026-10-13');
  });
});

describe('Постановка сводок', () => {
  it('ставит только дни, где есть что сообщить; выключение снимает', async () => {
    const { db } = await openTestDb();
    const client = new Client();
    await db.events.create({ title: 'Матанализ', kind: 'lesson', startAt: day(1, 9, 40), endAt: day(1, 11, 10), location: 'В-105' }, NOW);
    await db.tasks.create({ title: 'Реферат', deadlineAt: day(4, 12) }, NOW);
    const settings = await db.settings.get();
    const ids = await syncMorningDigests(db, client, settings, NOW);
    expect(ids.sort()).toEqual(['digest:2026-10-13', 'digest:2026-10-15', 'digest:2026-10-16']);
    expect(client.items.get('digest:2026-10-13')?.title).toBe('Сегодня 1 пара · первая в 09:40, В-105');

    await db.settings.update({ morningDigestEnabled: false }, NOW);
    await resyncAllNotifications(db, client, NOW);
    expect([...client.items.keys()].some((k) => k.startsWith('digest:'))).toBe(false);
  });

  it('смена времени переставляет сводки, отключение уведомлений их снимает', async () => {
    const { db } = await openTestDb();
    const client = new Client();
    await db.events.create({ title: 'Матанализ', kind: 'lesson', startAt: day(1, 9, 40), endAt: day(1, 11, 10) }, NOW);
    await db.settings.update({ morningDigestTimeMin: 8 * 60 }, NOW);
    await resyncAllNotifications(db, client, NOW);
    expect(client.items.get('digest:2026-10-13')?.fireAt).toBe(day(1, 8));
    await cancelAllKnown(db, client, NOW);
    expect(client.items.size).toBe(0);
  });
});
