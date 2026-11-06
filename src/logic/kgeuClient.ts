/**
 * Публичный клиент расписания КГЭУ (kabinet.kgeu.ru).
 *
 * Используются те же публичные адреса, с которых веб-версия личного кабинета
 * показывает расписание; расписание групп отдаётся БЕЗ авторизации:
 *   GET /api/raspGrouplist          — список групп [{ id, name, kurs, facul, yearName }]
 *   GET /api/Rasp/ListYears         — учебные годы
 *   GET /api/Rasp?idGroup={id}      — занятия группы за текущий год
 *
 * Это неофициальное использование публичного API: формат может измениться
 * без предупреждения, поэтому весь разбор изолирован здесь и покрыт тестами,
 * а любые сетевые ошибки превращаются в понятные сообщения пользователю.
 * Запросы выполняются только по явному действию пользователя (поиск/импорт),
 * периодического фонового опроса нет.
 */
import { z } from 'zod';

export const KGEU_API_BASE = 'https://kabinet.kgeu.ru';
export const REQUEST_TIMEOUT_MS = 20_000;

export class KgeuError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'KgeuError';
  }
}

/* ---------------------------------- Zod-схемы ответа ---------------------------------- */

export const kgeuGroupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  kurs: z.number().int().optional().nullable(),
  facul: z.string().optional().nullable(),
  yearName: z.string().optional().nullable(),
  facultyID: z.number().int().optional().nullable(),
});
export type KgeuGroup = z.infer<typeof kgeuGroupSchema>;

export const kgeuLessonRowSchema = z
  .object({
  код: z.number().int(),
  датаНачала: z.string(),
  датаОкончания: z.string(),
  деньНедели: z.number().int().optional().nullable(),
  типНедели: z.number().int().optional().nullable(),
  номерПодгруппы: z.number().int().optional().nullable(),
  дисциплина: z.string(),
  преподаватель: z.string().optional().nullable(),
  аудитория: z.string().optional().nullable(),
  учебныйГод: z.string().optional().nullable(),
  группа: z.string().optional().nullable(),
  замена: z.boolean().optional().nullable(),
  номерЗанятия: z.number().int().optional().nullable(),
  })
  // Неизвестные поля не отбрасываем: имя поля с преподавателем в API может отличаться
  // (см. extractTeacher в kgeuImport).
  .passthrough();
export type KgeuLessonRow = z.infer<typeof kgeuLessonRowSchema>;

const groupListResponseSchema = z.object({
  data: z.array(kgeuGroupSchema).default([]),
  state: z.number(),
  msg: z.string().optional().nullable(),
});

const yearsResponseSchema = z.object({
  data: z
    .object({ years: z.array(z.string()).default([]) })
    .nullable()
    .optional(),
  state: z.number(),
});

const raspResponseSchema = z.object({
  data: z
    .object({
      isCyclicalSchedule: z.boolean().optional().nullable(),
      rasp: z.array(kgeuLessonRowSchema).default([]),
    })
    .nullable()
    .optional(),
  state: z.number(),
  msg: z.string().optional().nullable(),
});

/* ---------------------------------- Запросы ---------------------------------- */

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new KgeuError(`Сервер расписания ответил ошибкой ${res.status}. Попробуйте позже.`);
    }
    return await res.json();
  } catch (error) {
    if (error instanceof KgeuError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new KgeuError('Превышено время ожидания ответа сервера расписания', error);
    }
    throw new KgeuError(
      'Нет соединения с сервером расписания КГЭУ. Проверьте интернет и попробуйте снова.',
      error
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGroups(): Promise<KgeuGroup[]> {
  const json = await getJson(`${KGEU_API_BASE}/api/raspGrouplist`);
  const parsed = groupListResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KgeuError('Неожиданный формат списка групп КГЭУ — возможно, API изменился');
  }
  if (parsed.data.state !== 1) {
    throw new KgeuError(`Сервер КГЭУ вернул ошибку: ${parsed.data.msg ?? 'неизвестно'}`);
  }
  return parsed.data.data;
}

export async function fetchYears(): Promise<string[]> {
  const json = await getJson(`${KGEU_API_BASE}/api/Rasp/ListYears`);
  const parsed = yearsResponseSchema.safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.data?.years ?? [];
}

export async function fetchGroupSchedule(groupId: number, year?: string): Promise<KgeuLessonRow[]> {
  const url = `${KGEU_API_BASE}/api/Rasp?idGroup=${groupId}${year ? `&year=${encodeURIComponent(year)}` : ''}`;
  const json = await getJson(url);
  const parsed = raspResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KgeuError('Неожиданный формат расписания КГЭУ — возможно, API изменился');
  }
  if (parsed.data.state !== 1) {
    throw new KgeuError(`Сервер КГЭУ вернул ошибку: ${parsed.data.msg ?? 'неизвестно'}`);
  }
  return parsed.data.data?.rasp ?? [];
}
