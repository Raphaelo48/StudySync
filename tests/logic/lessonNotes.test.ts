import { openTestDb, fixedNow } from '../support/helpers';
import { canHaveNote, lessonKeyFor } from '../../src/logic/lessonNotes';
import { BackupParseError, exportAll, importBackup, parseBackup, serializeBackup } from '../../src/logic/backup';
import { importKgeuSchedule } from '../../src/logic/kgeuService';
import { DAY_MS, HOUR_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow();
const day = (d: number, h = 0, m = 0) => startOfDay(NOW) + d * DAY_MS + h * HOUR_MS + m * 60_000;

describe('Ключ пары для конспекта', () => {
  it('по предмету и времени; без предмета — по названию без подгруппы', () => {
    expect(lessonKeyFor({ subjectId: 's1', title: 'Физика', startAt: 100 })).toBe('s:s1@100');
    expect(lessonKeyFor({ subjectId: null, title: 'Физика (подгр. 2)', startAt: 100 })).toBe(lessonKeyFor({ subjectId: null, title: 'физика', startAt: 100 }));
  });
  it('конспект — у пар и событий с предметом', () => {
    expect(canHaveNote({ kind: 'lesson', subjectId: null })).toBe(true);
    expect(canHaveNote({ kind: 'personal', subjectId: null })).toBe(false);
    expect(canHaveNote({ kind: 'study', subjectId: 's' })).toBe(true);
  });
});

describe('Конспекты: хранение', () => {
  it('создание, обновление по ключу, пустой конспект удаляется', async () => {
    const { db } = await openTestDb();
    const base = { subjectId: null, lessonKey: 'k1', lessonTitle: 'Физика', lessonStartAt: day(1, 9), important: false, photos: [] };
    const a = await db.lessonNotes.upsert({ ...base, text: 'Закон Ома' }, NOW);
    const b = await db.lessonNotes.upsert({ ...base, text: 'Закон Ома, задачи 1–5', important: true, photos: ['x.jpg'] }, NOW + 1);
    expect(b!.id).toBe(a!.id);
    const stored = await db.lessonNotes.getByKey('k1');
    expect(stored).toMatchObject({ text: 'Закон Ома, задачи 1–5', important: true, photos: ['x.jpg'] });
    expect([...(await db.lessonNotes.keysBetween(day(1), day(2)))]).toEqual(['k1']);
    expect(await db.lessonNotes.allPhotoNames()).toEqual(new Set(['x.jpg']));
    await db.lessonNotes.upsert({ ...base, text: '  ', photos: [] }, NOW + 2);
    expect(await db.lessonNotes.getByKey('k1')).toBeNull();
  });

  it('конспект переживает повторный импорт расписания КГЭУ', async () => {
    const { db } = await openTestDb();
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (ts: number) => {
      const t = new Date(ts);
      return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
    };
    const row = (code: number) => ({
      код: code, дисциплина: 'лек Физика', датаНачала: iso(day(1, 9, 40)), датаОкончания: iso(day(1, 11, 10)),
      аудитория: 'Б-301', преподаватель: 'Петров П. П.', номерПодгруппы: 0,
    } as never);
    await importKgeuSchedule(db, { groupId: 5, groupName: 'Г', now: NOW, fetchSchedule: async () => [row(1)] });
    const [ev] = await db.events.listRange(day(1), day(2));
    await db.lessonNotes.upsert({ subjectId: ev!.subjectId, lessonKey: lessonKeyFor(ev!), lessonTitle: ev!.title, lessonStartAt: ev!.startAt, text: 'Конспект', important: false, photos: [] }, NOW);
    // КГЭУ поменял код занятия: событие пересоздано.
    await importKgeuSchedule(db, { groupId: 5, groupName: 'Г', now: NOW, fetchSchedule: async () => [row(2)] });
    const [ev2] = await db.events.listRange(day(1), day(2));
    expect(ev2!.id).not.toBe(ev!.id);
    expect((await db.lessonNotes.getByKey(lessonKeyFor(ev2!)))?.text).toBe('Конспект');
  });

  it('резервная копия: конспекты и фото (base64) проходят проверку, плохое имя файла — нет', async () => {
    const { db } = await openTestDb();
    await db.lessonNotes.upsert({ subjectId: null, lessonKey: 'k', lessonTitle: 'Физика', lessonStartAt: day(1, 9), text: 'т', important: true, photos: ['a1.jpg'] }, NOW);
    const backup = await exportAll(db, NOW);
    backup.data.lessonPhotos = [{ name: 'a1.jpg', base64: 'AAAA' }];
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed.data.lessonPhotos).toHaveLength(1);

    const target = (await openTestDb()).db;
    const report = await importBackup(target, parsed, 'merge', NOW);
    expect(report.inserted.lessonNotes).toBe(1);
    expect((await target.lessonNotes.getByKey('k'))?.photos).toEqual(['a1.jpg']);
    // повторное слияние не дублирует
    expect((await importBackup(target, parsed, 'merge', NOW)).inserted.lessonNotes).toBe(0);

    const evil = serializeBackup({ ...backup, data: { ...backup.data, lessonPhotos: [{ name: '../../x.db', base64: 'AA' }] } });
    expect(() => parseBackup(evil)).toThrow(BackupParseError);
  });
});
