import { describeEvent } from '../../src/logic/eventDisplay';
import { splitDiscipline, parseLessonRow } from '../../src/logic/kgeuImport';
import type { EventWithRelations } from '../../src/models/types';

const base: EventWithRelations = {
  id: 'e1', title: 'Маркетинг ИТ-продуктов', kind: 'lesson', subjectId: 's1', taskId: null,
  location: 'Б-301', startAt: 0, endAt: 1, notes: 'Лекция · Иванов Иван Иванович · пара №2',
  seriesId: null, recurrence: null, notifyOffsetMinutes: null, source: 'kgeu', sourceRef: '1:1',
  createdAt: 0, updatedAt: 0,
  subject: { id: 's1', name: 'Маркетинг ИТ-продуктов', color: '#7C6CF0' }, task: null,
};

describe('Карточка занятия', () => {
  it('«лек» распознаётся как лекция и отрезается от названия', () => {
    expect(splitDiscipline('лек Маркетинг ИТ-продуктов')).toEqual({ kindLabel: 'Лекция', title: 'Маркетинг ИТ-продуктов' });
    expect(splitDiscipline('лаб Базы данных').kindLabel).toBe('Лабораторная работа');
  });

  it('под названием — аудитория и преподаватель, предмет не дублируется', () => {
    const d = describeEvent(base);
    expect(d).toEqual({
      kindLabel: 'Лекция', teacher: 'Иванов Иван Иванович', location: 'Б-301', isReplacement: false, subjectName: null,
    });
  });

  it('замена и отсутствие преподавателя', () => {
    const d = describeEvent({ ...base, notes: 'Практическое занятие · замена' });
    expect(d.teacher).toBeNull();
    expect(d.isReplacement).toBe(true);
    expect(d.kindLabel).toBe('Практическое занятие');
  });

  it('заметки ручного события не разбираются', () => {
    const d = describeEvent({ ...base, source: 'manual', sourceRef: null, notes: 'Взять конспект', subject: { id: 's2', name: 'Физика', color: '#000000' } });
    expect(d.teacher).toBeNull();
    expect(d.subjectName).toBe('Физика');
  });

  it('импорт КГЭУ кладёт преподавателя так, что его можно показать', () => {
    const p = parseLessonRow(
      { код: 7, дисциплина: 'лек Маркетинг ИТ-продуктов', датаНачала: '2026-11-04T09:40:00', датаОкончания: '2026-11-04T11:10:00',
        аудитория: 'Б-301', преподаватель: 'Петров П. П.', номерПодгруппы: 0 } as never,
      5
    )!;
    expect(p.title).toBe('Маркетинг ИТ-продуктов');
    const d = describeEvent({ ...base, title: p.title, notes: p.notes, location: p.location });
    expect(d.teacher).toBe('Петров П. П.');
    expect(d.kindLabel).toBe('Лекция');
  });
});

import { openTestDb, fixedNow } from '../support/helpers';
import { importKgeuSchedule } from '../../src/logic/kgeuService';

describe('Повторный импорт КГЭУ после исправления «лек»', () => {
  it('старый предмет «лек …» переименовывается, названия занятий очищаются', async () => {
    const { db } = await openTestDb();
    const NOW = fixedNow();
    const old = await db.subjects.create({ name: 'лек Маркетинг ИТ-продуктов', color: '#7C6CF0' }, NOW);
    await db.events.create(
      { title: 'лек Маркетинг ИТ-продуктов', kind: 'lesson', subjectId: old.id, startAt: NOW + 3_600_000, endAt: NOW + 9_000_000,
        source: 'kgeu', sourceRef: '5:7', notes: 'Петров П. П.' },
      NOW
    );
    const d = new Date(NOW + 3_600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (t: Date) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
    await importKgeuSchedule(db, {
      groupId: 5, groupName: 'ПИ-1-23', now: NOW,
      fetchSchedule: async () => [
        { код: 7, дисциплина: 'лек Маркетинг ИТ-продуктов', датаНачала: iso(d), датаОкончания: iso(new Date(NOW + 9_000_000)),
          аудитория: 'Б-301', преподаватель: 'Петров П. П.', номерПодгруппы: 0 } as never,
      ],
    });
    const subjects = await db.subjects.list(true);
    expect(subjects.map((s) => s.name)).toEqual(['Маркетинг ИТ-продуктов']);
    const [ev] = await db.events.listBySourceRefPrefix('kgeu', '5:');
    expect(ev!.title).toBe('Маркетинг ИТ-продуктов');
    expect(ev!.subjectId).toBe(old.id);
  });
});

import { extractTeacher } from '../../src/logic/kgeuImport';
import { kgeuLessonRowSchema } from '../../src/logic/kgeuClient';

describe('Преподаватель из ответа API', () => {
  const baseRow = { код: 1, датаНачала: '2026-11-04T09:40:00', датаОкончания: '2026-11-04T11:10:00', дисциплина: 'лек X' };
  it('основное поле', () => {
    expect(extractTeacher(kgeuLessonRowSchema.parse({ ...baseRow, преподаватель: 'Петров П. П.' }))).toBe('Петров П. П.');
  });
  it('другое имя поля, массив и объект', () => {
    expect(extractTeacher(kgeuLessonRowSchema.parse({ ...baseRow, фиоПреподавателя: 'Сидоров С. С.' }))).toBe('Сидоров С. С.');
    expect(extractTeacher(kgeuLessonRowSchema.parse({ ...baseRow, преподаватели: ['А. А.', 'Б. Б.'] }))).toBe('А. А., Б. Б.');
    expect(extractTeacher(kgeuLessonRowSchema.parse({ ...baseRow, преподаватель: null, teacher: { fio: 'В. В.' } }))).toBe('В. В.');
  });
  it('пусто — null', () => {
    expect(extractTeacher(kgeuLessonRowSchema.parse({ ...baseRow, преподаватель: '  ' }))).toBeNull();
  });
});

describe('ФИО показывается, даже если источник события не прочитан', () => {
  it('заметка импорта распознаётся без source', () => {
    const d = describeEvent({ ...base, source: 'manual', sourceRef: null, notes: 'Лекция · Петров П. П. · пара №2' });
    expect(d.teacher).toBe('Петров П. П.');
    expect(d.kindLabel).toBe('Лекция');
  });
  it('по ссылке группа:код', () => {
    const d = describeEvent({ ...base, source: 'manual', notes: 'Петров П. П.' });
    expect(d.teacher).toBe('Петров П. П.');
  });
  it('обычная заметка ручного занятия не превращается в ФИО', () => {
    const d = describeEvent({ ...base, source: 'manual', sourceRef: null, notes: 'Взять конспект' });
    expect(d.teacher).toBeNull();
  });
});
