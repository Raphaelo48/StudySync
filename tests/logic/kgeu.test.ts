/**
 * Импорт расписания КГЭУ: разбор строк API, синхронизационный дифф,
 * идемпотентность повторного импорта, неприкосновенность ручных событий,
 * перенос полей происхождения в резервные копии (формат v2).
 */
import { openTestDb, fixedNow, dayStart } from '../support/helpers';
import { parseIsoLocal, splitDiscipline, parseLessonRow, computeSyncDiff } from '../../src/logic/kgeuImport';
import { importKgeuSchedule, removeKgeuImport } from '../../src/logic/kgeuService';
import { BACKUP_FORMAT_VERSION, exportAll, importBackup, parseBackup, serializeBackup } from '../../src/logic/backup';
import type { KgeuLessonRow } from '../../src/logic/kgeuClient';

const NOW = fixedNow();
const GROUP_ID = 14569;

/** Реальная форма строки ответа /api/Rasp?idGroup=… (ключи кириллицей). */
function row(partial: Partial<KgeuLessonRow> & { код: number; датаНачала: string; датаОкончания: string; дисциплина: string }): KgeuLessonRow {
  return {
    деньНедели: 3,
    типНедели: 1,
    номерПодгруппы: 0,
    преподаватель: 'Низамова А.Ш.',
    аудитория: 'А413',
    учебныйГод: '2026-2027',
    группа: 'А-1-22',
    замена: false,
    номерЗанятия: 2,
    ...partial,
  };
}

const FIXTURE: KgeuLessonRow[] = [
  row({ код: 101, датаНачала: '2026-10-12T09:40:00', датаОкончания: '2026-10-12T11:10:00', дисциплина: 'пр Атомные электрические станции' }),
  row({ код: 102, датаНачала: '2026-10-12T11:40:00', датаОкончания: '2026-10-12T13:10:00', дисциплина: 'л Теоретические основы электротехники', аудитория: 'Б204' }),
  row({ код: 103, датаНачала: '2026-10-13T08:00:00', датаОкончания: '2026-10-13T09:30:00', дисциплина: 'лр Физика', номерПодгруппы: 1, замена: true, преподаватель: 'Иванов П.П.' }),
];

describe('Разбор строк КГЭУ', () => {
  it('parseIsoLocal трактует строку как настенное время локальной зоны', () => {
    const ts = parseIsoLocal('2026-10-12T09:40:00');
    expect(ts).not.toBeNull();
    const d = new Date(ts!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 12, 9, 40]);
    expect(parseIsoLocal('не дата')).toBeNull();
    expect(parseIsoLocal('2026-10-12T09:40')).not.toBeNull();
  });

  it('splitDiscipline выделяет вид занятия по префиксу', () => {
    expect(splitDiscipline('пр Атомные электрические станции')).toEqual({
      kindLabel: 'Практическое занятие',
      title: 'Атомные электрические станции',
    });
    expect(splitDiscipline('л ТОЭ').kindLabel).toBe('Лекция');
    expect(splitDiscipline('лр Физика').kindLabel).toBe('Лабораторная работа');
    expect(splitDiscipline('Семинар по истории')).toEqual({ kindLabel: null, title: 'Семинар по истории' });
  });

  it('parseLessonRow собирает событие: подгруппа, замена, аудитория, преподаватель', () => {
    const lesson = parseLessonRow(FIXTURE[2]!, GROUP_ID);
    expect(lesson).not.toBeNull();
    expect(lesson!.ref).toBe(`${GROUP_ID}:103`);
    expect(lesson!.title).toBe('Физика (подгр. 1)');
    expect(lesson!.isReplacement).toBe(true);
    expect(lesson!.notes).toContain('замена');
    expect(lesson!.notes).toContain('Иванов П.П.');
    expect(lesson!.location).toBe('А413');

    const broken = parseLessonRow(
      row({ код: 999, датаНачала: '2026-10-12T11:00:00', датаОкончания: '2026-10-12T09:00:00', дисциплина: 'л X' }),
      GROUP_ID
    );
    expect(broken).toBeNull(); // конец раньше начала — отбрасываем
  });
});

describe('Синхронизационный дифф', () => {
  it('новые строки — insert, отсутствующие — remove, изменённые — update', async () => {
    const { db } = await openTestDb();
    await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: async () => FIXTURE });

    const existing = await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`);
    expect(existing.length).toBe(3);

    // Изменённый источник: 102 перенесён, 103 удалён, 104 добавлен
    const changed: KgeuLessonRow[] = [
      FIXTURE[0]!,
      { ...FIXTURE[1]!, датаНачала: '2026-10-12T13:20:00', датаОкончания: '2026-10-12T14:50:00' },
      row({ код: 104, датаНачала: '2026-10-14T09:40:00', датаОкончания: '2026-10-14T11:10:00', дисциплина: 'л Математика' }),
    ];
    const lessons = changed.map((r) => parseLessonRow(r, GROUP_ID)!);
    const diff = computeSyncDiff(existing, lessons);
    expect(diff.insert.map((l) => l.ref)).toEqual([`${GROUP_ID}:104`]);
    expect(diff.update.map((u) => u.event.sourceRef)).toEqual([`${GROUP_ID}:102`]);
    expect(diff.remove.map((r) => r.sourceRef)).toEqual([`${GROUP_ID}:103`]);
    expect(diff.unchanged).toBe(1);
  });
});

describe('Сервис импорта', () => {
  it('импорт создаёт события-источник kgeu и не трогает ручные', async () => {
    const { db } = await openTestDb();
    const manual = await db.events.create(
      { title: 'Моя консультация', startAt: dayStart(0, 12, 0), endAt: dayStart(0, 13, 0) },
      NOW
    );

    const report = await importKgeuSchedule(db, {
      groupId: GROUP_ID,
      groupName: 'А-1-22',
      now: NOW,
      fetchSchedule: async () => FIXTURE,
    });
    expect(report.inserted).toBe(3);
    expect(report.lessonsTotal).toBe(3);
    expect(report.replacements).toBe(1);
    expect(report.minDate).not.toBeNull();

    const imported = await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`);
    expect(imported.length).toBe(3);
    expect(imported.every((e) => e.kind === 'lesson')).toBe(true);
    const one = imported.find((e) => e.sourceRef === `${GROUP_ID}:101`)!;
    expect(one.title).toBe('Атомные электрические станции');
    expect(one.notes).toContain('Практическое занятие');

    // Ручное событие не тронуто
    const manualAfter = await db.events.get(manual.id);
    expect(manualAfter?.title).toBe('Моя консультация');
  });

  it('повторный импорт идемпотентен: без изменений при том же источнике', async () => {
    const { db } = await openTestDb();
    const fetch = async () => FIXTURE;
    const first = await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: fetch });
    const second = await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW + 1000, fetchSchedule: fetch });
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.removed).toBe(0);
    expect(second.unchanged).toBe(first.lessonsTotal);
    expect((await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`)).length).toBe(3);
  });

  it('синхронизация применяет изменения и удаляет отменённые занятия', async () => {
    const { db } = await openTestDb();
    await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: async () => FIXTURE });

    const updatedFixture = [
      FIXTURE[0]!,
      { ...FIXTURE[1]!, аудитория: 'Б999' }, // изменилась аудитория
      // FIXTURE[2] удалён из источника (занятие отменили)
    ];
    const report = await importKgeuSchedule(db, {
      groupId: GROUP_ID,
      groupName: 'А-1-22',
      now: NOW + 5000,
      fetchSchedule: async () => updatedFixture,
    });
    expect(report.updated).toBe(1);
    expect(report.removed).toBe(1);
    expect(report.unchanged).toBe(1);

    const existing = await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`);
    expect(existing.length).toBe(2);
    const upd = existing.find((e) => e.sourceRef === `${GROUP_ID}:102`)!;
    expect(upd.location).toBe('Б999');
  });

  it('удаление импорта группы не затрагивает ручные события', async () => {
    const { db } = await openTestDb();
    const manual = await db.events.create(
      { title: 'Спорт', kind: 'personal', startAt: dayStart(1, 18, 0), endAt: dayStart(1, 19, 0) },
      NOW
    );
    await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: async () => FIXTURE });
    const removed = await removeKgeuImport(db, GROUP_ID);
    expect(removed).toBe(3);
    expect((await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`)).length).toBe(0);
    expect(await db.events.get(manual.id)).not.toBeNull();
  });

  it('ошибка сети не оставляет частичных изменений', async () => {
    const { db } = await openTestDb();
    await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: async () => FIXTURE });
    await expect(
      importKgeuSchedule(db, {
        groupId: GROUP_ID,
        groupName: 'А-1-22',
        now: NOW,
        fetchSchedule: async () => {
          throw new Error('сеть отключена');
        },
      })
    ).rejects.toThrow();
    expect((await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`)).length).toBe(3);
  });
});

describe('Импорт предметов дисциплин', () => {
  it('создаёт предметы по уникальным дисциплинам и связывает события', async () => {
    const { db } = await openTestDb();
    const report = await importKgeuSchedule(db, {
      groupId: GROUP_ID,
      groupName: 'А-1-22',
      now: NOW,
      fetchSchedule: async () => FIXTURE,
    });
    // Дисциплины фикстуры: Атомные электрические станции, ТОЭ, Физика
    expect(report.subjectsCreated).toBe(3);

    const subjects = await db.subjects.list();
    const names = subjects.map((s) => s.name).sort();
    expect(names).toEqual(['Атомные электрические станции', 'Теоретические основы электротехники', 'Физика']);

    const imported = await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`);
    expect(imported.every((e) => e.subjectId != null)).toBe(true);
    const phys = imported.find((e) => e.sourceRef === `${GROUP_ID}:103`)!;
    const physSubject = await db.subjects.get(phys.subjectId!);
    expect(physSubject?.name).toBe('Физика');
  });

  it('не создаёт дубликаты: повторный импорт и существующий предмет с тем же именем', async () => {
    const { db } = await openTestDb();
    // Пользователь заранее создал предмет «Физика»
    const manualPhys = await db.subjects.create({ name: 'Физика', color: '#123456' }, NOW);

    const first = await importKgeuSchedule(db, {
      groupId: GROUP_ID,
      groupName: 'А-1-22',
      now: NOW,
      fetchSchedule: async () => FIXTURE,
    });
    expect(first.subjectsCreated).toBe(2); // Физика переиспользована

    const second = await importKgeuSchedule(db, {
      groupId: GROUP_ID,
      groupName: 'А-1-22',
      now: NOW + 1000,
      fetchSchedule: async () => FIXTURE,
    });
    expect(second.subjectsCreated).toBe(0);

    const subjects = await db.subjects.list();
    expect(subjects.filter((s) => s.name.toLowerCase() === 'физика').length).toBe(1);

    // События «Физики» привязаны к пользовательскому предмету, цвет сохранён
    const physEvent = (await db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`))
      .find((e) => e.sourceRef === `${GROUP_ID}:103`)!;
    expect(physEvent.subjectId).toBe(manualPhys.id);
  });

  it('удаление импорта не удаляет созданные предметы', async () => {
    const { db } = await openTestDb();
    await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: async () => FIXTURE });
    await removeKgeuImport(db, GROUP_ID);
    expect((await db.subjects.list()).length).toBe(3);
  });
});

describe('Резервные копии сохраняют происхождение событий', () => {
  it('экспорт → импорт: source и sourceRef переживают roundtrip', async () => {
    const { db } = await openTestDb();
    await importKgeuSchedule(db, { groupId: GROUP_ID, groupName: 'А-1-22', now: NOW, fetchSchedule: async () => FIXTURE });

    const backup = await exportAll(db, NOW);
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    const kgeuEvent = backup.data.events.find((e) => e.source === 'kgeu');
    expect(kgeuEvent?.sourceRef).toBe(`${GROUP_ID}:101`);

    const target = await openTestDb();
    await importBackup(target.db, parseBackup(serializeBackup(backup)), 'replace', NOW);
    const imported = await target.db.events.listBySourceRefPrefix('kgeu', `${GROUP_ID}:`);
    expect(imported.length).toBe(3);
  });

  it('файлы формата v1 (без source) импортируются как manual', () => {
    const v1 = {
      format: 'studysync-backup',
      formatVersion: 1,
      exportedAt: NOW,
      data: {
        subjects: [],
        tasks: [],
        subtasks: [],
        events: [
          { id: 'e1', title: 'Старое событие', startAt: NOW + 1000, endAt: NOW + 2000, createdAt: NOW, updatedAt: NOW },
        ],
        studySessions: [],
        goals: [],
      },
    };
    const parsed = parseBackup(JSON.stringify(v1));
    expect(parsed.data.events[0]!.source ?? 'manual').toBe('manual');
  });
});
