import { newId } from '../../core/id';
import type { ID, LessonNote } from '../../models/types';
import type { SqlDriver } from '../driver';

interface LessonNoteRow {
  id: string;
  subject_id: string | null;
  lesson_key: string;
  lesson_title: string;
  lesson_start_at: number;
  text: string;
  important: number;
  photos_json: string;
  created_at: number;
  updated_at: number;
}

function parsePhotos(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function mapNote(row: LessonNoteRow): LessonNote {
  return {
    id: row.id,
    subjectId: row.subject_id,
    lessonKey: row.lesson_key,
    lessonTitle: row.lesson_title,
    lessonStartAt: row.lesson_start_at,
    text: row.text,
    important: row.important === 1,
    photos: parsePhotos(row.photos_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LessonNoteUpsert {
  subjectId: ID | null;
  lessonKey: string;
  lessonTitle: string;
  lessonStartAt: number;
  text: string;
  important: boolean;
  photos: string[];
}

export class LessonNotesRepo {
  constructor(private readonly driver: SqlDriver) {}

  async getByKey(lessonKey: string): Promise<LessonNote | null> {
    const row = await this.driver.getFirst<LessonNoteRow>('SELECT * FROM lesson_notes WHERE lesson_key = ?', [lessonKey]);
    return row ? mapNote(row) : null;
  }

  /** Ключи пар, у которых есть конспект (для значка на карточке). */
  async keysBetween(from: number, to: number): Promise<Set<string>> {
    const rows = await this.driver.getAll<{ lesson_key: string }>(
      'SELECT lesson_key FROM lesson_notes WHERE lesson_start_at >= ? AND lesson_start_at < ?',
      [from, to]
    );
    return new Set(rows.map((r) => r.lesson_key));
  }

  async listBySubject(subjectId: ID | null, onlyImportant = false): Promise<LessonNote[]> {
    const rows = await this.driver.getAll<LessonNoteRow>(
      `SELECT * FROM lesson_notes WHERE ${subjectId ? 'subject_id = ?' : 'subject_id IS NULL'}
       ${onlyImportant ? 'AND important = 1' : ''} ORDER BY lesson_start_at DESC`,
      subjectId ? [subjectId] : []
    );
    return rows.map(mapNote);
  }

  async listAll(): Promise<LessonNote[]> {
    const rows = await this.driver.getAll<LessonNoteRow>('SELECT * FROM lesson_notes ORDER BY lesson_start_at DESC');
    return rows.map(mapNote);
  }

  /** Сохранить конспект пары (создать или обновить по ключу). Пустой конспект удаляется. */
  async upsert(input: LessonNoteUpsert, now: number = Date.now()): Promise<LessonNote | null> {
    const existing = await this.getByKey(input.lessonKey);
    const empty = input.text.trim().length === 0 && input.photos.length === 0;
    if (empty) {
      if (existing) await this.delete(existing.id);
      return null;
    }
    if (existing) {
      await this.driver.run(
        `UPDATE lesson_notes SET subject_id = ?, lesson_title = ?, lesson_start_at = ?, text = ?, important = ?,
          photos_json = ?, updated_at = ? WHERE id = ?`,
        [
          input.subjectId, input.lessonTitle, input.lessonStartAt, input.text, input.important ? 1 : 0,
          JSON.stringify(input.photos), now, existing.id,
        ]
      );
      return { ...existing, ...input, updatedAt: now };
    }
    const note: LessonNote = { id: newId(), ...input, createdAt: now, updatedAt: now };
    await this.driver.run(
      `INSERT INTO lesson_notes (id, subject_id, lesson_key, lesson_title, lesson_start_at, text, important,
        photos_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id, note.subjectId, note.lessonKey, note.lessonTitle, note.lessonStartAt, note.text,
        note.important ? 1 : 0, JSON.stringify(note.photos), note.createdAt, note.updatedAt,
      ]
    );
    return note;
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM lesson_notes WHERE id = ?', [id]);
    return res.changes > 0;
  }

  /** Все имена файлов фото, на которые ссылаются конспекты (для уборки «сирот»). */
  async allPhotoNames(): Promise<Set<string>> {
    const rows = await this.driver.getAll<{ photos_json: string }>('SELECT photos_json FROM lesson_notes');
    const out = new Set<string>();
    for (const r of rows) for (const p of parsePhotos(r.photos_json)) out.add(p);
    return out;
  }
}
