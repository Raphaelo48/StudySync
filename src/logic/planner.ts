/**
 * Умный перепланировщик StudySync — детерминированный локальный алгоритм.
 *
 * ## Что делает
 * Распределяет незавершённые учебные задачи по свободным интервалам
 * ближайших дней, учитывая расписание, дедлайны, приоритеты, длительность,
 * сложность и обязательные паузы между задачами.
 *
 * ## Алгоритм приоритизации (документированная эвристика)
 * Задачи упорядочиваются многоуровневым компаратором (каждый следующий
 * критерий применяется только при равенстве предыдущих):
 *
 * 1. Срочность по дедлайну (классы):
 *    - 0 — просроченные (дедлайн уже наступил);
 *    - 1 — дедлайн внутри горизонта планирования;
 *    - 2 — дедлайн дальше горизонта или отсутствует.
 * 2. Более ранний дедлайн — раньше (бездедлайнные — в конце класса).
 * 3. Более высокий пользовательский приоритет — раньше.
 * 4. Более длительная задача — раньше («сначала крупные камни»: длинную задачу
 *    сложнее разместить позже, когда свободные окна измельчают).
 * 5. Более высокая сложность — раньше (сложное планируется на более ранние,
 *    менее «уставшие» слоты).
 * 6. Идентификатор задачи (лексикографически) — гарантирует детерминированность.
 *
 * Критерии НЕ равнозначны: дедлайн доминирует над приоритетом, приоритет —
 * над длительностью и т.д. Это осознанная эвристика, а не математически
 * оптимальное решение (задача о расписании с дедлайнами NP-трудна).
 *
 * ## Размещение (greedy)
 * - Горизонт: от `now` до конца дня `now + horizonDays`.
 * - Доступное время: учебное окно каждого дня (studyWindowStartMin..EndMin)
 *   минус занятые интервалы (занятия, личные события).
 * - Задачи атомарны (не режутся); размещаются в первый подходящий по длине
 *   свободный слот в порядке приоритета; задача с дедлайном размещается так,
 *   чтобы полностью завершиться до дедлайна.
 * - Между двумя задачами подряд вставляется пауза breakBetweenTasksMin.
 * - Длительность задачи не может быть меньше minChunkMinutes (нормализуется).
 *
 * ## Гарантии (проверяются тестами)
 * - Никакие две задачи не пересекаются между собой.
 * - Задачи не пересекаются с занятыми интервалами.
 * - Все интервалы положительные и находятся внутри горизонта и учебного окна.
 * - Без подтверждения пользователя данные не изменяются (модуль чистый:
 *   применение плана выполняется отдельной сервисной функцией).
 *
 * ## Перегруз
 * Если задачу нельзя завершить до дедлайна или свободного времени в горизонте
 * не хватает, задача попадает в `unplaced` с причиной и предложениями
 * (перенос срока, разделение на части, перенос на другой день). Алгоритм
 * никогда не «выдумывает» время, которого нет.
 */
import {
  DAY_MS,
  MINUTE_MS,
  addDays,
  atMinutes,
  formatDateShort,
  intervalMinutes,
  startOfDay,
  subtractIntervals,
  type Interval,
} from '../core/time';
import type { TaskDifficulty, TaskPriority } from '../models/types';

export const MIN_CHUNK_MINUTES = 5;

export interface PlannerTask {
  id: string;
  title: string;
  deadlineAt: number | null;
  plannedMinutes: number;
  priority: TaskPriority;
  difficulty: TaskDifficulty;
  subjectId?: string | null;
}

export interface PlannerSettings {
  /** Пауза между задачами подряд, минут. */
  breakBetweenTasksMin: number;
  /** Учебное окно: минуты от полуночи. */
  studyWindowStartMin: number;
  studyWindowEndMin: number;
  /** Горизонт планирования в днях (включая сегодняшний). */
  horizonDays: number;
}

export interface PlannerInput {
  now: number;
  tasks: PlannerTask[];
  /** Занятые интервалы: занятия, личные события (учебные блоки плана пересоздаются). */
  busy: Interval[];
  settings: PlannerSettings;
}

export type UnplacedReason =
  | 'no_time_before_deadline'
  | 'no_capacity_in_horizon'
  | 'too_long_for_window';

export interface PlannerAssignment {
  taskId: string;
  title: string;
  start: number;
  end: number;
  /** Человекочитаемые причины приоритизации/размещения (рус.). */
  reasons: string[];
  /** Завершается ли работа до дедлайна (для просроченных — false). */
  beforeDeadline: boolean;
  isOverdue: boolean;
}

export interface PlannerUnplaced {
  taskId: string;
  title: string;
  reason: UnplacedReason;
  plannedMinutes: number;
  deadlineAt: number | null;
  /** Предложения действия (рус.). */
  suggestions: string[];
  /** Ближайший день, когда задача физически помещается (если такой найден в горизонте). */
  possibleDay?: number;
}

export interface PlannerTotals {
  /** Сколько минут требуется всем переданным задачам (нормализованных). */
  requiredMinutes: number;
  /** Сколько свободных минут в горизонте (в учебных окнах, минус занятое). */
  availableMinutes: number;
  /** Сколько минут распределено в плане. */
  plannedMinutes: number;
}

export interface PlannerOutput {
  generatedAt: number;
  horizonStart: number;
  horizonEnd: number;
  assignments: PlannerAssignment[];
  unplaced: PlannerUnplaced[];
  /** Требуется больше времени, чем доступно в горизонте. */
  overloaded: boolean;
  totals: PlannerTotals;
  warnings: string[];
}

interface ScoredTask extends PlannerTask {
  urgencyClass: 0 | 1 | 2;
  normalizedMinutes: number;
  isOverdue: boolean;
}

function scoreTasks(tasks: PlannerTask[], now: number, horizonEnd: number): ScoredTask[] {
  return tasks.map((t) => {
    const isOverdue = t.deadlineAt != null && t.deadlineAt < now;
    const urgencyClass: 0 | 1 | 2 =
      t.deadlineAt == null
        ? 2
        : isOverdue
          ? 0
          : t.deadlineAt <= horizonEnd
            ? 1
            : 2;
    const normalizedMinutes = Math.max(MIN_CHUNK_MINUTES, Math.round(t.plannedMinutes));
    return { ...t, urgencyClass, normalizedMinutes, isOverdue };
  });
}

/** Многоуровневый компаратор приоритизации (см. документацию модуля). */
export function compareTasks(a: ScoredTask, b: ScoredTask): number {
  if (a.urgencyClass !== b.urgencyClass) return a.urgencyClass - b.urgencyClass;
  const aDl = a.deadlineAt ?? Number.POSITIVE_INFINITY;
  const bDl = b.deadlineAt ?? Number.POSITIVE_INFINITY;
  if (aDl !== bDl) return aDl < bDl ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.normalizedMinutes !== b.normalizedMinutes) return b.normalizedMinutes - a.normalizedMinutes;
  if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Учебные окна по дням горизонта, обрезанные по `now` и концу горизонта. */
function computeDayWindows(now: number, horizonEnd: number, settings: PlannerSettings): Interval[] {
  const windows: Interval[] = [];
  const firstDay = startOfDay(now);
  for (let day = firstDay; day <= horizonEnd; day = addDays(day, 1)) {
    let start = atMinutes(day, settings.studyWindowStartMin);
    const end = atMinutes(day, settings.studyWindowEndMin);
    if (start < now) start = now;
    if (end > horizonEnd) continue;
    if (end > start) windows.push({ start, end });
    // Защита от pathological настроек: не более 400 дней.
    if (windows.length > 400) break;
  }
  return windows;
}

function reasonsForTask(t: ScoredTask, beforeDeadline: boolean): string[] {
  const reasons: string[] = [];
  if (t.isOverdue) {
    reasons.push('Дедлайн просрочен — задача размещена в ближайшее свободное время');
  } else if (t.deadlineAt != null) {
    reasons.push(`Дедлайн ${formatDateShort(t.deadlineAt)} — учтён при размещении`);
    if (beforeDeadline) reasons.push('Планируется завершить до наступления срока');
  } else {
    reasons.push('Без дедлайна — размещена по приоритету после срочных задач');
  }
  if (t.priority === 3) reasons.push('Высокий пользовательский приоритет');
  else if (t.priority === 1) reasons.push('Низкий пользовательский приоритет');
  if (t.difficulty === 3) reasons.push('Сложная задача — запланирована раньше более простых');
  if (t.normalizedMinutes > t.plannedMinutes) {
    reasons.push(`Длительность увеличена до минимальных ${t.normalizedMinutes} мин`);
  }
  return reasons;
}

/**
 * Построить план. Чистая функция: одинаковые входные данные → одинаковый план.
 * Не изменяет никакие данные — только возвращает предложение.
 */
export function buildPlan(input: PlannerInput): PlannerOutput {
  const { now, busy, settings } = input;
  const horizonEndDay = startOfDay(addDays(now, Math.max(1, settings.horizonDays) - 1));
  const horizonEnd = Math.min(horizonEndDay + DAY_MS, atMinutes(horizonEndDay, 24 * 60));

  const breakMs = Math.max(0, settings.breakBetweenTasksMin) * MINUTE_MS;
  const windows = computeDayWindows(now, horizonEnd, settings);
  // Свободное время = окна минус занятое.
  let free: Interval[] = [];
  for (const w of windows) {
    free.push(...subtractIntervals(w, busy.filter((b) => b.end > w.start && b.start < w.end)));
  }
  free.sort((a, b) => a.start - b.start);

  const availableMinutes = free.reduce((s, iv) => s + intervalMinutes(iv), 0);
  const scored = scoreTasks(input.tasks, now, horizonEnd).sort(compareTasks);
  const requiredMinutes = scored.reduce((s, t) => s + t.normalizedMinutes, 0);

  const assignments: PlannerAssignment[] = [];
  const unplaced: PlannerUnplaced[] = [];
  const warnings: string[] = [];

  for (const task of scored) {
    const needMs = task.normalizedMinutes * MINUTE_MS;
    if (needMs > (settings.studyWindowEndMin - settings.studyWindowStartMin) * MINUTE_MS) {
      unplaced.push({
        taskId: task.id,
        title: task.title,
        reason: 'too_long_for_window',
        plannedMinutes: task.normalizedMinutes,
        deadlineAt: task.deadlineAt,
        suggestions: [
          'Задача длиннее учебного окна — разделите её на несколько частей',
          'Увеличьте учебное окно в настройках (Профиль → Учебное окно)',
        ],
      });
      continue;
    }

    // Ограничение дедлайна: задача должна завершиться не позже дедлайна
    // (для просроченных ограничение не применяется — размещаем как можно раньше).
    const latestEnd =
      task.deadlineAt != null && !task.isOverdue ? Math.min(task.deadlineAt, horizonEnd) : horizonEnd;

    let placed = false;
    for (let i = 0; i < free.length; i += 1) {
      const slot = free[i]!;
      if (slot.end - slot.start < needMs) continue;
      const start = slot.start;
      const end = start + needMs;
      if (end > latestEnd) {
        // В этом слоте не успеть до дедлайна; более поздние слоты — тем более.
        break;
      }
      // Разместить: вычесть задачу и паузу после неё из свободного времени.
      const consumedEnd = Math.min(end + breakMs, slot.end);
      const remainder: Interval[] = [];
      if (consumedEnd < slot.end) remainder.push({ start: consumedEnd, end: slot.end });
      free.splice(i, 1, ...remainder);
      const beforeDeadline = task.deadlineAt == null || end <= task.deadlineAt;
      assignments.push({
        taskId: task.id,
        title: task.title,
        start,
        end,
        reasons: reasonsForTask(task, beforeDeadline),
        beforeDeadline,
        isOverdue: task.isOverdue,
      });
      placed = true;
      break;
    }

    if (!placed) {
      const hasDeadlineProblem =
        task.deadlineAt != null && !task.isOverdue && task.deadlineAt <= horizonEnd;
      // Поиск дня, где задача физически поместилась бы (по остаткам свободного).
      const possibleDay = findPossibleDay(free, needMs);
      const suggestions: string[] = [];
      if (hasDeadlineProblem) {
        suggestions.push(
          possibleDay != null
            ? `Перенести дедлайн: ближайшая возможность — ${formatDateShort(possibleDay)}`
            : 'Перенести дедлайн: в текущем горизонте нет места для задачи'
        );
        suggestions.push('Разделить задачу на несколько частей и распределить их по дням');
        unplaced.push({
          taskId: task.id,
          title: task.title,
          reason: 'no_time_before_deadline',
          plannedMinutes: task.normalizedMinutes,
          deadlineAt: task.deadlineAt,
          suggestions,
          possibleDay: possibleDay ?? undefined,
        });
      } else {
        suggestions.push(
          possibleDay != null
            ? `Перенести на ${formatDateShort(possibleDay)} — там достаточно свободного времени`
            : 'Освободить время: перенести часть занятий или других задач'
        );
        suggestions.push('Увеличить горизонт планирования в настройках или снизить нагрузку дня');
        unplaced.push({
          taskId: task.id,
          title: task.title,
          reason: 'no_capacity_in_horizon',
          plannedMinutes: task.normalizedMinutes,
          deadlineAt: task.deadlineAt,
          suggestions,
          possibleDay: possibleDay ?? undefined,
        });
      }
    }
  }

  assignments.sort((a, b) => a.start - b.start);

  const overdueCount = scored.filter((t) => t.isOverdue).length;
  if (overdueCount > 0) {
    const word = overdueCount === 1 ? 'просроченная задача' : 'просроченных задач';
    warnings.push(`В плане учтено ${overdueCount} ${word} — они размещены в ближайшее свободное время. Рекомендуется пересмотреть их дедлайны.`);
  }
  if (requiredMinutes > availableMinutes) {
    warnings.push(
      `Перегруз: задачам нужно ${Math.round(requiredMinutes / 60)} ч, а свободно ${Math.round(availableMinutes / 60)} ч в выбранных учебных окнах. Часть задач перенесена в список неразмещённых.`
    );
  }

  return {
    generatedAt: now,
    horizonStart: now,
    horizonEnd,
    assignments,
    unplaced,
    overloaded: requiredMinutes > availableMinutes,
    totals: {
      requiredMinutes,
      availableMinutes,
      plannedMinutes: assignments.reduce((s, a) => s + intervalMinutes({ start: a.start, end: a.end }), 0),
    },
    warnings,
  };
}

/** Первый день (метка начала дня), в оставшихся свободных интервалах которого помещается needMs. */
function findPossibleDay(free: Interval[], needMs: number): number | null {
  for (const iv of free) {
    if (iv.end - iv.start >= needMs) return startOfDay(iv.start);
  }
  return null;
}

/**
 * Инварианты корректного плана — используются и в тестах, и для самопроверки.
 * Возвращает список нарушений (пустой — план корректен).
 */
export function validatePlan(plan: PlannerOutput, input: PlannerInput): string[] {
  const problems: string[] = [];
  const busySorted = [...input.busy].sort((a, b) => a.start - b.start);
  const sorted = [...plan.assignments].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    if (a.end <= a.start) problems.push(`Отрицательный интервал у задачи ${a.taskId}`);
    if (a.start < input.now) problems.push(`Задача ${a.taskId} запланирована в прошлом`);
    if (a.end > plan.horizonEnd) problems.push(`Задача ${a.taskId} выходит за горизонт`);
    for (const b of busySorted) {
      if (a.start < b.end && b.start < a.end) {
        problems.push(`Задача ${a.taskId} пересекается с занятым интервалом`);
      }
    }
    const next = sorted[i + 1];
    if (next && next.start < a.end) {
      problems.push(`Задачи ${a.taskId} и ${next.taskId} пересекаются`);
    }
  }
  // Учебные окна
  for (const a of sorted) {
    const dayStart = startOfDay(a.start);
    const wStart = atMinutes(dayStart, input.settings.studyWindowStartMin);
    const wEnd = atMinutes(dayStart, input.settings.studyWindowEndMin);
    if (a.start < Math.max(wStart, input.now) || a.end > wEnd) {
      problems.push(`Задача ${a.taskId} вне учебного окна дня`);
    }
  }
  return problems;
}
