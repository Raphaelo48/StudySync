/**
 * Сервис перепланирования: связывает чистый алгоритм (planner.ts) с базой данных.
 *
 * Ключевые правила:
 * - Расчёт плана НЕ изменяет данные.
 * - Применение («Применить план») выполняется только по явному действию
 *   пользователя, в одной транзакции; созданные события запоминаются,
 *   чтобы план можно было отменить («Отменить применение»).
 */
import type { AppDatabase } from '../db/database';
import { newId } from '../core/id';
import { addDays, endOfDay } from '../core/time';
import type { ID } from '../models/types';
import {
  buildPlan,
  validatePlan,
  type PlannerInput,
  type PlannerOutput,
  type PlannerSettings,
} from './planner';

export interface PlanContext {
  input: PlannerInput;
  output: PlannerOutput;
}

/** Собрать вход алгоритма из актуальных данных БД. */
export async function gatherPlannerInput(db: AppDatabase, now: number = Date.now()): Promise<PlannerInput> {
  const settings = await db.settings.get();
  const activeTasks = await db.tasks.listActive();
  const horizonEnd = endOfDay(addDays(now, Math.max(1, settings.planningHorizonDays) - 1));

  const taskIds = new Set(activeTasks.map((t) => t.id));
  const events = await db.events.listUpcoming(now, 500);
  // Занятое время: занятия, личные события и учебные блоки завершенных/несвязанных задач.
  // Блоки перепланируемых задач исключаются — план пересоздаст их.
  const busy = events
    .filter((e) => e.kind !== 'study' || e.taskId == null || !taskIds.has(e.taskId))
    .filter((e) => e.endAt > now && e.startAt <= horizonEnd)
    .map((e) => ({ start: e.startAt, end: e.endAt }));

  const plannerSettings: PlannerSettings = {
    breakBetweenTasksMin: settings.breakBetweenTasksMin,
    studyWindowStartMin: settings.studyWindowStartMin,
    studyWindowEndMin: settings.studyWindowEndMin,
    horizonDays: settings.planningHorizonDays,
  };

  return {
    now,
    busy,
    settings: plannerSettings,
    tasks: activeTasks.map((t) => ({
      id: t.id,
      title: t.title,
      deadlineAt: t.deadlineAt,
      plannedMinutes: t.plannedMinutes,
      priority: t.priority,
      difficulty: t.difficulty,
      subjectId: t.subjectId,
    })),
  };
}

/** Рассчитать план и самопроверить инварианты. Бросает исключение при нарушении. */
export async function computePlan(db: AppDatabase, now: number = Date.now()): Promise<PlanContext> {
  const input = await gatherPlannerInput(db, now);
  const output = buildPlan(input);
  const violations = validatePlan(output, input);
  if (violations.length > 0) {
    // Внутренняя ошибка алгоритма — данные не трогаем, сообщаем разработчески точно.
    throw new Error(`Нарушены инварианты плана: ${violations.join('; ')}`);
  }
  return { input, output };
}

export interface ApplyPlanResult {
  planRecordId: ID;
  createdEventIds: ID[];
  /** Удалённые будущие учебные блоки (для отмены их уведомлений). */
  removedEventIds: ID[];
  movedTaskCount: number;
}

/**
 * Применить план: пересоздать учебные блоки задач и зафиксировать окна в задачах.
 * Выполняется в одной транзакции.
 */
export async function applyPlan(
  db: AppDatabase,
  ctx: PlanContext,
  now: number = Date.now()
): Promise<ApplyPlanResult> {
  const planRecord = await db.plans.add(JSON.stringify(ctx.output), now);
  const createdEventIds: ID[] = [];
  const removedEventIds: ID[] = [];

  // План пересоздаёт только будущие блоки. Прошедшие и идущие сейчас остаются:
  // это история занятий, её видно в расписании и аналитике.
  const removeFutureBlocks = async (taskId: ID) => {
    const oldBlocks = await db.events.listStudyBlocksForTask(taskId);
    for (const block of oldBlocks) {
      if (block.startAt < now) continue;
      await db.events.delete(block.id);
      removedEventIds.push(block.id);
    }
  };

  await db.driver.transaction(async () => {
    const assignedTaskIds = new Set(ctx.output.assignments.map((a) => a.taskId));

    // Удалить прежние будущие учебные блоки этих задач (план пересоздаёт их).
    for (const taskId of assignedTaskIds) {
      await removeFutureBlocks(taskId);
    }

    const taskById = new Map(ctx.input.tasks.map((t) => [t.id, t]));

    for (const assignment of ctx.output.assignments) {
      const task = taskById.get(assignment.taskId);
      const event = await db.events.create(
        {
          title: assignment.title,
          kind: 'study',
          taskId: assignment.taskId,
          subjectId: task?.subjectId ?? null,
          startAt: assignment.start,
          endAt: assignment.end,
          notes: 'Запланировано перепланировщиком StudySync',
        },
        now
      );
      createdEventIds.push(event.id);
      await db.tasks.update(
        assignment.taskId,
        { scheduledStartAt: assignment.start, scheduledEndAt: assignment.end },
        now
      );
    }

    // Задачи, не вошедшие в план, теряют устаревшие блоки и метки расписания.
    for (const unplaced of ctx.output.unplaced) {
      await removeFutureBlocks(unplaced.taskId);
      await db.tasks.update(unplaced.taskId, { scheduledStartAt: null, scheduledEndAt: null }, now);
    }

    await db.plans.markApplied(planRecord.id, createdEventIds, now);
  });

  return {
    planRecordId: planRecord.id,
    createdEventIds,
    removedEventIds,
    movedTaskCount: ctx.output.assignments.length,
  };
}

/**
 * Отменить применение плана: удалить созданные учебные блоки и снять
 * метки расписания с затронутых задач. Исходное расписание не меняется.
 */
export async function revertPlan(db: AppDatabase, planRecordId: ID): Promise<{ removedEvents: number }> {
  const record = await db.plans.get(planRecordId);
  if (!record) throw new Error('Запись плана не найдена');
  if (!record.applied || record.createdEventIds == null) {
    return { removedEvents: 0 };
  }
  let removedEvents = 0;
  await db.driver.transaction(async () => {
    const events = record.createdEventIds ?? [];
    // Снять scheduled_* у задач, чьи блоки удаляем.
    for (const eventId of events) {
      const ev = await db.events.get(eventId);
      if (ev?.taskId) {
        await db.tasks.update(ev.taskId, { scheduledStartAt: null, scheduledEndAt: null });
      }
    }
    removedEvents = await db.events.deleteMany(events);
    await db.plans.markReverted(planRecordId);
  });
  return { removedEvents };
}
