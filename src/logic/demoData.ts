/**
 * Демо-данные: чтобы новый пользователь сразу увидел приложение «в работе» —
 * расписание на две недели, задачи (в том числе курсовую по шаблону), долги,
 * конспект, прошедшие фокус-сессии для статистики и недельную цель.
 *
 * Все записи помечаются sourceRef с префиксом «demo:» (где есть такое поле) или
 * создаются в обычных таблицах; удаляются вместе со всеми данными через сброс.
 */
import type { AppDatabase } from '../db/database';
import { DAY_MS, HOUR_MS, startOfDay, startOfWeek } from '../core/time';
import { SUBJECT_COLORS } from '../models/types';
import { defaultChecklist } from './debts';
import { getTemplate, planStages } from './taskTemplates';
import { lessonKeyFor } from './lessonNotes';

const MIN = 60_000;

/** Пары КГЭУ: начало в минутах от полуночи. */
const PAIR_START = [8 * 60, 9 * 60 + 40, 11 * 60 + 20, 13 * 60 + 30, 15 * 60 + 10];
const PAIR_LEN = 90;

interface DemoLesson {
  weekday: number; // 1 = пн … 5 = пт
  pair: number; // 1..5
  subject: number; // индекс в SUBJECTS
  kind: 'Лекция' | 'Практическое занятие' | 'Лабораторная работа';
  room: string;
}

const SUBJECTS = [
  { name: 'Маркетинг ИТ-продуктов', teacherLecture: 'Петрова Анна Сергеевна', teacherPractice: 'Петрова А. С.' },
  { name: 'Базы данных', teacherLecture: 'Гарипов Ильдар Рустамович', teacherPractice: 'Иванова Е. В.' },
  { name: 'Управление ИТ-проектами', teacherLecture: 'Сафин Марат Ильдарович', teacherPractice: 'Сафин М. И.' },
  { name: 'Иностранный язык', teacherLecture: 'Хасанова Л. Р.', teacherPractice: 'Хасанова Л. Р.' },
  { name: 'Физическая культура', teacherLecture: 'Николаев С. А.', teacherPractice: 'Николаев С. А.' },
];

const LESSONS: DemoLesson[] = [
  { weekday: 1, pair: 2, subject: 0, kind: 'Лекция', room: 'Б-301' },
  { weekday: 1, pair: 3, subject: 1, kind: 'Лабораторная работа', room: 'А-212' },
  { weekday: 2, pair: 1, subject: 4, kind: 'Практическое занятие', room: 'Спортзал' },
  { weekday: 2, pair: 2, subject: 2, kind: 'Лекция', room: 'В-105' },
  { weekday: 2, pair: 3, subject: 3, kind: 'Практическое занятие', room: 'Д-417' },
  { weekday: 3, pair: 2, subject: 1, kind: 'Лекция', room: 'Б-208' },
  { weekday: 3, pair: 3, subject: 0, kind: 'Практическое занятие', room: 'Б-315' },
  { weekday: 4, pair: 3, subject: 2, kind: 'Практическое занятие', room: 'В-210' },
  { weekday: 4, pair: 4, subject: 1, kind: 'Лабораторная работа', room: 'А-212' },
  { weekday: 5, pair: 2, subject: 3, kind: 'Практическое занятие', room: 'Д-417' },
  { weekday: 5, pair: 3, subject: 4, kind: 'Практическое занятие', room: 'Спортзал' },
];

export interface DemoSeedResult {
  subjects: number;
  lessons: number;
  tasks: number;
  debts: number;
  sessions: number;
}

/** Есть ли уже пользовательские данные (тогда демо не добавляем, чтобы не смешивать). */
export async function hasUserData(db: AppDatabase): Promise<boolean> {
  const row = await db.driver.getFirst<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM subjects) + (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM events) AS n`
  );
  return (row?.n ?? 0) > 0;
}

export async function seedDemoData(db: AppDatabase, now: number = Date.now()): Promise<DemoSeedResult> {
  const result: DemoSeedResult = { subjects: 0, lessons: 0, tasks: 0, debts: 0, sessions: 0 };
  const today = startOfDay(now);
  const day = (d: number, h = 0, m = 0) => today + d * DAY_MS + h * HOUR_MS + m * MIN;

  await db.driver.transaction(async () => {
    // Предметы
    const subjectIds: string[] = [];
    for (let i = 0; i < SUBJECTS.length; i += 1) {
      const s = await db.subjects.create({ name: SUBJECTS[i]!.name, color: SUBJECT_COLORS[i % SUBJECT_COLORS.length]! }, now);
      subjectIds.push(s.id);
      result.subjects += 1;
    }

    // Расписание: прошлая, текущая и следующая недели (пн–пт)
    const week0 = startOfWeek(now, 1);
    const lessonEvents: Array<{ id: string; subjectId: string; title: string; startAt: number }> = [];
    for (let w = -1; w <= 1; w += 1) {
      for (const l of LESSONS) {
        const dayStart = week0 + (w * 7 + l.weekday - 1) * DAY_MS;
        const startAt = dayStart + PAIR_START[l.pair - 1]! * MIN;
        const subject = SUBJECTS[l.subject]!;
        const teacher = l.kind === 'Лекция' ? subject.teacherLecture : subject.teacherPractice;
        const ev = await db.events.create(
          {
            title: subject.name,
            kind: 'lesson',
            subjectId: subjectIds[l.subject]!,
            location: l.room,
            startAt,
            endAt: startAt + PAIR_LEN * MIN,
            notes: `${l.kind} · ${teacher} · пара №${l.pair}`,
            sourceRef: `demo:${w}:${l.weekday}:${l.pair}`,
          },
          now
        );
        lessonEvents.push({ id: ev.id, subjectId: subjectIds[l.subject]!, title: ev.title, startAt });
        result.lessons += 1;
      }
    }

    // Задачи
    const coursework = getTemplate('coursework')!;
    const cwDeadline = day(40, 10);
    const cw = await db.tasks.create(
      {
        title: 'Курсовая работа: Управление ИТ-проектами',
        subjectId: subjectIds[2]!,
        deadlineAt: cwDeadline,
        plannedMinutes: coursework.plannedMinutes,
        difficulty: 3,
        priority: 3,
        status: 'in_progress',
      },
      now
    );
    const stages = planStages(coursework, cwDeadline, now - 20 * DAY_MS); // начата 20 дней назад
    for (let i = 0; i < stages.length; i += 1) {
      const st = await db.subtasks.create(cw.id, stages[i]!.title, now, stages[i]!.dueAt);
      if (i < 2) await db.subtasks.toggle(st.id, now);
    }
    await db.tasks.addActualMinutes(cw.id, 210, now);

    const lab = await db.tasks.create(
      { title: 'Отчёт по лабораторной №4', subjectId: subjectIds[1]!, deadlineAt: day(2, 23, 59), plannedMinutes: 120, difficulty: 2, priority: 3 },
      now
    );
    await db.subtasks.create(lab.id, 'Выполнить запросы из методички', now);
    await db.subtasks.create(lab.id, 'Скриншоты и выводы', now);
    await db.tasks.create(
      { title: 'Эссе: My future profession', subjectId: subjectIds[3]!, deadlineAt: day(5, 18), plannedMinutes: 90, difficulty: 1, priority: 2 },
      now
    );
    await db.tasks.create(
      { title: 'Анализ конкурентов для кейса', subjectId: subjectIds[0]!, deadlineAt: day(7, 12), plannedMinutes: 150, difficulty: 2, priority: 2 },
      now
    );
    const done = await db.tasks.create(
      { title: 'Тест по теме «Нормализация»', subjectId: subjectIds[1]!, deadlineAt: day(-2, 20), plannedMinutes: 45, difficulty: 1, priority: 1 },
      now
    );
    await db.tasks.setStatus(done.id, 'done', { now: day(-2, 19) });
    result.tasks = 5;

    // Долги
    await db.debts.create(
      {
        subjectId: subjectIds[1]!,
        title: 'Лабораторная №2',
        kind: 'lab',
        teacher: SUBJECTS[1]!.teacherPractice,
        retakeAt: day(3, 14),
        location: 'А-212',
        checklist: defaultChecklist('lab').map((it, i) => ({ ...it, done: i === 0 })),
      },
      now
    );
    await db.debts.create(
      { subjectId: subjectIds[4]!, title: 'Зачёт: нормативы', kind: 'credit', teacher: SUBJECTS[4]!.teacherPractice, checklist: [{ text: 'Спортивная форма', done: false }] },
      now
    );
    result.debts = 2;

    // Конспект к прошедшей лекции по маркетингу
    const pastLecture = lessonEvents.filter((e) => e.subjectId === subjectIds[0] && e.startAt < now).pop();
    if (pastLecture) {
      await db.lessonNotes.upsert(
        {
          subjectId: pastLecture.subjectId,
          lessonKey: lessonKeyFor({ subjectId: pastLecture.subjectId, title: pastLecture.title, startAt: pastLecture.startAt }),
          lessonTitle: pastLecture.title,
          lessonStartAt: pastLecture.startAt,
          text: 'Жизненный цикл ИТ-продукта: внедрение → рост → зрелость → спад.\nМетрики: CAC, LTV, retention. На экзамене — сравнить модели монетизации.',
          important: true,
          photos: [],
        },
        now
      );
    }

    // Фокус-сессии за прошлую неделю — чтобы статистика не была пустой
    const minutesByDay = [50, 75, 0, 100, 40, 125, 60];
    for (let d = 1; d <= minutesByDay.length; d += 1) {
      const total = minutesByDay[d - 1]!;
      let left = total;
      let start = day(-d, 16);
      let i = 0;
      while (left > 0) {
        const chunk = Math.min(25, left);
        await db.sessions.create({
          subjectId: subjectIds[(d + i) % subjectIds.length]!,
          taskId: i % 2 === 0 ? cw.id : null,
          startedAt: start,
          endedAt: start + chunk * MIN,
          activeSeconds: chunk * 60,
          breakSeconds: chunk === 25 ? 300 : 0,
          mode: 'pomodoro',
          completed: chunk === 25,
        });
        result.sessions += 1;
        left -= chunk;
        start += (chunk + 5) * MIN;
        i += 1;
      }
    }

    await db.goals.create({ metric: 'study_minutes', targetValue: 600, period: 'week', note: 'Демо-цель: 10 часов в неделю' }, now);
  });

  return result;
}
