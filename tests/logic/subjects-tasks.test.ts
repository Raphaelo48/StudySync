/**
 * Сценарии 1–5, 8 + граничные случаи:
 * 1. Создание, редактирование и удаление предмета.
 * 2. Создание задачи с корректным дедлайном.
 * 3. Обработка недопустимого срока и отсутствующего названия.
 * 4. Отметка задачи как выполненной.
 * 5. Корректное обновление статистики.
 * 8. Сохранение данных после перезапуска приложения.
 */
import { openTestDb, reopenTestDb, fixedNow, seedBasicData, dayStart } from '../support/helpers';
import { validateTaskForm, validateSubject, validateEventForm } from '../../src/logic/validation';
import { computeProgressStats, resolvePeriod } from '../../src/logic/analytics';
import { DAY_MS } from '../../src/core/time';

const NOW = fixedNow();

describe('Предметы (сценарий 1)', () => {
  it('создаёт, читает, обновляет и удаляет предмет', async () => {
    const { db } = await openTestDb();

    const created = await db.subjects.create({ name: '  Химия  ', color: '#34C7A0', targetGrade: '5' }, NOW);
    expect(created.name).toBe('Химия'); // trim
    expect(created.color).toBe('#34C7A0');
    expect(created.archived).toBe(false);

    const fetched = await db.subjects.get(created.id);
    expect(fetched?.id).toBe(created.id);

    const updated = await db.subjects.update(created.id, { name: 'Органическая химия', color: '#E87461' }, NOW + 1000);
    expect(updated?.name).toBe('Органическая химия');
    expect(updated?.color).toBe('#E87461');
    expect(updated?.updatedAt).toBe(NOW + 1000);

    const removed = await db.subjects.delete(created.id);
    expect(removed).toBe(true);
    expect(await db.subjects.get(created.id)).toBeNull();
  });

  it('не позволяет создать предмет с пустым названием (CHECK в БД)', async () => {
    const { db } = await openTestDb();
    await expect(
      db.driver.run(
        "INSERT INTO subjects (id, name, color, created_at, updated_at) VALUES ('x', '   ', '#fff', 1, 1)"
      )
    ).rejects.toThrow();
  });

  it('при удалении предмета задачи теряют связь, но не удаляются (ON DELETE SET NULL)', async () => {
    const { db } = await openTestDb();
    const { math, task1 } = await seedBasicData(db, NOW);

    const relations = await db.subjects.countRelations(math.id);
    expect(relations.tasks).toBeGreaterThanOrEqual(1);

    await db.subjects.delete(math.id);
    const task = await db.tasks.get(task1.id);
    expect(task).not.toBeNull();
    expect(task?.subjectId).toBeNull();
    expect(task?.subject).toBeNull();
  });

  it('архивирует предмет, сохраняя связи', async () => {
    const { db } = await openTestDb();
    const { math, task1 } = await seedBasicData(db, NOW);

    await db.subjects.archive(math.id, NOW);
    const active = await db.subjects.list();
    expect(active.find((s) => s.id === math.id)).toBeUndefined();
    const all = await db.subjects.list(true);
    expect(all.find((s) => s.id === math.id)?.archived).toBe(true);

    const task = await db.tasks.get(task1.id);
    expect(task?.subjectId).toBe(math.id);
    expect(task?.subject?.name).toBe('Математика');
  });

  it('валидация предмета: пустое имя и некорректный цвет отклоняются', () => {
    expect(validateSubject({ name: '  ' }).ok).toBe(false);
    expect(validateSubject({ name: 'ОК', color: 'red' }).ok).toBe(false);
    expect(validateSubject({ name: 'ОК', color: '#AABBCC' }).ok).toBe(true);
  });
});

describe('Задачи (сценарии 2–4)', () => {
  it('создаёт задачу с корректным дедлайном (сценарий 2)', async () => {
    const { db } = await openTestDb();
    const deadline = NOW + 2 * DAY_MS;
    const result = validateTaskForm(
      { title: 'Эссе по истории', deadlineAt: deadline, hasDeadline: true, plannedMinutes: 45, priority: 2 },
      { now: NOW }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = await db.tasks.create(result.value, NOW);
    expect(task.deadlineAt).toBe(deadline);
    expect(task.status).toBe('planned');
    expect(task.plannedMinutes).toBe(45);

    const fetched = await db.tasks.get(task.id);
    expect(fetched?.title).toBe('Эссе по истории');
  });

  it('отклоняет дедлайн в прошлом и пустое название (сценарий 3)', () => {
    const past = validateTaskForm(
      { title: 'Задача', hasDeadline: true, deadlineAt: NOW - 1000, plannedMinutes: 30 },
      { now: NOW }
    );
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors.deadlineAt).toMatch(/прошлом/);

    const noTitle = validateTaskForm({ title: '   ', plannedMinutes: 30 }, { now: NOW });
    expect(noTitle.ok).toBe(false);
    if (!noTitle.ok) expect(noTitle.errors.title).toBeDefined();

    const zeroDuration = validateTaskForm({ title: 'Задача', plannedMinutes: 0 }, { now: NOW });
    expect(zeroDuration.ok).toBe(false);

    // Явное разрешение (редактирование просроченной задачи) — проходит
    const allowed = validateTaskForm(
      { title: 'Задача', hasDeadline: true, deadlineAt: NOW - 1000, plannedMinutes: 30 },
      { now: NOW, allowPastDeadline: true }
    );
    expect(allowed.ok).toBe(true);
  });

  it('БД отклоняет задачу с нулевой длительностью и пустым названием (CHECK)', async () => {
    const { db } = await openTestDb();
    await expect(
      db.driver.run(
        "INSERT INTO tasks (id, title, planned_minutes, created_at, updated_at) VALUES ('t1', 'x', 0, 1, 1)"
      )
    ).rejects.toThrow();
    await expect(
      db.driver.run(
        "INSERT INTO tasks (id, title, planned_minutes, created_at, updated_at) VALUES ('t2', '  ', 10, 1, 1)"
      )
    ).rejects.toThrow();
  });

  it('отмечает задачу выполненной и снимает отметку (сценарий 4)', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);

    const done = await db.tasks.toggleDone(task1.id, NOW + 5000);
    expect(done?.status).toBe('done');
    expect(done?.completedAt).toBe(NOW + 5000);

    const undone = await db.tasks.toggleDone(task1.id, NOW + 9000);
    expect(undone?.status).toBe('planned');
    expect(undone?.completedAt).toBeNull();
  });

  it('подзадачи каскадно удаляются вместе с задачей (ON DELETE CASCADE)', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);
    await db.subtasks.create(task1.id, 'Шаг 1', NOW);
    await db.subtasks.create(task1.id, 'Шаг 2', NOW);
    expect((await db.subtasks.listByTask(task1.id)).length).toBe(2);

    await db.tasks.delete(task1.id);
    const orphan = await db.driver.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM subtasks');
    expect(orphan?.n).toBe(0);
  });

  it('перенос дедлайна увеличивает счётчик переносов', async () => {
    const { db } = await openTestDb();
    const { task2 } = await seedBasicData(db, NOW);
    await db.tasks.defer(task2.id, NOW + 8 * DAY_MS, NOW);
    await db.tasks.defer(task2.id, NOW + 9 * DAY_MS, NOW);
    const t = await db.tasks.get(task2.id);
    expect(t?.deferCount).toBe(2);
    expect(t?.deadlineAt).toBe(NOW + 9 * DAY_MS);
  });

  it('фильтры: просроченные, на сегодня, поиск', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);

    // Просроченная задача
    const overdue = await db.tasks.create(
      { title: 'Просроченный реферат', deadlineAt: NOW - DAY_MS, plannedMinutes: 30 },
      NOW
    );
    const list = await db.tasks.listOverdue(NOW);
    expect(list.map((t) => t.id)).toContain(overdue.id);
    expect(list.map((t) => t.id)).not.toContain(task1.id);

    // На сегодня
    const today = await db.tasks.create({ title: 'Сегодняшняя', deadlineAt: dayStart(0, 20, 0), plannedMinutes: 20 }, NOW);
    const todayList = await db.tasks.list({ due: 'today' }, NOW);
    expect(todayList.map((t) => t.id)).toContain(today.id);

    // Поиск
    const found = await db.tasks.list({ search: 'рефер' }, NOW);
    expect(found.map((t) => t.id)).toContain(overdue.id);
    const escaped = await db.tasks.list({ search: '100%' }, NOW);
    expect(escaped.length).toBe(0);
  });
});

describe('Статистика (сценарий 5)', () => {
  it('корректно считает показатели после выполнения задач и сессий', async () => {
    const { db } = await openTestDb();
    const { math, task1, task2 } = await seedBasicData(db, NOW);

    // Выполняем task1 с фактическим временем
    await db.tasks.setStatus(task1.id, 'done', { addActualMinutes: 70, now: NOW + DAY_MS });
    // Сессия по task2
    await db.sessions.create({
      taskId: task2.id,
      subjectId: math.id,
      startedAt: NOW + 2 * 3600_000,
      endedAt: NOW + 3 * 3600_000,
      activeSeconds: 55 * 60,
      breakSeconds: 5 * 60,
      mode: 'pomodoro',
      completed: true,
    });

    const tasks = await db.tasks.list({ status: 'all' }, NOW + DAY_MS);
    const sessions = await db.sessions.listRange(0, NOW + 10 * DAY_MS);
    const subjects = await db.subjects.list(true);
    const period = resolvePeriod('all', NOW + DAY_MS, 1);

    const stats = computeProgressStats({ tasks, sessions, subjects, period, now: NOW + DAY_MS, weekStart: 1 });
    expect(stats.completedCount).toBe(1);
    expect(stats.focusMinutes).toBe(55);
    expect(stats.sessionsCount).toBe(1);
    expect(stats.bySubject[0]?.name).toBe('Математика');
    expect(stats.plannedVsActual.sampleSize).toBe(1);
    expect(stats.plannedVsActual.plannedMinutes).toBe(60);
    expect(stats.plannedVsActual.actualMinutes).toBe(70);
    // 3 задачи с дедлайном в периоде «всё время»: task1 (done), task2, overdue нет
    expect(stats.dueCount).toBe(2);
    expect(stats.completionRate).toBe(50);
  });

  it('при отсутствии данных возвращает null вместо выдуманных значений', async () => {
    const { db } = await openTestDb();
    const stats = computeProgressStats({
      tasks: [],
      sessions: [],
      subjects: [],
      period: resolvePeriod('week', NOW, 1),
      now: NOW,
      weekStart: 1,
    });
    expect(stats.completionRate).toBeNull();
    expect(stats.avgSessionMinutes).toBeNull();
    expect(stats.plannedVsActual.ratio).toBeNull();
    expect(stats.deferStats.deferRate).toBeNull();
    expect(stats.hasAnyData).toBe(false);
  });
});

describe('Персистентность (сценарий 8)', () => {
  it('данные сохраняются после «перезапуска приложения»', async () => {
    const { db, raw } = await openTestDb();
    const { task1, math } = await seedBasicData(db, NOW);
    await db.subtasks.create(task1.id, 'Шаг 1', NOW);
    await db.sessions.create({
      taskId: task1.id,
      subjectId: math.id,
      startedAt: NOW,
      endedAt: NOW + 1800_000,
      activeSeconds: 1500,
    });
    await db.settings.update({ displayName: 'Аня', themeMode: 'dark' });

    // «Перезапуск»: новое подключение к той же базе
    const db2 = await reopenTestDb(raw);
    const task = await db2.tasks.get(task1.id);
    expect(task?.title).toBe('Решить задачи по матанализу');
    expect((await db2.subtasks.listByTask(task1.id)).length).toBe(1);
    expect((await db2.sessions.listByTask(task1.id)).length).toBe(1);
    const settings = await db2.settings.get();
    expect(settings.displayName).toBe('Аня');
    expect(settings.themeMode).toBe('dark');
    expect((await db2.subjects.list()).length).toBe(2);
  });

  it('внешние ключи действительно включены (PRAGMA foreign_keys = 1)', async () => {
    const { db } = await openTestDb();
    const fk = await db.driver.getFirst<{ foreign_keys: number }>('PRAGMA foreign_keys;');
    expect(fk?.foreign_keys).toBe(1);
  });

  it('вставка с некорректной внешней ссылкой отклоняется', async () => {
    const { db } = await openTestDb();
    await expect(
      db.driver.run(
        "INSERT INTO tasks (id, title, subject_id, planned_minutes, created_at, updated_at) VALUES ('t1', 'x', 'no-such-subject', 10, 1, 1)"
      )
    ).rejects.toThrow();
    const count = await db.driver.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM tasks');
    expect(count?.n).toBe(0);
  });
});
