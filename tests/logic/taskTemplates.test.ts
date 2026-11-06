import { openTestDb, fixedNow } from '../support/helpers';
import { TASK_TEMPLATES, getTemplate, isCompressed, planStages, templateTitle } from '../../src/logic/taskTemplates';
import { buildDigest } from '../../src/logic/morningDigest';
import { DAY_MS, HOUR_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow(); // пн 12.10.2026 10:00
const day = (d: number, h = 0) => startOfDay(NOW) + d * DAY_MS + h * HOUR_MS;
const coursework = getTemplate('coursework')!;

describe('Шаблоны задач', () => {
  it('все шаблоны: последний этап — сдача (0 дней), этапы по убыванию отступа', () => {
    for (const t of TASK_TEMPLATES) {
      expect(t.stages[t.stages.length - 1]!.daysBefore).toBe(0);
      const offsets = t.stages.map((s) => s.daysBefore);
      expect([...offsets].sort((a, b) => b - a)).toEqual(offsets);
      expect(t.plannedMinutes).toBeLessThanOrEqual(24 * 60);
    }
  });

  it('полный срок: даты этапов по шаблону, последний — ровно дедлайн', () => {
    const deadline = day(60, 10);
    const stages = planStages(coursework, deadline, NOW);
    expect(stages).toHaveLength(9);
    expect(stages[0]!.dueAt).toBe(day(4 + 1) - 60_000); // 60−56 = 4-й день, конец дня
    expect(stages[stages.length - 1]!.dueAt).toBe(deadline);
    expect(isCompressed(coursework, deadline, NOW)).toBe(false);
  });

  it('мало времени: этапы сжимаются, ничего не раньше сегодня, порядок сохранён', () => {
    const deadline = day(14, 10);
    const stages = planStages(coursework, deadline, NOW);
    expect(isCompressed(coursework, deadline, NOW)).toBe(true);
    expect(stages[0]!.dueAt).toBeGreaterThanOrEqual(NOW);
    for (let i = 1; i < stages.length; i += 1) expect(stages[i]!.dueAt).toBeGreaterThanOrEqual(stages[i - 1]!.dueAt);
    expect(stages[stages.length - 1]!.dueAt).toBe(deadline);
    // Выбор темы — сегодня (14 дн. на всё), оформление — примерно за 2–3 дня.
    expect(stages[0]!.dueAt).toBe(day(1) - 60_000);
  });

  it('дедлайн сегодня — все этапы сегодня', () => {
    const deadline = day(0, 20);
    const stages = planStages(getTemplate('lab')!, deadline, NOW);
    expect(stages.every((s) => s.dueAt <= deadline && s.dueAt >= NOW)).toBe(true);
  });

  it('название подставляет предмет', () => {
    expect(templateTitle(coursework, 'Маркетинг')).toBe('Курсовая работа: Маркетинг');
    expect(templateTitle(coursework, null)).toBe('Курсовая работа');
  });

  it('этапы со сроком попадают в утреннюю сводку (кроме этапа-сдачи)', async () => {
    const { db } = await openTestDb();
    const deadline = day(14, 10);
    const task = await db.tasks.create({ title: 'Курсовая работа', deadlineAt: deadline }, NOW);
    for (const s of planStages(coursework, deadline, NOW)) await db.subtasks.create(task.id, s.title, NOW, s.dueAt);
    const due = (await db.subtasks.listDueBetween(day(0), day(20))).map((s) => ({ ...s, dueAt: s.dueAt as number }));
    expect(due.some((s) => s.dueAt === deadline)).toBe(false);
    const firstDay = due[0]!;
    const digest = buildDigest(startOfDay(firstDay.dueAt), [], await db.tasks.list({ status: 'active' }, NOW), [], due)!;
    expect(digest.body).toContain(`Этап: ${firstDay.title} (Курсовая работа) — сегодня`);
  });
});
