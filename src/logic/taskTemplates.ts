/**
 * Шаблоны больших учебных работ: курсовая, лабораторная, реферат, подготовка
 * к экзамену, практика. Шаблон создаёт задачу с этапами-подзадачами, у каждого
 * этапа свой срок, отсчитанный от даты сдачи/защиты.
 *
 * Если до сдачи меньше времени, чем рассчитан шаблон, сроки этапов сжимаются
 * пропорционально (порядок этапов сохраняется, в прошлое ничего не попадает).
 */
import type { Ionicons } from '@expo/vector-icons';
import { DAY_MS, startOfDay } from '../core/time';
import type { Timestamp } from '../core/time';

export interface TemplateStage {
  title: string;
  /** За сколько дней до сдачи должен быть готов этап (0 — день сдачи). */
  daysBefore: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Название задачи; {subject} заменяется на предмет. */
  titlePattern: string;
  deadlineLabel: string;
  plannedMinutes: number;
  difficulty: 1 | 2 | 3;
  priority: 1 | 2 | 3;
  stages: TemplateStage[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'coursework',
    name: 'Курсовая работа',
    icon: 'document-text-outline',
    titlePattern: 'Курсовая работа{subject}',
    deadlineLabel: 'Дата защиты',
    plannedMinutes: 20 * 60,
    difficulty: 3,
    priority: 3,
    stages: [
      { title: 'Выбрать и согласовать тему', daysBefore: 56 },
      { title: 'Подобрать литературу', daysBefore: 49 },
      { title: 'Введение и глава 1 (теория)', daysBefore: 35 },
      { title: 'Глава 2 (практика)', daysBefore: 21 },
      { title: 'Заключение и список литературы', daysBefore: 14 },
      { title: 'Оформить по методичке', daysBefore: 10 },
      { title: 'Сдать на проверку руководителю', daysBefore: 7 },
      { title: 'Исправить замечания, подготовить доклад', daysBefore: 3 },
      { title: 'Защита', daysBefore: 0 },
    ],
  },
  {
    id: 'lab',
    name: 'Лабораторная',
    icon: 'flask-outline',
    titlePattern: 'Лабораторная работа{subject}',
    deadlineLabel: 'Дата защиты',
    plannedMinutes: 4 * 60,
    difficulty: 2,
    priority: 2,
    stages: [
      { title: 'Изучить методичку', daysBefore: 7 },
      { title: 'Выполнить работу и расчёты', daysBefore: 5 },
      { title: 'Оформить отчёт', daysBefore: 2 },
      { title: 'Подготовить ответы на контрольные вопросы', daysBefore: 1 },
      { title: 'Защита', daysBefore: 0 },
    ],
  },
  {
    id: 'essay',
    name: 'Реферат',
    icon: 'reader-outline',
    titlePattern: 'Реферат{subject}',
    deadlineLabel: 'Дата сдачи',
    plannedMinutes: 6 * 60,
    difficulty: 2,
    priority: 2,
    stages: [
      { title: 'Тема и план', daysBefore: 14 },
      { title: 'Подобрать источники', daysBefore: 10 },
      { title: 'Написать текст', daysBefore: 5 },
      { title: 'Оформить и проверить', daysBefore: 2 },
      { title: 'Сдать', daysBefore: 0 },
    ],
  },
  {
    id: 'exam',
    name: 'Подготовка к экзамену',
    icon: 'school-outline',
    titlePattern: 'Экзамен{subject}',
    deadlineLabel: 'Дата экзамена',
    plannedMinutes: 15 * 60,
    difficulty: 3,
    priority: 3,
    stages: [
      { title: 'Собрать билеты, конспекты, лекции', daysBefore: 14 },
      { title: 'Выучить первую треть билетов', daysBefore: 11 },
      { title: 'Выучить вторую треть билетов', daysBefore: 7 },
      { title: 'Выучить последнюю треть билетов', daysBefore: 4 },
      { title: 'Повторить всё', daysBefore: 2 },
      { title: 'Пробный прогон: ответить на случайные билеты', daysBefore: 1 },
      { title: 'Экзамен', daysBefore: 0 },
    ],
  },
  {
    id: 'practice',
    name: 'Практика',
    icon: 'briefcase-outline',
    titlePattern: 'Практика{subject}',
    deadlineLabel: 'Сдача отчёта',
    plannedMinutes: 10 * 60,
    difficulty: 2,
    priority: 2,
    stages: [
      { title: 'Получить задание и индивидуальный план', daysBefore: 28 },
      { title: 'Собрать материалы в организации', daysBefore: 14 },
      { title: 'Черновик отчёта и дневника', daysBefore: 7 },
      { title: 'Подписи и характеристика от организации', daysBefore: 3 },
      { title: 'Сдать отчёт', daysBefore: 0 },
    ],
  },
];

export function getTemplate(id: string | null | undefined): TaskTemplate | null {
  return TASK_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function templateTitle(template: TaskTemplate, subjectName: string | null): string {
  return template.titlePattern.replace('{subject}', subjectName ? `: ${subjectName}` : '');
}

export interface PlannedStage {
  title: string;
  dueAt: Timestamp;
}

/** Конец дня — срок промежуточного этапа. */
const endOfDayTs = (ts: Timestamp) => startOfDay(ts) + DAY_MS - 60_000;

/**
 * Сроки этапов. Последний этап (daysBefore = 0) — ровно дедлайн задачи,
 * промежуточные — конец соответствующего дня. Если до дедлайна меньше дней,
 * чем нужно шаблону, отступы сжимаются пропорционально; самый ранний этап
 * не раньше сегодняшнего дня.
 */
export function planStages(template: TaskTemplate, deadlineAt: Timestamp, now: Timestamp = Date.now()): PlannedStage[] {
  const nominal = Math.max(...template.stages.map((s) => s.daysBefore), 0);
  const available = Math.max(0, Math.floor((startOfDay(deadlineAt) - startOfDay(now)) / DAY_MS));
  const scale = nominal > available && nominal > 0 ? available / nominal : 1;

  let prevDue = -Infinity;
  return template.stages.map((stage) => {
    if (stage.daysBefore === 0) return { title: stage.title, dueAt: deadlineAt };
    const days = Math.round(stage.daysBefore * scale);
    let dueAt = Math.min(endOfDayTs(startOfDay(deadlineAt) - days * DAY_MS), deadlineAt);
    // Порядок этапов сохраняем: срок не раньше предыдущего этапа.
    if (dueAt < prevDue) dueAt = prevDue;
    prevDue = dueAt;
    return { title: stage.title, dueAt };
  });
}

/** Сжаты ли сроки (для подсказки в форме). */
export function isCompressed(template: TaskTemplate, deadlineAt: Timestamp, now: Timestamp = Date.now()): boolean {
  const nominal = Math.max(...template.stages.map((s) => s.daysBefore), 0);
  const available = Math.floor((startOfDay(deadlineAt) - startOfDay(now)) / DAY_MS);
  return available < nominal;
}
