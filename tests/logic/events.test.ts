/**
 * Сценарий 6: создание событий с проверкой временных конфликтов.
 * Плюс: повторения, переход через полночь, свободные слоты, валидация интервалов.
 */
import { openTestDb, fixedNow, dayStart } from '../support/helpers';
import { validateEventForm } from '../../src/logic/validation';
import { findConflicts, conflictingIds, conflictsWithInterval, freeSlotsForDay, busyMinutesForDay } from '../../src/logic/conflicts';
import { expandRecurrence } from '../../src/logic/recurrence';
import { HOUR_MS, MINUTE_MS, DAY_MS, startOfDay } from '../../src/core/time';
import type { CalendarEvent } from '../../src/models/types';

const NOW = fixedNow();

function ev(partial: Partial<CalendarEvent> & { id: string; startAt: number; endAt: number }): CalendarEvent {
  return {
    id: partial.id,
    title: partial.title ?? 'Событие',
    kind: partial.kind ?? 'lesson',
    subjectId: null,
    taskId: null,
    location: null,
    startAt: partial.startAt,
    endAt: partial.endAt,
    notes: null,
    seriesId: null,
    recurrence: null,
    notifyOffsetMinutes: null,
    source: 'manual',
    sourceRef: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('События и конфликты (сценарий 6)', () => {
  it('БД не допускает окончания раньше начала (CHECK)', async () => {
    const { db } = await openTestDb();
    await expect(
      db.events.create({ title: 'Сломанное', startAt: NOW + HOUR_MS, endAt: NOW }, NOW)
    ).rejects.toThrow();
  });

  it('валидация формы отклоняет некорректный интервал и пустое название', () => {
    const bad = validateEventForm({ title: 'Пара', startAt: NOW + 2 * HOUR_MS, endAt: NOW + HOUR_MS });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.endAt).toMatch(/позже начала/);

    const equal = validateEventForm({ title: 'Пара', startAt: NOW, endAt: NOW });
    expect(equal.ok).toBe(false);

    const noTitle = validateEventForm({ title: ' ', startAt: NOW, endAt: NOW + HOUR_MS });
    expect(noTitle.ok).toBe(false);

    const ok = validateEventForm({ title: 'Пара', startAt: NOW, endAt: NOW + HOUR_MS });
    expect(ok.ok).toBe(true);
  });

  it('находит конфликты между пересекающимися событиями', async () => {
    const { db } = await openTestDb();
    const a = await db.events.create({ title: 'Лекция', startAt: dayStart(0, 12, 0), endAt: dayStart(0, 13, 30) }, NOW);
    const b = await db.events.create({ title: 'Семинар', startAt: dayStart(0, 13, 0), endAt: dayStart(0, 14, 0) }, NOW);
    const c = await db.events.create({ title: 'Спорт', kind: 'personal', startAt: dayStart(0, 18, 0), endAt: dayStart(0, 19, 0) }, NOW);

    const dayEvents = await db.events.listDay(startOfDay(NOW));
    expect(dayEvents.length).toBe(3);

    const conflicts = findConflicts(dayEvents);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.overlapStart).toBe(dayStart(0, 13, 0));
    expect(conflicts[0]!.overlapEnd).toBe(dayStart(0, 13, 30));

    const ids = conflictingIds(dayEvents);
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
    expect(ids.has(c.id)).toBe(false);
  });

  it('касающиеся интервалы (конец == начало) конфликтом не считаются', () => {
    const a = ev({ id: 'a', startAt: dayStart(0, 10, 0), endAt: dayStart(0, 11, 0) });
    const b = ev({ id: 'b', startAt: dayStart(0, 11, 0), endAt: dayStart(0, 12, 0) });
    expect(findConflicts([a, b]).length).toBe(0);
  });

  it('при сохранении формы показывает конфликтующие события, но не меняет их', async () => {
    const { db } = await openTestDb();
    const existing = await db.events.create({ title: 'Лекция', startAt: dayStart(1, 12, 0), endAt: dayStart(1, 13, 30) }, NOW);
    const conflicts = await db.events.findConflicts(dayStart(1, 13, 0), dayStart(1, 14, 0), null);
    expect(conflicts.map((c) => c.id)).toContain(existing.id);

    // Сохраняем конфликтующее событие — существующее не изменяется
    await db.events.create({ title: 'Консультация', startAt: dayStart(1, 13, 0), endAt: dayStart(1, 14, 0) }, NOW);
    const after = await db.events.get(existing.id);
    expect(after?.startAt).toBe(dayStart(1, 12, 0));
    expect(after?.endAt).toBe(dayStart(1, 13, 30));
  });

  it('conflictsWithInterval игнорирует само событие (редактирование)', () => {
    const a = ev({ id: 'a', startAt: dayStart(0, 10, 0), endAt: dayStart(0, 11, 0) });
    expect(conflictsWithInterval([a], a.startAt, a.endAt, a.id).length).toBe(0);
    expect(conflictsWithInterval([a], a.startAt, a.endAt, null).length).toBe(1);
  });
});

describe('Свободные промежутки', () => {
  it('находит свободные слоты дня вокруг занятий', () => {
    const busy = [
      { start: dayStart(0, 12, 0), end: dayStart(0, 13, 30) },
      { start: dayStart(0, 16, 0), end: dayStart(0, 17, 0) },
    ];
    const slots = freeSlotsForDay(startOfDay(NOW), 9 * 60, 22 * 60, busy, { minMinutes: 30 });
    // 9:00–12:00, 13:30–16:00, 17:00–22:00
    expect(slots.length).toBe(3);
    expect(slots[0]!.start).toBe(dayStart(0, 9, 0));
    expect(slots[0]!.end).toBe(dayStart(0, 12, 0));
    expect(slots[1]!.start).toBe(dayStart(0, 13, 30));
    expect(slots[2]!.end).toBe(dayStart(0, 22, 0));
  });

  it('отсекает прошедшую часть дня (fromTs = now)', () => {
    const slots = freeSlotsForDay(startOfDay(NOW), 9 * 60, 22 * 60, [], { fromTs: NOW }); // NOW = 10:00
    expect(slots.length).toBe(1);
    expect(slots[0]!.start).toBe(NOW);
  });

  it('событие через полночь учитывается в занятости обоих дней частично', () => {
    const nightOwl = ev({ id: 'n', startAt: dayStart(0, 23, 0), endAt: dayStart(1, 1, 0) });
    const day0 = busyMinutesForDay([nightOwl], startOfDay(NOW));
    const day1 = busyMinutesForDay([nightOwl], startOfDay(NOW + DAY_MS));
    expect(day0).toBe(60);
    expect(day1).toBe(60);
  });

  it('пересекающиеся события не дают двойного счёта занятости', () => {
    const a = ev({ id: 'a', startAt: dayStart(0, 10, 0), endAt: dayStart(0, 12, 0) });
    const b = ev({ id: 'b', startAt: dayStart(0, 11, 0), endAt: dayStart(0, 13, 0) });
    expect(busyMinutesForDay([a, b], startOfDay(NOW))).toBe(180);
  });
});

describe('Повторяющиеся события', () => {
  it('разворачивает еженедельное правило по выбранным дням', () => {
    const first = dayStart(0, 12, 0); // понедельник
    const instances = expandRecurrence(
      { freq: 'weekly', daysOfWeek: [1, 3, 5], until: dayStart(14, 23, 59) },
      first,
      first + 90 * MINUTE_MS
    );
    // 12.10 (пн), 14.10 (ср), 16.10 (пт), 19.10 (пн), 21.10 (ср), 23.10 (пт), 26.10 (пн, до until 26.10 23:59)
    expect(instances.length).toBe(7);
    expect(instances[1]!.startAt).toBe(dayStart(2, 12, 0));
    for (const i of instances) {
      expect(i.endAt - i.startAt).toBe(90 * MINUTE_MS);
    }
  });

  it('ежедневное повторение до даты until', () => {
    const instances = expandRecurrence({ freq: 'daily', until: dayStart(4, 23, 59) }, dayStart(0, 9, 0), dayStart(0, 10, 0));
    expect(instances.length).toBe(5); // дни 0..4
  });

  it('ограничение count', () => {
    const instances = expandRecurrence({ freq: 'daily', until: null, count: 3 }, dayStart(0, 9, 0), dayStart(0, 10, 0), dayStart(60, 0, 0));
    expect(instances.length).toBe(3);
  });

  it('создание серии в БД и удаление «этого и будущих»', async () => {
    const { db } = await openTestDb();
    const seriesId = 'series-1';
    const instances = expandRecurrence({ freq: 'weekly', daysOfWeek: [1], until: dayStart(28, 23, 59) }, dayStart(0, 12, 0), dayStart(0, 13, 30));
    for (const inst of instances) {
      await db.events.create(
        {
          title: 'Лекция',
          startAt: inst.startAt,
          endAt: inst.endAt,
          seriesId,
          recurrence: { freq: 'weekly', daysOfWeek: [1], until: dayStart(28, 23, 59) },
        },
        NOW
      );
    }
    expect(instances.length).toBe(5);
    const all = await db.events.listSeries(seriesId);
    expect(all.length).toBe(5);
    expect(all[0]!.recurrence?.freq).toBe('weekly');

    // Удаляем «это и будущие» начиная с 3-го инстанса
    const third = all[2]!;
    await db.events.deleteSeries(seriesId, third.startAt);
    const remaining = await db.events.listSeries(seriesId);
    expect(remaining.length).toBe(2);
    expect(remaining.every((e) => e.startAt < third.startAt)).toBe(true);
  });
});

describe('Граничные случаи времени', () => {
  it('смена даты: задача с дедлайном сразу после полуночи попадает в «завтра»', async () => {
    const { db } = await openTestDb();
    const midnightTask = await db.tasks.create(
      { title: 'Ночной дедлайн', deadlineAt: dayStart(1, 0, 30), plannedMinutes: 30 },
      NOW
    );
    const today = await db.tasks.list({ due: 'today' }, NOW);
    expect(today.map((t) => t.id)).not.toContain(midnightTask.id);
    const tomorrowList = await db.tasks.listDueOnDay(dayStart(1), NOW);
    expect(tomorrowList.map((t) => t.id)).toContain(midnightTask.id);
  });

  it('пустая база: списки пусты, без ошибок', async () => {
    const { db } = await openTestDb();
    expect(await db.events.listDay(startOfDay(NOW))).toEqual([]);
    expect(await db.tasks.list({}, NOW)).toEqual([]);
    expect(await db.sessions.listRecent()).toEqual([]);
    expect(await db.goals.list()).toEqual([]);
    expect(await db.subjects.list()).toEqual([]);
  });
});
