/**
 * Сценарии 9–12: перепланирование.
 * 9.  Перепланирование при наличии свободного времени.
 * 10. Перепланирование при невозможности разместить все задачи.
 * 11. Отсутствие пересечений задач с занятиями.
 * 12. Отмена предложенного перепланирования без изменения исходного графика.
 * Плюс: детерминизм, приоритизация, граничные случаи.
 */
import { openTestDb, fixedNow, dayStart, seedBasicData } from '../support/helpers';
import {
  buildPlan,
  validatePlan,
  compareTasks,
  MIN_CHUNK_MINUTES,
  type PlannerInput,
  type PlannerTask,
} from '../../src/logic/planner';
import { computePlan, applyPlan, revertPlan } from '../../src/logic/planService';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../../src/core/time';

const NOW = fixedNow(); // 12.10.2026 (пн), 10:00

const SETTINGS = {
  breakBetweenTasksMin: 10,
  studyWindowStartMin: 9 * 60,
  studyWindowEndMin: 22 * 60,
  horizonDays: 7,
};

function task(partial: Partial<PlannerTask> & { id: string }): PlannerTask {
  return {
    id: partial.id,
    title: partial.title ?? `Задача ${partial.id}`,
    deadlineAt: partial.deadlineAt ?? null,
    plannedMinutes: partial.plannedMinutes ?? 30,
    priority: partial.priority ?? 2,
    difficulty: partial.difficulty ?? 2,
  };
}

function baseInput(tasks: PlannerTask[], busy: PlannerInput['busy'] = []): PlannerInput {
  return { now: NOW, tasks, busy, settings: SETTINGS };
}

describe('Перепланировщик: размещение (сценарии 9, 11)', () => {
  it('размещает задачи в свободное время вокруг занятия в правильном порядке', () => {
    const input = baseInput(
      [
        task({ id: 'A', plannedMinutes: 60, priority: 3, deadlineAt: NOW + 2 * DAY_MS }),
        task({ id: 'B', plannedMinutes: 90, priority: 2, deadlineAt: NOW + 5 * DAY_MS }),
        task({ id: 'C', plannedMinutes: 30, priority: 1 }),
      ],
      [{ start: dayStart(0, 12, 0), end: dayStart(0, 13, 30) }] // занятие 12:00–13:30
    );
    const plan = buildPlan(input);

    expect(validatePlan(plan, input)).toEqual([]);
    expect(plan.assignments.length).toBe(3);
    expect(plan.unplaced.length).toBe(0);
    expect(plan.overloaded).toBe(false);

    byTask(plan, 'A'); // ожидание: 10:00–11:00 (высокий приоритет, ближайший дедлайн)
    expect(byTask(plan, 'A').start).toBe(dayStart(0, 10, 0));
    expect(byTask(plan, 'A').end).toBe(dayStart(0, 11, 0));
    // C (30 мин) влезает в окно 11:10–12:00 после паузы
    expect(byTask(plan, 'C').start).toBe(dayStart(0, 11, 10));
    // B (90 мин) не влезает до занятия — размещается после него
    expect(byTask(plan, 'B').start).toBe(dayStart(0, 13, 30));
    expect(byTask(plan, 'B').end).toBe(dayStart(0, 15, 0));

    // Ни одна задача не пересекается с занятием
    for (const a of plan.assignments) {
      const overlap = a.start < dayStart(0, 13, 30) && dayStart(0, 12, 0) < a.end;
      expect(overlap).toBe(false);
    }
  });

  it('у каждой задачи есть человекочитаемые причины приоритизации', () => {
    const plan = buildPlan(
      baseInput([task({ id: 'A', deadlineAt: NOW + DAY_MS, priority: 3, difficulty: 3 })])
    );
    const a = plan.assignments[0]!;
    expect(a.reasons.length).toBeGreaterThan(0);
    expect(a.reasons.join(' ')).toMatch(/Дедлайн/);
    expect(a.reasons.join(' ')).toMatch(/Высокий пользовательский приоритет/);
    expect(a.beforeDeadline).toBe(true);
  });

  it('пауза между последовательными задачами соблюдается', () => {
    const tasks = Array.from({ length: 4 }, (_, i) => task({ id: `T${i}`, plannedMinutes: 30 }));
    const plan = buildPlan(baseInput(tasks));
    const sorted = [...plan.assignments].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.start - sorted[i - 1]!.end).toBeGreaterThanOrEqual(SETTINGS.breakBetweenTasksMin * MINUTE_MS);
    }
  });

  it('задачи не выходят за учебное окно и за горизонт', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => task({ id: `T${i}`, plannedMinutes: 60 }));
    const input = baseInput(tasks);
    const plan = buildPlan(input);
    expect(validatePlan(plan, input)).toEqual([]);
    for (const a of plan.assignments) {
      const day = dayStart(Math.floor((a.start - dayStart(0)) / DAY_MS));
      expect(a.start).toBeGreaterThanOrEqual(Math.max(dayStart(0, 9, 0), NOW));
      expect(a.end).toBeLessThanOrEqual(day + SETTINGS.studyWindowEndMin * MINUTE_MS);
      expect(a.end).toBeLessThanOrEqual(plan.horizonEnd);
    }
  });
});

describe('Перепланировщик: перегруз (сценарий 10)', () => {
  it('сообщает о невозможности разместить все задачи и предлагает перенос', () => {
    // Горизонт 2 дня: свободно ~2 * 13ч = 1560 мин; задач на 2000 минут
    const tasks = Array.from({ length: 20 }, (_, i) => task({ id: `T${i}`, plannedMinutes: 100 }));
    const input: PlannerInput = {
      now: NOW,
      tasks,
      busy: [],
      settings: { ...SETTINGS, horizonDays: 2 },
    };
    const plan = buildPlan(input);
    expect(validatePlan(plan, input)).toEqual([]);
    expect(plan.overloaded).toBe(true);
    expect(plan.unplaced.length).toBeGreaterThan(0);
    expect(plan.totals.requiredMinutes).toBe(2000);
    const withSuggestions = plan.unplaced.filter((u) => u.suggestions.length > 0);
    expect(withSuggestions.length).toBe(plan.unplaced.length);
    expect(plan.warnings.join(' ')).toMatch(/Перегруз/);
  });

  it('задача не завершается до дедлайна — помечается с причиной и предложением переноса', () => {
    const input = baseInput([task({ id: 'late', plannedMinutes: 60, deadlineAt: dayStart(0, 10, 30) })]);
    const plan = buildPlan(input);
    expect(plan.assignments.length).toBe(0);
    expect(plan.unplaced.length).toBe(1);
    expect(plan.unplaced[0]!.reason).toBe('no_time_before_deadline');
    expect(plan.unplaced[0]!.suggestions.join(' ')).toMatch(/Перенести дедлайн/);
  });

  it('задача длиннее учебного окна не размещается и предлагает разделение', () => {
    const input = baseInput([task({ id: 'huge', plannedMinutes: 24 * 60 })]);
    const plan = buildPlan(input);
    expect(plan.unplaced[0]?.reason).toBe('too_long_for_window');
    expect(plan.unplaced[0]!.suggestions.join(' ')).toMatch(/разделите/i);
  });

  it('просроченные задачи размещаются первыми и получают предупреждение', () => {
    const input = baseInput([
      task({ id: 'over', plannedMinutes: 30, deadlineAt: NOW - 2 * HOUR_MS, priority: 1 }),
      task({ id: 'fresh', plannedMinutes: 30, deadlineAt: NOW + 3 * DAY_MS, priority: 3 }),
    ]);
    const plan = buildPlan(input);
    const over = byTask(plan, 'over');
    const fresh = byTask(plan, 'fresh');
    expect(over.start).toBeLessThan(fresh.start);
    expect(over.isOverdue).toBe(true);
    expect(over.beforeDeadline).toBe(false);
    expect(plan.warnings.join(' ')).toMatch(/просрочен/i);
  });
});

describe('Приоритизация и детерминизм', () => {
  it('компаратор: дедлайн > приоритет > длительность > сложность > id', () => {
    const a = scored({ id: 'a', deadlineAt: NOW + DAY_MS, priority: 1, plannedMinutes: 30, difficulty: 1 });
    const b = scored({ id: 'b', deadlineAt: NOW + 2 * DAY_MS, priority: 3, plannedMinutes: 90, difficulty: 3 });
    expect(compareTasks(a, b)).toBeLessThan(0); // более ранний дедлайн важнее высокого приоритета

    const c = scored({ id: 'c', deadlineAt: NOW + DAY_MS, priority: 3, plannedMinutes: 30 });
    const d = scored({ id: 'd', deadlineAt: NOW + DAY_MS, priority: 1, plannedMinutes: 90 });
    expect(compareTasks(c, d)).toBeLessThan(0); // приоритет важнее длительности

    const e = scored({ id: 'e', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 60, difficulty: 1 });
    const f = scored({ id: 'f', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 60, difficulty: 3 });
    expect(compareTasks(e, f)).toBeGreaterThan(0); // равная длительность → сложнее раньше
    const g = scored({ id: 'g', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 120, difficulty: 1 });
    const h = scored({ id: 'h', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 30, difficulty: 3 });
    expect(compareTasks(g, h)).toBeLessThan(0); // длинная раньше короткой при равном приоритете
  });

  it('одинаковые дедлайны: порядок стабилен и детерминирован', () => {
    const tasks = [
      task({ id: 'x1', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 30 }),
      task({ id: 'x2', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 30 }),
      task({ id: 'x3', deadlineAt: NOW + DAY_MS, priority: 2, plannedMinutes: 30 }),
    ];
    const input = baseInput(tasks);
    const plan1 = buildPlan(input);
    const plan2 = buildPlan(baseInput([...tasks].reverse()));
    expect(JSON.stringify(plan1.assignments)).toBe(JSON.stringify(plan2.assignments));
    const ids = plan1.assignments.map((a) => a.taskId);
    expect(ids).toEqual(['x1', 'x2', 'x3']); // лексикографический tie-break
  });

  it('нулевая длительность нормализуется до минимальной', () => {
    const plan = buildPlan(baseInput([task({ id: 'z', plannedMinutes: 0 })]));
    const a = byTask(plan, 'z');
    expect(a.end - a.start).toBe(MIN_CHUNK_MINUTES * MINUTE_MS);
    expect(a.reasons.join(' ')).toMatch(/минимальных/);
  });

  it('пустой список задач — корректный пустой план', () => {
    const plan = buildPlan(baseInput([]));
    expect(plan.assignments).toEqual([]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.overloaded).toBe(false);
  });

  it('дедлайн ровно в полночь следующего дня учитывается (переход через полночь)', () => {
    const plan = buildPlan(
      baseInput([task({ id: 'mid', plannedMinutes: 30, deadlineAt: dayStart(1, 0, 0) })])
    );
    const a = byTask(plan, 'mid');
    expect(a.end).toBeLessThanOrEqual(dayStart(1, 0, 0));
    expect(a.beforeDeadline).toBe(true);
  });
});

describe('planService: применение и отмена (сценарий 12)', () => {
  it('применение создаёт учебные блоки, отмена возвращает исходное расписание', async () => {
    const { db } = await openTestDb();
    const { task1, task2, task3, lesson } = await seedBasicData(db, NOW);

    // Исходное расписание до перепланирования
    const eventsBefore = await db.events.listRange(NOW - DAY_MS, NOW + 30 * DAY_MS);
    expect(eventsBefore.length).toBe(1);

    const ctx = await computePlan(db, NOW);
    expect(ctx.output.assignments.length).toBe(3);

    // До применения данные не меняются (чистый расчёт)
    const eventsAfterCompute = await db.events.listRange(NOW - DAY_MS, NOW + 30 * DAY_MS);
    expect(eventsAfterCompute.length).toBe(1);
    const t1BeforeApply = await db.tasks.get(task1.id);
    expect(t1BeforeApply?.scheduledStartAt).toBeNull();

    const applied = await applyPlan(db, ctx, NOW);
    expect(applied.createdEventIds.length).toBe(3);

    // Учебные блоки появились в календаре, занятие не тронуто
    const eventsAfter = await db.events.listRange(NOW - DAY_MS, NOW + 30 * DAY_MS);
    expect(eventsAfter.length).toBe(4);
    const lessonAfter = await db.events.get(lesson.id);
    expect(lessonAfter?.startAt).toBe(lesson.startAt);
    expect(lessonAfter?.endAt).toBe(lesson.endAt);

    // Задачи получили окна расписания
    const t1 = await db.tasks.get(task1.id);
    expect(t1?.scheduledStartAt).not.toBeNull();
    expect(t1?.scheduledEndAt).not.toBeNull();

    // Отмена применения — исходный график полностью восстановлен
    const reverted = await revertPlan(db, applied.planRecordId);
    expect(reverted.removedEvents).toBe(3);
    const eventsFinal = await db.events.listRange(NOW - DAY_MS, NOW + 30 * DAY_MS);
    expect(eventsFinal.length).toBe(1);
    expect(eventsFinal[0]!.id).toBe(lesson.id);
    const t1Final = await db.tasks.get(task1.id);
    expect(t1Final?.scheduledStartAt).toBeNull();
    void task2;
    void task3;
  });

  it('повторное применение заменяет прежние учебные блоки без дублирования', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW);

    const ctx1 = await computePlan(db, NOW);
    await applyPlan(db, ctx1, NOW);
    const afterFirst = await db.events.listRange(NOW - DAY_MS, NOW + 30 * DAY_MS);
    const studyFirst = afterFirst.filter((e) => e.kind === 'study').length;

    const ctx2 = await computePlan(db, NOW);
    await applyPlan(db, ctx2, NOW);
    const afterSecond = await db.events.listRange(NOW - DAY_MS, NOW + 30 * DAY_MS);
    const studySecond = afterSecond.filter((e) => e.kind === 'study').length;

    expect(studySecond).toBe(studyFirst); // блоки заменены, а не удвоены
  });

  it('перепланировщик не ставит учебные блоки поверх занятий из БД', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW); // занятие 12:00–13:30 сегодня
    const ctx = await computePlan(db, NOW);
    expect(validatePlan(ctx.output, ctx.input)).toEqual([]);
    for (const a of ctx.output.assignments) {
      const hitsLesson = a.start < dayStart(0, 13, 30) && dayStart(0, 12, 0) < a.end;
      expect(hitsLesson).toBe(false);
    }
  });
});

/* ---------------------------------- helpers ---------------------------------- */

function byTask(plan: ReturnType<typeof buildPlan>, taskId: string) {
  const found = plan.assignments.find((a) => a.taskId === taskId);
  if (!found) throw new Error(`Задача ${taskId} не размещена: ${JSON.stringify(plan.unplaced)}`);
  return found;
}

function scored(t: Partial<PlannerTask> & { id: string }) {
  const base = task(t);
  const deadlineAt = base.deadlineAt;
  const urgencyClass: 0 | 1 | 2 =
    deadlineAt == null ? 2 : deadlineAt < NOW ? 0 : deadlineAt <= NOW + 7 * DAY_MS ? 1 : 2;
  return { ...base, urgencyClass, normalizedMinutes: Math.max(MIN_CHUNK_MINUTES, base.plannedMinutes), isOverdue: deadlineAt != null && deadlineAt < NOW };
}
