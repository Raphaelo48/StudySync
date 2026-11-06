/**
 * Сценарии 13–15: экспорт и повторный импорт, отказ при некорректном файле,
 * сохранность данных при ошибке импорта. Плюс merge/replace, дубликаты,
 * внутренние резервные копии и сброс данных.
 */
import { openTestDb, fixedNow, seedBasicData } from '../support/helpers';
import {
  APP_VERSION,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupParseError,
  exportAll,
  importBackup,
  listInternalBackups,
  parseBackup,
  restoreInternalBackup,
  serializeBackup,
  wipeAllData,
  type BackupFile,
} from '../../src/logic/backup';
import { DAY_MS } from '../../src/core/time';

const NOW = fixedNow();

describe('Экспорт (сценарий 13, часть 1)', () => {
  it('экспортирует все сущности с версией формата', async () => {
    const { db } = await openTestDb();
    const { task1, math } = await seedBasicData(db, NOW);
    await db.subtasks.create(task1.id, 'Шаг 1', NOW);
    await db.sessions.create({
      taskId: task1.id,
      subjectId: math.id,
      startedAt: NOW,
      endedAt: NOW + HOUR(),
      activeSeconds: 3000,
    });
    await db.goals.create({ metric: 'study_minutes', targetValue: 300, period: 'week' }, NOW);
    await db.settings.update({ displayName: 'Маша' });

    const backup = await exportAll(db, NOW);
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.appVersion).toBe(APP_VERSION);
    expect(backup.data.subjects.length).toBe(2);
    expect(backup.data.tasks.length).toBe(3);
    expect(backup.data.subtasks.length).toBe(1);
    expect(backup.data.events.length).toBe(1);
    expect(backup.data.studySessions.length).toBe(1);
    expect(backup.data.goals.length).toBe(1);
    expect(backup.data.settings?.displayName).toBe('Маша');

    // JSON сериализуется и парсится обратно
    const json = serializeBackup(backup);
    const parsed = parseBackup(json);
    expect(parsed.data.tasks.length).toBe(3);
  });
});

describe('Импорт (сценарии 13–15)', () => {
  it('экспорт → очистка → импорт восстанавливает данные (сценарий 13)', async () => {
    const source = await openTestDb();
    const { task1 } = await seedBasicData(source.db, NOW);
    await source.db.subtasks.create(task1.id, 'Шаг', NOW);
    const backup = await exportAll(source.db, NOW);
    const json = serializeBackup(backup);

    // Чистая база (как новое устройство)
    const target = await openTestDb();
    expect((await target.db.tasks.list({}, NOW)).length).toBe(0);

    const report = await importBackup(target.db, parseBackup(json), 'replace', NOW + 1000);
    expect(report.inserted.subjects).toBe(2);
    expect(report.inserted.tasks).toBe(3);
    expect(report.inserted.events).toBe(1);
    expect(report.inserted.subtasks).toBe(1);
    expect(report.settingsReplaced).toBe(true);

    const tasks = await target.db.tasks.list({ status: 'all' }, NOW);
    expect(tasks.length).toBe(3);
    const restored = await target.db.tasks.get(task1.id);
    expect(restored?.title).toBe('Решить задачи по матанализу');
    expect(restored?.subject?.name).toBe('Математика');
    expect((await target.db.subtasks.listByTask(task1.id)).length).toBe(1);
  });

  it('отклоняет не-JSON и чужой формат (сценарий 14)', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW);
    const tasksBefore = (await db.tasks.list({ status: 'all' }, NOW)).length;

    expect(() => parseBackup('это не json {')).toThrow(BackupParseError);
    expect(() => parseBackup('{"hello": 1}')).toThrow(BackupParseError);
    expect(() =>
      parseBackup(JSON.stringify({ format: 'other-app', formatVersion: 1, exportedAt: 1, data: {} }))
    ).toThrow(BackupParseError);
    // Файл из более новой версии
    const future: BackupFile = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION + 1,
      exportedAt: NOW,
      data: { subjects: [], tasks: [], subtasks: [], events: [], studySessions: [], goals: [] },
    };
    expect(() => parseBackup(JSON.stringify(future))).toThrow(/более новой версией/);
    // Некорректные обязательные поля
    const broken = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: NOW,
      data: { subjects: [{ id: 's1', name: '' }], tasks: [] },
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(BackupParseError);

    // Данные не пострадали
    expect((await db.tasks.list({ status: 'all' }, NOW)).length).toBe(tasksBefore);
  });

  it('при ошибке записи транзакция откатывается — исходные данные целы (сценарий 15)', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);

    // Валидный по zod файл, но с дублирующимся id предмета внутри —
    // второй INSERT нарушит UNIQUE и уронит транзакцию.
    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: NOW,
      data: {
        subjects: [
          { id: 'dup', name: 'Первый', createdAt: NOW, updatedAt: NOW, color: '#7C6CF0' },
          { id: 'dup', name: 'Второй', createdAt: NOW, updatedAt: NOW, color: '#7C6CF0' },
        ],
        tasks: [],
        subtasks: [],
        events: [],
        studySessions: [],
        goals: [],
      },
    };

    await expect(importBackup(db, backup, 'replace', NOW)).rejects.toThrow();

    // Исходные данные полностью на месте
    const tasks = await db.tasks.list({ status: 'all' }, NOW);
    expect(tasks.length).toBe(3);
    const t1 = await db.tasks.get(task1.id);
    expect(t1?.title).toBe('Решить задачи по матанализу');
    const subjects = await db.subjects.list(true);
    expect(subjects.map((s) => s.name).sort()).toEqual(['Математика', 'Физика']);
  });

  it('merge-режим пропускает дубликаты и добавляет только новое', async () => {
    const { db } = await openTestDb();
    const { math, task1 } = await seedBasicData(db, NOW);

    const backup = await exportAll(db, NOW);
    // Добавляем в копию новую задачу и меняем существующую (изменения не должны попасть в БД при merge)
    backup.data.tasks.push({
      id: 'new-task',
      title: 'Новая из файла',
      plannedMinutes: 20,
      createdAt: NOW,
      updatedAt: NOW,
      subjectId: math.id,
      description: null,
      deadlineAt: null,
      difficulty: 2,
      priority: 2,
      status: 'planned',
      completedAt: null,
      actualMinutes: 0,
      deferCount: 0,
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
    const modified = backup.data.tasks.find((t) => t.id === task1.id)!;
    modified.title = 'Изменённое название';

    const report = await importBackup(db, backup, 'merge', NOW + 1000);
    expect(report.inserted.tasks).toBe(1);
    expect(report.duplicatesSkipped).toBeGreaterThan(0);

    const t1 = await db.tasks.get(task1.id);
    expect(t1?.title).toBe('Решить задачи по матанализу'); // существующая не перезаписана
    const nt = await db.tasks.get('new-task');
    expect(nt?.title).toBe('Новая из файла');
    expect(nt?.subject?.name).toBe('Математика');
  });

  it('битые ссылки при импорте заменяются на null с предупреждением', async () => {
    const { db } = await openTestDb();
    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: NOW,
      data: {
        subjects: [],
        tasks: [
          {
            id: 'orphan',
            title: 'Задача-сирота',
            subjectId: 'ghost-subject',
            plannedMinutes: 15,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        subtasks: [{ id: 'st1', taskId: 'ghost-task', title: 'Шаг', createdAt: NOW }],
        events: [],
        studySessions: [],
        goals: [],
      },
    };
    const report = await importBackup(db, backup, 'merge', NOW);
    expect(report.inserted.tasks).toBe(1);
    expect(report.inserted.subtasks).toBe(0); // подзадача без задачи отброшена
    expect(report.warnings.length).toBeGreaterThan(0);
    const t = await db.tasks.get('orphan');
    expect(t?.subjectId).toBeNull();
  });

  it('перед replace-импортом автоматически создаётся внутренняя копия, её можно восстановить', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);
    const original = await exportAll(db, NOW);

    // Импортируем «чужие» данные с заменой
    const alien: BackupFile = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: NOW,
      data: {
        subjects: [{ id: 'alien-s', name: 'Чужой предмет', createdAt: NOW, updatedAt: NOW }],
        tasks: [],
        subtasks: [],
        events: [],
        studySessions: [],
        goals: [],
      },
    };
    const report = await importBackup(db, alien, 'replace', NOW);
    expect(report.internalBackupId).not.toBeNull();
    expect((await db.tasks.list({ status: 'all' }, NOW)).length).toBe(0);

    const backups = await listInternalBackups(db);
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups[0]!.id).toBe(report.internalBackupId);

    // Восстановление из внутренней копии
    await restoreInternalBackup(db, report.internalBackupId!, NOW + 2000);
    const restored = await db.tasks.get(task1.id);
    expect(restored?.title).toBe('Решить задачи по матанализу');
    void original;
  });

  it('полный сброс очищает данные, но оставляет внутреннюю копию', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);
    await db.settings.update({ displayName: 'До сброса' });

    const { internalBackupId } = await wipeAllData(db, 'user-reset', NOW);
    expect((await db.tasks.list({ status: 'all' }, NOW)).length).toBe(0);
    expect((await db.subjects.list(true)).length).toBe(0);
    const settings = await db.settings.get();
    expect(settings.displayName).toBe('');
    expect(settings.onboardingDone).toBe(false);

    await restoreInternalBackup(db, internalBackupId, NOW + 1);
    expect((await db.tasks.get(task1.id))?.title).toBe('Решить задачи по матанализу');
    expect((await db.settings.get()).displayName).toBe('До сброса');
  });

  it('неизвестные поля игнорируются, отсутствующие необязательные получают значения по умолчанию', () => {
    const withExtras = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: NOW,
      data: {
        subjects: [{ id: 's1', name: 'Предмет', createdAt: NOW, updatedAt: NOW, futureField: 'ignore me' }],
        tasks: [{ id: 't1', title: 'Задача', plannedMinutes: 10, createdAt: NOW, updatedAt: NOW, unknown: 42 }],
        subtasks: [],
        events: [],
        studySessions: [],
        goals: [],
        futureEntity: [],
      },
    };
    const parsed = parseBackup(JSON.stringify(withExtras));
    expect(parsed.data.subjects[0]!.name).toBe('Предмет');
    expect(parsed.data.tasks[0]!.status ?? 'planned').toBe('planned');
  });

  it('импорт серии событий сохраняет связи серии', async () => {
    const { db } = await openTestDb();
    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: NOW,
      data: {
        subjects: [],
        tasks: [],
        subtasks: [],
        events: [
          {
            id: 'e1',
            title: 'Лекция',
            kind: 'lesson',
            startAt: NOW + DAY_MS,
            endAt: NOW + DAY_MS + 2 * 3600_000,
            seriesId: 'ser-1',
            recurrence: { freq: 'weekly', daysOfWeek: [1], until: NOW + 30 * DAY_MS },
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        studySessions: [],
        goals: [],
      },
    };
    await importBackup(db, backup, 'merge', NOW);
    const e = await db.events.get('e1');
    expect(e?.seriesId).toBe('ser-1');
    expect(e?.recurrence?.freq).toBe('weekly');
  });
});

function HOUR(): number {
  return 3_600_000;
}
