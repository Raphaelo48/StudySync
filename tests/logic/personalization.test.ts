/**
 * Персонализация (акцент, шрифт, стартовая вкладка, блоки главной, компактное
 * расписание), поиск расписания КГЭУ (группа / преподаватель / аудитория / предмет)
 * и автообновление своей группы при запуске.
 */
import { openTestDb, fixedNow } from '../support/helpers';
import { DEFAULT_SETTINGS, type KgeuRecent } from '../../src/models/types';
import { MAX_RECENT, parsePrefs, pushRecent, toggleHomeBlock } from '../../src/logic/prefs';
import { ACCENTS, buildTheme, darkColors, fontSizes, hexToRgba, lightColors } from '../../src/theme/tokens';
import { exportAll, importBackup, parseBackup, serializeBackup } from '../../src/logic/backup';
import {
  filterBySubject,
  fromToday,
  groupByDay,
  lessonMeta,
  matchesQuery,
  normalizeQuery,
  searchLocalSubjects,
  searchNamed,
  toViewLessons,
  topDisciplines,
} from '../../src/logic/kgeuSearch';
import { fetchAuditoriums, fetchSchedule, fetchTeachers, KgeuError, type KgeuLessonRow } from '../../src/logic/kgeuClient';
import { AUTO_SYNC_INTERVAL_MS, autoSyncSkipReason, resolveOwnGroup, runAutoSync } from '../../src/logic/kgeuAutoSync';
import { importKgeuSchedule } from '../../src/logic/kgeuService';
import { shortKind } from '../../src/components/schedule/EventCard';
import { DAY_MS, HOUR_MS, startOfDay } from '../../src/core/time';

const NOW = fixedNow(); // 12.10.2026 10:00

function row(p: Partial<KgeuLessonRow> & { код: number; датаНачала: string; датаОкончания: string; дисциплина: string }): KgeuLessonRow {
  return {
    номерПодгруппы: 0,
    преподаватель: 'Низамова А.Ш.',
    аудитория: 'А413',
    учебныйГод: '2026-2027',
    группа: 'А-1-22',
    замена: false,
    номерЗанятия: 2,
    ...p,
  };
}

const ROWS: KgeuLessonRow[] = [
  row({ код: 1, датаНачала: '2026-10-11T09:40:00', датаОкончания: '2026-10-11T11:10:00', дисциплина: 'пр Атомные электрические станции' }),
  row({ код: 2, датаНачала: '2026-10-12T11:40:00', датаОкончания: '2026-10-12T13:10:00', дисциплина: 'лек Теоретические основы электротехники', группа: 'А-1-22, А-2-22' }),
  row({ код: 3, датаНачала: '2026-10-12T08:00:00', датаОкончания: '2026-10-12T09:30:00', дисциплина: 'лаб Физика', номерПодгруппы: 2, замена: true }),
  row({ код: 4, датаНачала: '2026-10-13T08:00:00', датаОкончания: '2026-10-13T09:30:00', дисциплина: 'пр Атомные электрические станции' }),
  // дубликат строки API
  row({ код: 4, датаНачала: '2026-10-13T08:00:00', датаОкончания: '2026-10-13T09:30:00', дисциплина: 'пр Атомные электрические станции' }),
  // битая строка — пропускается
  row({ код: 5, датаНачала: 'вчера', датаОкончания: '2026-10-13T09:30:00', дисциплина: 'пр Что-то' }),
];

/* ---------------------------------- Настройки ---------------------------------- */

describe('Персонализация: хранение настроек', () => {
  it('новая база отдаёт значения по умолчанию', async () => {
    const { db } = await openTestDb();
    const s = await db.settings.get();
    expect(s.accentColor).toBe('violet');
    expect(s.fontScale).toBe('normal');
    expect(s.startTab).toBe('index');
    expect(s.homeHiddenBlocks).toEqual([]);
    expect(s.compactSchedule).toBe(false);
    expect(s.autoSyncGroup).toBe(true);
    expect(s.kgeuGroupId).toBeNull();
    expect(s.kgeuRecent).toEqual([]);
  });

  it('изменения сохраняются и не затрагивают остальные настройки', async () => {
    const { db } = await openTestDb();
    await db.settings.update({ notifyLessonBeforeMin: 25 });
    await db.settings.update({
      accentColor: 'teal',
      fontScale: 'large',
      startTab: 'schedule',
      homeHiddenBlocks: ['stats', 'debts'],
      compactSchedule: true,
      kgeuGroupId: 14569,
      kgeuGroupName: 'А-1-22',
    });
    const s = await db.settings.get();
    expect(s).toMatchObject({
      accentColor: 'teal',
      fontScale: 'large',
      startTab: 'schedule',
      homeHiddenBlocks: ['stats', 'debts'],
      compactSchedule: true,
      kgeuGroupId: 14569,
      kgeuGroupName: 'А-1-22',
      notifyLessonBeforeMin: 25,
    });
  });

  it('повреждённый prefs_json не ломает запуск: неверные поля → значения по умолчанию', async () => {
    const { db, raw } = await openTestDb();
    raw.run(`UPDATE user_settings SET prefs_json = 'не json' WHERE id = 1`);
    expect((await db.settings.get()).accentColor).toBe('violet');
    raw.run(
      `UPDATE user_settings SET prefs_json = '{"accentColor":"pink","fontScale":"огромный","homeHiddenBlocks":["stats","stats","xxx"],"kgeuGroupId":"abc"}' WHERE id = 1`
    );
    const s = await db.settings.get();
    expect(s.accentColor).toBe('pink');
    expect(s.fontScale).toBe('normal');
    expect(s.homeHiddenBlocks).toEqual([]); // массив с неизвестным блоком отклонён целиком
    expect(s.kgeuGroupId).toBeNull();
  });

  it('parsePrefs убирает дубли блоков и обрезает недавние', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'teacher', id: i, name: `П${i}` }));
    const p = parsePrefs({ homeHiddenBlocks: ['stats', 'stats'], kgeuRecent: many });
    expect(p.homeHiddenBlocks).toEqual(['stats']);
    expect(p.kgeuRecent).toHaveLength(MAX_RECENT);
  });

  it('резервная копия переносит персонализацию, а мусор в файле игнорируется', async () => {
    const a = await openTestDb();
    await a.db.settings.update({ accentColor: 'orange', compactSchedule: true, kgeuRecent: [{ kind: 'aud', id: 7, name: 'Б-301' }] });
    const file = await exportAll(a.db, NOW);
    const b = await openTestDb();
    await importBackup(b.db, parseBackup(serializeBackup(file)), 'replace', NOW);
    const s = await b.db.settings.get();
    expect(s.accentColor).toBe('orange');
    expect(s.compactSchedule).toBe(true);
    expect(s.kgeuRecent).toEqual([{ kind: 'aud', id: 7, name: 'Б-301' }]);

    const broken = JSON.parse(serializeBackup(file));
    broken.data.settings.accentColor = 'радуга';
    const c = await openTestDb();
    await importBackup(c.db, parseBackup(JSON.stringify(broken)), 'replace', NOW);
    expect((await c.db.settings.get()).accentColor).toBe('violet');
  });

  it('toggleHomeBlock и pushRecent', () => {
    expect(toggleHomeBlock([], 'debts', false)).toEqual(['debts']);
    expect(toggleHomeBlock(['debts', 'stats'], 'debts', true)).toEqual(['stats']);
    // порядок всегда как на главной
    expect(toggleHomeBlock(['deadlines'], 'stats', false)).toEqual(['stats', 'deadlines']);

    let list: KgeuRecent[] = [];
    list = pushRecent(list, { kind: 'group', id: 1, name: 'А-1-22' });
    list = pushRecent(list, { kind: 'teacher', id: 1, name: 'Иванов' }); // тот же id, другой вид — не дубль
    list = pushRecent(list, { kind: 'group', id: 1, name: 'А-1-22' });
    expect(list.map((r) => `${r.kind}:${r.id}`)).toEqual(['group:1', 'teacher:1']);
  });
});

describe('Тема: акцент и размер шрифта', () => {
  it('по умолчанию палитра не меняется', () => {
    expect(buildTheme(true).colors).toBe(darkColors);
    expect(buildTheme(false).fontSizes).toBe(fontSizes);
  });

  it('акцент меняет только основной цвет и его производные', () => {
    const teal = ACCENTS.find((a) => a.id === 'teal')!;
    const dark = buildTheme(true, 'teal').colors;
    expect(dark.primary).toBe(teal.dark.primary);
    expect(dark.primarySoft).toBe(hexToRgba(teal.dark.primary, 0.15));
    expect(dark.success).toBe(darkColors.success);
    expect(buildTheme(false, 'teal').colors.primary).toBe(teal.light.primary);
    expect(buildTheme(false, 'teal').colors.bg).toBe(lightColors.bg);
  });

  it('у каждого акцента корректные цвета', () => {
    for (const a of ACCENTS) {
      for (const c of [a.light.primary, a.light.pressed, a.dark.primary, a.dark.pressed]) {
        expect(c).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('масштаб шрифта', () => {
    expect(buildTheme(true, 'violet', 'large').fontSizes.md).toBe(Math.round(fontSizes.md * 1.15));
    expect(buildTheme(true, 'violet', 'small').fontSizes.md).toBe(Math.round(fontSizes.md * 0.9));
  });

  it('короткие подписи вида занятия для компактных карточек', () => {
    expect(shortKind('Практическое занятие')).toBe('практика');
    expect(shortKind('Лабораторная работа')).toBe('лаб.');
    expect(shortKind(null)).toBeNull();
  });
});

/* ---------------------------------- Поиск ---------------------------------- */

describe('Поиск расписания КГЭУ', () => {
  const teachers = [
    { id: 472, name: 'Абакумова Юлия Андреевна' },
    { id: 392, name: 'Бускин Роман Владимирович' },
    { id: 10, name: 'Ёлкин Пётр Петрович' },
  ];

  it('matchesQuery: фамилия и инициалы, ё/е, группы и аудитории', () => {
    expect(matchesQuery('Абакумова Юлия Андреевна', 'абакумова ю а')).toBe(true);
    expect(matchesQuery('Абакумова Юлия Андреевна', 'Абакумова Ю.А.')).toBe(true);
    expect(matchesQuery('Ёлкин Пётр Петрович', 'елкин')).toBe(true);
    expect(matchesQuery('ПИ-1-23', 'пи-1')).toBe(true);
    expect(matchesQuery('Б-301', 'б301')).toBe(true);
    expect(matchesQuery('Бускин Роман Владимирович', 'абак')).toBe(false);
    expect(matchesQuery('Абакумова Юлия Андреевна', 'юлия абакумова')).toBe(true);
    expect(matchesQuery('А-1-22', 'а-2')).toBe(false);
    expect(matchesQuery('А-2-24', 'а-2')).toBe(true);
    expect(matchesQuery('А-1-22', 'а-2-2')).toBe(false);
    expect(matchesQuery('ЭИОС3', 'эиос')).toBe(true);
    expect(normalizeQuery('  Ёж   ЁЖ ')).toBe('еж еж');
  });

  it('searchNamed: начинающиеся с запроса — первыми, лимит', () => {
    const list = [{ name: 'А-1-22' }, { name: 'ПА-1-22' }, { name: 'А-2-22' }];
    expect(searchNamed(list, 'а-1').map((x) => x.name)).toEqual(['А-1-22']);
    expect(searchNamed([{ name: 'ПА-1-22' }, { name: 'А-1-22' }, { name: 'ЗА-1-22' }], '1-22').map((x) => x.name)).toEqual(['А-1-22', 'ЗА-1-22', 'ПА-1-22']);
    expect(searchNamed(teachers, 'бус').map((t) => t.id)).toEqual([392]);
    expect(searchNamed(teachers, 'а', 1)).toHaveLength(1);
  });

  it('toViewLessons: сортировка, дубли и битые строки отброшены', () => {
    const v = toViewLessons(ROWS);
    expect(v.map((l) => l.key.split(':')[0])).toEqual(['1', '3', '2', '4']);
    expect(v[1]).toMatchObject({ title: 'Физика', kindLabel: 'Лабораторная работа', subgroup: 2, isReplacement: true });
    expect(v[2]!.groups).toBe('А-1-22, А-2-22');
  });

  it('фильтры, дни и строка описания', () => {
    const v = toViewLessons(ROWS);
    expect(filterBySubject(v, 'атомн').length).toBe(2);
    expect(filterBySubject(v, '').length).toBe(4);
    expect(topDisciplines(v)[0]).toBe('Атомные электрические станции');
    const upcoming = fromToday(v, NOW, false);
    expect(upcoming.every((l) => l.endAt >= startOfDay(NOW))).toBe(true);
    expect(upcoming).toHaveLength(3);
    expect(fromToday(v, NOW, true)).toHaveLength(4);
    const days = groupByDay(upcoming);
    expect(days.map((d) => d.lessons.length)).toEqual([2, 1]);
    const lab = v[1]!;
    expect(lessonMeta(lab, 'group')).toBe('А413 · Низамова А.Ш. · подгр. 2');
    expect(lessonMeta(lab, 'teacher')).toBe('А-1-22 · А413 · подгр. 2');
    expect(lessonMeta(lab, 'aud')).toBe('А-1-22 · Низамова А.Ш. · подгр. 2');
  });

  it('поиск предмета по своему расписанию', () => {
    const ev = (title: string, d: number, subjectId: string | null = null, kind: 'lesson' | 'personal' = 'lesson') => ({
      title,
      kind,
      subjectId,
      startAt: startOfDay(NOW) + d * DAY_MS + 9 * HOUR_MS,
      endAt: startOfDay(NOW) + d * DAY_MS + 10.5 * HOUR_MS,
    });
    const hits = searchLocalSubjects(
      [
        ev('Физика (подгр. 1)', 1, 's1'),
        ev('Физика (подгр. 1)', -3, 's1'),
        ev('Физика', 4, 's1'),
        ev('Базы данных', 2, 's2'),
        ev('Физкультура дома', 1, null, 'personal'),
      ],
      'физ',
      NOW
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: 'Физика', subjectId: 's1', total: 3, upcoming: 2 });
    expect(searchLocalSubjects([ev('Базы данных', -1, 's2')], '', NOW)[0]!.nextAt).toBeNull();
  });
});

describe('Клиент API: преподаватели и аудитории', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  function mockFetch(body: unknown) {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  it('справочники преподавателей и аудиторий', async () => {
    let calls = mockFetch({ data: [{ id: 472, name: 'Абакумова Юлия Андреевна', kaf: null }, { id: 1, name: '  ' }], state: 1 });
    expect(await fetchTeachers()).toEqual([{ id: 472, name: 'Абакумова Юлия Андреевна', kaf: null }]);
    expect(calls[0]).toBe('https://kabinet.kgeu.ru/api/raspTeacherlist');
    calls = mockFetch({ data: [{ id: 6007247, name: 'А112' }], state: 1 });
    expect((await fetchAuditoriums())[0]!.name).toBe('А112');
    expect(calls[0]).toBe('https://kabinet.kgeu.ru/api/raspAudlist');
  });

  it('параметры запроса расписания как в веб-версии кабинета', async () => {
    const calls = mockFetch({ data: { rasp: [] }, state: 1 });
    await fetchSchedule('teacher', 472);
    await fetchSchedule('aud', 6007247);
    await fetchSchedule('group', 14569, '2026-2027');
    expect(calls).toEqual([
      'https://kabinet.kgeu.ru/api/Rasp?idTeacher=472',
      'https://kabinet.kgeu.ru/api/Rasp?idAudLine=6007247',
      'https://kabinet.kgeu.ru/api/Rasp?idGroup=14569&year=2026-2027',
    ]);
  });

  it('ошибка сервера превращается в понятное сообщение', async () => {
    mockFetch({ data: null, state: -1, msg: 'Ошибка. Не указаны параметры' });
    await expect(fetchSchedule('teacher', 0)).rejects.toThrow(KgeuError);
    mockFetch({ data: 'не массив', state: 1 });
    await expect(fetchTeachers()).rejects.toThrow('Неожиданный формат списка преподавателей');
  });
});

/* ---------------------------------- Автообновление ---------------------------------- */

describe('Автообновление своей группы', () => {
  const GROUP = 14569;
  const fetcher = (rows: KgeuLessonRow[]) => jest.fn(async () => rows);

  async function onboardedDb() {
    const t = await openTestDb();
    await t.db.settings.update({ onboardingDone: true });
    return t;
  }

  it('причины пропуска', () => {
    const base = { ...DEFAULT_SETTINGS, onboardingDone: true };
    expect(autoSyncSkipReason({ ...DEFAULT_SETTINGS }, NOW)).toBe('onboarding');
    expect(autoSyncSkipReason({ ...base, autoSyncGroup: false }, NOW)).toBe('disabled');
    expect(autoSyncSkipReason({ ...base, kgeuLastSyncAt: NOW - HOUR_MS }, NOW)).toBe('recent');
    expect(autoSyncSkipReason({ ...base, kgeuLastSyncAt: NOW - AUTO_SYNC_INTERVAL_MS }, NOW)).toBeNull();
  });

  it('без импортированной группы ничего не запрашивает', async () => {
    const { db } = await onboardedDb();
    const f = fetcher(ROWS);
    expect(await runAutoSync(db, { now: NOW, fetchSchedule: f })).toEqual({ status: 'skipped', reason: 'no-group' });
    expect(f).not.toHaveBeenCalled();
  });

  it('обновляет группу, запоминает время и не ходит в сеть повторно в течение 6 часов', async () => {
    const { db } = await onboardedDb();
    await importKgeuSchedule(db, { groupId: GROUP, groupName: 'А-1-22', now: NOW - DAY_MS, fetchSchedule: fetcher(ROWS.slice(0, 2)) });
    await db.settings.update({ kgeuGroupId: GROUP, kgeuGroupName: 'А-1-22', kgeuLastSyncAt: NOW - DAY_MS });

    const f = fetcher(ROWS.slice(0, 4));
    const res = await runAutoSync(db, { now: NOW, fetchSchedule: f });
    expect(res.status).toBe('synced');
    if (res.status === 'synced') {
      expect(res.groupName).toBe('А-1-22');
      expect(res.report.inserted).toBe(2);
      expect(res.changes).toBe(2);
    }
    expect(f).toHaveBeenCalledWith(GROUP);
    expect((await db.settings.get()).kgeuLastSyncAt).toBe(NOW);

    const again = fetcher(ROWS);
    expect(await runAutoSync(db, { now: NOW + HOUR_MS, fetchSchedule: again })).toEqual({ status: 'skipped', reason: 'recent' });
    expect(again).not.toHaveBeenCalled();
  });

  it('пустой ответ сервера не стирает расписание', async () => {
    const { db } = await onboardedDb();
    await importKgeuSchedule(db, { groupId: GROUP, groupName: 'А-1-22', now: NOW - DAY_MS, fetchSchedule: fetcher(ROWS) });
    await db.settings.update({ kgeuGroupId: GROUP, kgeuGroupName: 'А-1-22' });
    const before = (await db.events.listBySourceRefPrefix('kgeu', `${GROUP}:`)).length;
    expect(await runAutoSync(db, { now: NOW, fetchSchedule: fetcher([]) })).toEqual({ status: 'skipped', reason: 'empty-response' });
    expect((await db.events.listBySourceRefPrefix('kgeu', `${GROUP}:`)).length).toBe(before);
    expect((await db.settings.get()).kgeuLastSyncAt).toBeNull();
  });

  it('группа из импорта старой версии определяется по событиям; при нескольких группах — нет', async () => {
    const { db } = await onboardedDb();
    await importKgeuSchedule(db, { groupId: GROUP, groupName: 'А-1-22', now: NOW, fetchSchedule: fetcher(ROWS) });
    const s = await db.settings.get();
    expect(await resolveOwnGroup(db, s)).toEqual({ id: GROUP, name: 'моя группа' });
    await importKgeuSchedule(db, { groupId: 999, groupName: 'Б-1-22', now: NOW, fetchSchedule: fetcher(ROWS.slice(0, 1)) });
    expect(await resolveOwnGroup(db, s)).toBeNull();
  });

  it('выключенное автообновление не запрашивает сеть', async () => {
    const { db } = await onboardedDb();
    await db.settings.update({ kgeuGroupId: GROUP, autoSyncGroup: false });
    const f = fetcher(ROWS);
    expect(await runAutoSync(db, { now: NOW, fetchSchedule: f })).toEqual({ status: 'skipped', reason: 'disabled' });
    expect(f).not.toHaveBeenCalled();
  });
});
