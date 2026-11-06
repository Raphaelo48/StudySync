/**
 * Регрессионные тесты на критичные ошибки, найденные при ревью:
 * источник события сохраняется при чтении и правке, резервная копия читается,
 * завершение таймера после удаления задачи, применение плана сохраняет историю.
 */
import { openTestDb, fixedNow, seedBasicData } from '../support/helpers';
import { exportAll, parseBackup, serializeBackup, importBackup } from '../../src/logic/backup';
import { startTimer } from '../../src/logic/timerModel';
import { IDLE_TIMER_STATE } from '../../src/models/types';
import { finishTimerSession } from '../../src/logic/sessionService';
import { computePlan, applyPlan } from '../../src/logic/planService';
import { DAY_MS, HOUR_MS } from '../../src/core/time';

const NOW = fixedNow();

describe('Источник события сохраняется', () => {
  it('ручное редактирование импортированного события не сбрасывает источник', async () => {
    const { db } = await openTestDb();
    const ev = await db.events.create(
      { title: 'Консультация', kind: 'personal', startAt: NOW + DAY_MS, endAt: NOW + DAY_MS + HOUR_MS, source: 'kgeu', sourceRef: '5:9' },
      NOW
    );
    await db.events.update(ev.id, { location: 'ауд. 101' }, NOW);
    expect((await db.events.get(ev.id))?.source).toBe('kgeu');
  });

  it('события КГЭУ видны как kgeu в listRange (значок «КГЭУ»)', async () => {
    const { db } = await openTestDb();
    await db.events.create(
      { title: 'Лекция', kind: 'lesson', startAt: NOW + HOUR_MS, endAt: NOW + 2 * HOUR_MS, source: 'kgeu', sourceRef: 'k:1' },
      NOW
    );
    const [ev] = await db.events.listRange(NOW, NOW + DAY_MS);
    expect(ev!.source).toBe('kgeu');
  });
});

describe('Резервная копия с импортированными событиями', () => {
  it('экспорт → разбор → импорт проходят и сохраняют источник', async () => {
    const { db } = await openTestDb();
    await db.events.create(
      { title: 'Лекция', kind: 'lesson', startAt: NOW + DAY_MS, endAt: NOW + DAY_MS + HOUR_MS, source: 'kgeu', sourceRef: '5:3' },
      NOW
    );
    const json = serializeBackup(await exportAll(db, NOW));
    const parsed = parseBackup(json);
    expect(parsed.data.events[0]!.source).toBe('kgeu');

    const target = await openTestDb();
    await importBackup(target.db, parsed, 'replace', NOW + 1000);
    const restored = await target.db.events.listBySourceRefPrefix('kgeu', '5:');
    expect(restored.length).toBe(1);
  });
});

describe('Таймер после удаления задачи', () => {
  it('сессия сохраняется без ссылки на задачу, таймер сбрасывается', async () => {
    const { db } = await openTestDb();
    const { task1, math } = await seedBasicData(db, NOW);
    const state = startTimer(
      IDLE_TIMER_STATE,
      { mode: 'pomodoro', taskId: task1.id, subjectId: math.id, workSec: 1500, breakSec: 300, longBreakSec: 900, cyclesBeforeLongBreak: 4 },
      NOW
    );
    await db.timer.ensureRow(IDLE_TIMER_STATE, NOW);
    await db.timer.save(state, NOW);

    await db.tasks.delete(task1.id);
    await db.subjects.delete(math.id);
    // Пауза/сохранение состояния со «старым» taskId из памяти тоже не должны падать
    await expect(db.timer.save(state, NOW + 60_000)).resolves.toBeUndefined();

    const result = await finishTimerSession(db, state, NOW + 30 * 60_000);
    expect(result.saved).toBe(true);
    expect(result.session?.taskId).toBeNull();
    expect(result.session?.subjectId).toBeNull();
    expect((await db.timer.get(IDLE_TIMER_STATE)).status).toBe('idle');
  });
});

describe('Применение плана сохраняет историю', () => {
  it('прошедшие учебные блоки остаются, будущие пересоздаются', async () => {
    const { db } = await openTestDb();
    const { task1 } = await seedBasicData(db, NOW);
    const past = await db.events.create(
      { title: 'Было', kind: 'study', taskId: task1.id, startAt: NOW - 2 * DAY_MS, endAt: NOW - 2 * DAY_MS + HOUR_MS },
      NOW
    );
    const future = await db.events.create(
      { title: 'Будет', kind: 'study', taskId: task1.id, startAt: NOW + 5 * DAY_MS, endAt: NOW + 5 * DAY_MS + HOUR_MS },
      NOW
    );

    const ctx = await computePlan(db, NOW);
    const touched =
      ctx.output.assignments.some((a) => a.taskId === task1.id) ||
      ctx.output.unplaced.some((u) => u.taskId === task1.id);
    expect(touched).toBe(true);

    const result = await applyPlan(db, ctx, NOW);
    expect(await db.events.get(past.id)).not.toBeNull();
    expect(await db.events.get(future.id)).toBeNull();
    expect(result.removedEventIds).toContain(future.id);
    expect(result.removedEventIds).not.toContain(past.id);
  });
});
