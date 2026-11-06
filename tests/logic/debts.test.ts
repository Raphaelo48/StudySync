import { openTestDb, fixedNow } from '../support/helpers';
import { attemptLabel, defaultChecklist, retakeWhenLabel, suggestTeacher } from '../../src/logic/debts';
import { resyncAllNotifications, debtRetakeNotificationId } from '../../src/notifications/scheduler';
import { exportAll, importBackup, parseBackup, serializeBackup, wipeAllData } from '../../src/logic/backup';
import type { NotificationClient, PermissionStatus } from '../../src/notifications/client';
import { DAY_MS, HOUR_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow();
const day = (d: number, h = 0) => startOfDay(NOW) + d * DAY_MS + h * HOUR_MS;

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

describe('Долги: репозиторий', () => {
  it('создание, порядок списка, сдача и история', async () => {
    const { db } = await openTestDb();
    const s = await db.subjects.create({ name: 'Физика', color: '#5AA7F0' }, NOW);
    const late = await db.debts.create({ subjectId: s.id, title: 'Лаба 3', kind: 'lab', retakeAt: day(5, 14) }, NOW);
    const soon = await db.debts.create({ subjectId: s.id, title: 'Лаба 1', kind: 'lab', retakeAt: day(1, 14) }, NOW);
    const nodate = await db.debts.create({ title: 'Зачёт по истории', kind: 'credit' }, NOW);
    expect(soon.status).toBe('scheduled');
    expect(nodate.status).toBe('open');

    const open = await db.debts.listOpen();
    expect(open.map((d) => d.id)).toEqual([soon.id, late.id, nodate.id]);
    expect(open[0]!.subject?.name).toBe('Физика');

    const passed = await db.debts.update(soon.id, { status: 'passed' }, NOW + 1000);
    expect(passed?.passedAt).toBe(NOW + 1000);
    expect(await db.debts.countOpen()).toBe(2);
    expect((await db.debts.listPassed()).map((d) => d.id)).toEqual([soon.id]);
    const reopened = await db.debts.update(soon.id, { status: 'open' }, NOW + 2000);
    expect(reopened?.passedAt).toBeNull();
  });

  it('«Не сдал» — следующая попытка: дата сброшена, чек-лист снова пуст', async () => {
    const { db } = await openTestDb();
    const d = await db.debts.create({ title: 'Экзамен', kind: 'exam', retakeAt: day(1, 10), checklist: defaultChecklist('exam') }, NOW);
    await db.debts.toggleChecklistItem(d.id, 0, NOW);
    expect((await db.debts.get(d.id))!.checklist[0]!.done).toBe(true);
    const next = (await db.debts.nextAttempt(d.id, NOW))!;
    expect(next.attempt).toBe(2);
    expect(next.retakeAt).toBeNull();
    expect(next.status).toBe('open');
    expect(next.checklist.every((i) => !i.done)).toBe(true);
    expect(attemptLabel(1)).toBeNull();
    expect(attemptLabel(2)).toBe('Пересдача');
    expect(attemptLabel(3)).toBe('2-я пересдача · комиссия');
  });

  it('подписи срока', () => {
    expect(retakeWhenLabel(day(0, 18), NOW)).toBe('сегодня');
    expect(retakeWhenLabel(day(1, 9), NOW)).toBe('завтра');
    expect(retakeWhenLabel(day(4, 9), NOW)).toBe('через 4 дн.');
    expect(retakeWhenLabel(day(-1, 9), NOW)).toBe('дата прошла');
  });

  it('преподаватель подставляется из расписания (практика важнее лекции)', async () => {
    const { db } = await openTestDb();
    const s = await db.subjects.create({ name: 'Базы данных', color: '#5AA7F0' }, NOW);
    const base = { kind: 'lesson' as const, subjectId: s.id, source: 'kgeu' as const };
    await db.events.create({ ...base, title: 'Базы данных', startAt: day(-2, 9), endAt: day(-2, 10), notes: 'Лекция · Петров П. П. · пара №1', sourceRef: '1:1' }, NOW);
    await db.events.create({ ...base, title: 'Базы данных', startAt: day(-1, 9), endAt: day(-1, 10), notes: 'Лабораторная работа · Иванова А. С.', sourceRef: '1:2' }, NOW);
    expect(await suggestTeacher(db, s.id, NOW)).toBe('Иванова А. С.');
  });
});

describe('Долги: напоминания, сводка, резервная копия', () => {
  it('напоминание за час до отработки; сданный долг напоминание снимает', async () => {
    const { db } = await openTestDb();
    const client = new Client();
    const d = await db.debts.create({ title: 'Лаба 2', retakeAt: day(1, 14), location: 'А-212' }, NOW);
    await resyncAllNotifications(db, client, NOW);
    const n = client.items.get(debtRetakeNotificationId(d.id))!;
    expect(n.fireAt).toBe(day(1, 13));
    expect(n.body).toBe('Лаба 2 · 14:00 · А-212');
    expect(client.items.get('digest:2026-10-13')?.body).toContain('Отработка: Лаба 2 в 14:00, А-212');

    await db.debts.update(d.id, { status: 'passed' }, NOW);
    await resyncAllNotifications(db, client, NOW);
    expect(client.items.has(debtRetakeNotificationId(d.id))).toBe(false);
  });

  it('долги и сроки этапов переживают экспорт и импорт; сброс их удаляет', async () => {
    const { db } = await openTestDb();
    const s = await db.subjects.create({ name: 'Физика', color: '#5AA7F0' }, NOW);
    await db.debts.create({ subjectId: s.id, title: 'Лаба 3', kind: 'lab', checklist: defaultChecklist('lab'), retakeAt: day(2, 10) }, NOW);
    const t = await db.tasks.create({ title: 'Курсовая' }, NOW);
    await db.subtasks.create(t.id, 'Глава 1', NOW, day(10));
    const json = serializeBackup(await exportAll(db, NOW));

    const target = (await openTestDb()).db;
    const report = await importBackup(target, parseBackup(json), 'replace', NOW);
    expect(report.inserted.debts).toBe(1);
    const [debt] = await target.debts.listOpen();
    expect(debt!.checklist).toHaveLength(3);
    expect(debt!.subject?.name).toBe('Физика');
    expect((await target.subtasks.listByTask(t.id))[0]!.dueAt).toBe(day(10));

    await wipeAllData(target, 'test', NOW);
    expect(await target.debts.countOpen()).toBe(0);
  });

  it('копия старого формата (без долгов) импортируется', async () => {
    const { db } = await openTestDb();
    const old = JSON.stringify({ format: 'studysync-backup', formatVersion: 3, exportedAt: NOW, data: { subjects: [], tasks: [] } });
    const report = await importBackup(db, parseBackup(old), 'merge', NOW);
    expect(report.inserted.debts).toBe(0);
  });
});
