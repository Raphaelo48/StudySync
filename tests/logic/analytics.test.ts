/**
 * Аналитика: периоды, загруженность дня, прогресс целей, недельная динамика.
 * Проверяются прозрачные формулы и честные null при нехватке данных.
 */
import { openTestDb, fixedNow, seedBasicData, dayStart } from '../support/helpers';
import {
  computeDayLoad,
  computeGoalProgress,
  computeProgressStats,
  resolvePeriod,
} from '../../src/logic/analytics';
import { DEFAULT_SETTINGS } from '../../src/models/types';
import { DAY_MS, HOUR_MS, MINUTE_MS, startOfWeek, endOfWeek } from '../../src/core/time';

const NOW = fixedNow(); // понедельник 12.10.2026 10:00

describe('Периоды', () => {
  it('неделя начинается в понедельник (weekStart=1) и в воскресенье (weekStart=0)', () => {
    const weekMonday = resolvePeriod('week', NOW, 1);
    expect(weekMonday.start).toBe(dayStart(0, 0, 0));
    expect(weekMonday.end).toBeGreaterThan(NOW);

    const wednesday = dayStart(2, 12, 0);
    const w0 = resolvePeriod('week', wednesday, 0);
    // При weekStart=0 неделя среды 14.10 начинается в воскресенье 11.10
    expect(new Date(w0.start).getDay()).toBe(0);
    const w1 = resolvePeriod('week', wednesday, 1);
    expect(new Date(w1.start).getDay()).toBe(1);
    expect(w1.start).toBe(startOfWeek(wednesday, 1));
    expect(w1.end).toBe(endOfWeek(wednesday, 1));
  });
});

describe('Загруженность дня', () => {
  it('считает занятия + задачи против ёмкости окна', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW); // занятие 12:00–13:30, task1 60 мин с дедлайном через 2 дня

    const dayEvents = await db.events.listDay(dayStart(0));
    const dayTasks = await db.tasks.listDueOnDay(dayStart(0), NOW); // пусто (дедлайн task1 не сегодня)
    const load = computeDayLoad(dayEvents, dayTasks, { ...DEFAULT_SETTINGS, studyWindowStartMin: 9 * 60, studyWindowEndMin: 22 * 60 }, dayStart(0));
    expect(load.scheduledMinutes).toBe(90);
    expect(load.taskMinutes).toBe(0);
    expect(load.capacityMinutes).toBe(13 * 60);
    expect(load.ratio).toBeCloseTo(90 / 780, 5);
    expect(load.level).toBe('free');

    // Задача с дедлайном сегодня добавляет плановые минуты
    const todayTask = await db.tasks.create({ title: 'Сегодня', deadlineAt: dayStart(0, 21, 0), plannedMinutes: 600 }, NOW);
    const load2 = computeDayLoad(dayEvents, [todayTask], DEFAULT_SETTINGS, dayStart(0));
    expect(load2.taskMinutes).toBe(600);
    expect(load2.level).toBe('busy'); // (90+600)/780 ≈ 0.88

    void task1;
  });

  it('перегруз при сумме больше ёмкости', () => {
    const settings = { ...DEFAULT_SETTINGS, studyWindowStartMin: 9 * 60, studyWindowEndMin: 15 * 60 }; // 6 часов
    const load = computeDayLoad(
      [],
      [
        {
          id: 'a', source: 'manual', sourceRef: null, title: 'A', description: null, subjectId: null, deadlineAt: dayStart(0, 20, 0),
          plannedMinutes: 400, difficulty: 2, priority: 2, status: 'planned', createdAt: NOW, updatedAt: NOW,
          completedAt: null, actualMinutes: 0, deferCount: 0, scheduledStartAt: null, scheduledEndAt: null,
        },
      ],
      settings,
      dayStart(0)
    );
    expect(load.ratio).toBeGreaterThan(1);
    expect(load.level).toBe('overload');
  });

  it('выполненные задачи не нагружают день', () => {
    const load = computeDayLoad(
      [],
      [
        {
          id: 'a', source: 'manual', sourceRef: null, title: 'A', description: null, subjectId: null, deadlineAt: dayStart(0, 20, 0),
          plannedMinutes: 400, difficulty: 2, priority: 2, status: 'done', createdAt: NOW, updatedAt: NOW,
          completedAt: NOW, actualMinutes: 100, deferCount: 0, scheduledStartAt: null, scheduledEndAt: null,
        },
      ],
      DEFAULT_SETTINGS,
      dayStart(0)
    );
    expect(load.taskMinutes).toBe(0);
  });
});

describe('Статистика по периодам', () => {
  it('выполнение за неделю учитывает только задачи с дедлайном в неделе', async () => {
    const { db } = await openTestDb();
    await seedBasicData(db, NOW);
    // task1 дедлайн +2 дня (внутри этой недели), task2 +5 дней (тоже), task3 без дедлайна
    await db.tasks.setStatus((await db.tasks.list({}, NOW))[0]!.id, 'done', { now: NOW + DAY_MS });

    const tasks = await db.tasks.list({ status: 'all' }, NOW + DAY_MS);
    const stats = computeProgressStats({
      tasks,
      sessions: [],
      subjects: [],
      period: resolvePeriod('week', NOW, 1),
      now: NOW + DAY_MS,
      weekStart: 1,
    });
    expect(stats.dueCount).toBe(2);
    expect(stats.completedAmongDue).toBe(1);
    expect(stats.completionRate).toBe(50);
    expect(stats.completedCount).toBe(1);
  });

  it('дневная динамика: 7 точек, сессии попадают в свой день', async () => {
    const { db } = await openTestDb();
    await db.sessions.create({ startedAt: dayStart(-1, 15, 0), endedAt: dayStart(-1, 16, 0), activeSeconds: 45 * 60 });
    await db.sessions.create({ startedAt: dayStart(0, 9, 0), endedAt: dayStart(0, 10, 0), activeSeconds: 50 * 60 });
    const sessions = await db.sessions.listRange(NOW - 40 * DAY_MS, NOW + DAY_MS);
    const stats = computeProgressStats({
      tasks: [],
      sessions,
      subjects: [],
      period: resolvePeriod('7d', NOW, 1),
      now: NOW,
      weekStart: 1,
    });
    expect(stats.daily.length).toBe(7);
    const todayPoint = stats.daily[6]!;
    expect(todayPoint.focusMinutes).toBe(50);
    const yesterdayPoint = stats.daily[5]!;
    expect(yesterdayPoint.focusMinutes).toBe(45);
    expect(stats.focusMinutes).toBe(95);
  });

  it('30-дневный период содержит 30 точек', () => {
    const stats = computeProgressStats({
      tasks: [],
      sessions: [],
      subjects: [],
      period: resolvePeriod('30d', NOW, 1),
      now: NOW,
      weekStart: 1,
      dailyPoints: '30d',
    });
    expect(stats.daily.length).toBe(30);
  });
});

describe('Цели', () => {
  it('прогресс недельной цели по минутам учёбы', async () => {
    const { db } = await openTestDb();
    const { math } = await seedBasicData(db, NOW);
    await db.goals.create({ metric: 'study_minutes', targetValue: 120, period: 'week' }, NOW);
    await db.goals.create({ metric: 'study_minutes', targetValue: 60, period: 'week', subjectId: math.id }, NOW);
    await db.sessions.create({
      subjectId: math.id,
      startedAt: NOW + 2 * HOUR_MS,
      endedAt: NOW + 3 * HOUR_MS,
      activeSeconds: 90 * 60,
    });

    const [goals, sessions, tasks] = await Promise.all([db.goals.list(), db.sessions.listRange(NOW - DAY_MS, NOW + 7 * DAY_MS), db.tasks.list({ status: 'all' }, NOW)]);
    const progress = computeGoalProgress(goals, sessions, tasks, NOW + 3 * HOUR_MS, 1);
    const overall = progress.find((p) => p.goal.subjectId == null)!;
    expect(overall.current).toBe(90);
    expect(overall.progress).toBeCloseTo(0.75, 5);
    const bySubject = progress.find((p) => p.goal.subjectId === math.id)!;
    expect(bySubject.current).toBe(90);
    expect(bySubject.progress).toBe(1.5); // capped at 150%
  });

  it('цель по задачам считает выполненные в периоде', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);
    await db.goals.create({ metric: 'completed_tasks', targetValue: 2, period: 'week' }, NOW);
    await db.tasks.setStatus(task1.id, 'done', { now: NOW + 4 * HOUR_MS });

    const [goals, tasks, sessions] = await Promise.all([db.goals.list(), db.tasks.list({ status: 'all' }, NOW), db.sessions.listRange(0, NOW + DAY_MS)]);
    const progress = computeGoalProgress(goals, sessions, tasks, NOW + 5 * HOUR_MS, 1);
    expect(progress[0]!.current).toBe(1);
    expect(progress[0]!.progress).toBe(0.5);
  });

  it('цель на семестр требует дат и считает по ним', async () => {
    const { db } = await openTestDb();
    await db.goals.create(
      { metric: 'study_minutes', targetValue: 600, period: 'semester', periodStartAt: NOW - 30 * DAY_MS, periodEndAt: NOW + 60 * DAY_MS },
      NOW
    );
    await db.sessions.create({ startedAt: NOW - 10 * DAY_MS, endedAt: NOW - 10 * DAY_MS + HOUR_MS, activeSeconds: 60 * 60 });
    const [goals, sessions] = await Promise.all([db.goals.list(), db.sessions.listRange(NOW - 40 * DAY_MS, NOW + DAY_MS)]);
    const progress = computeGoalProgress(goals, sessions, [], NOW, 1);
    expect(progress[0]!.periodLabel).toBe('Семестр');
    expect(progress[0]!.current).toBe(60);

    // Цели семестра без дат БД не допускает
    await expect(
      db.goals.create({ metric: 'study_minutes', targetValue: 100, period: 'semester' }, NOW)
    ).rejects.toThrow();
  });

  it('сессия за границами периода цели не учитывается', async () => {
    const { db } = await openTestDb();
    await db.goals.create({ metric: 'study_minutes', targetValue: 60, period: 'week' }, NOW);
    // Сессия на прошлой неделе
    await db.sessions.create({ startedAt: NOW - 8 * DAY_MS, endedAt: NOW - 8 * DAY_MS + HOUR_MS, activeSeconds: 50 * 60 });
    const [goals, sessions] = await Promise.all([db.goals.list(), db.sessions.listRange(NOW - 40 * DAY_MS, NOW)]);
    const progress = computeGoalProgress(goals, sessions, [], NOW, 1);
    expect(progress[0]!.current).toBe(0);
    void MINUTE_MS;
  });
});
