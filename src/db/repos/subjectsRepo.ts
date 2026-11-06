import { newId } from '../../core/id';
import type { ID, Subject } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapSubject, toInt, type SubjectRow } from '../mappers';

export interface SubjectInput {
  source?: import('../../models/types').SubjectSource;
  sourceRef?: string | null;
  name: string;
  description?: string | null;
  color?: string;
  targetGrade?: string | null;
  note?: string | null;
}

export interface SubjectRelations {
  tasks: number;
  events: number;
  sessions: number;
  goals: number;
}

const SELECT_COLUMNS = `id, source, source_ref, name, description, color, target_grade, note, archived, created_at, updated_at`;

export class SubjectsRepo {
  constructor(private readonly driver: SqlDriver) {}

  async list(includeArchived = false): Promise<Subject[]> {
    const sql = includeArchived
      ? `SELECT ${SELECT_COLUMNS} FROM subjects ORDER BY name COLLATE NOCASE`
      : `SELECT ${SELECT_COLUMNS} FROM subjects WHERE archived = 0 ORDER BY name COLLATE NOCASE`;
    const rows = await this.driver.getAll<SubjectRow>(sql);
    return rows.map(mapSubject);
  }

  async get(id: ID): Promise<Subject | null> {
    const row = await this.driver.getFirst<SubjectRow>(
      `SELECT ${SELECT_COLUMNS} FROM subjects WHERE id = ?`,
      [id]
    );
    return row ? mapSubject(row) : null;
  }

  async create(input: SubjectInput, now: number = Date.now()): Promise<Subject> {
    const subject: Subject = {
      id: newId(),
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      color: input.color ?? '#7C6CF0',
      targetGrade: input.targetGrade?.trim() || null,
      note: input.note?.trim() || null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.run(
      `INSERT INTO subjects (id, source, source_ref, name, description, color, target_grade, note, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        subject.id,
        subject.source,
        subject.sourceRef,
        subject.name,
        subject.description,
        subject.color,
        subject.targetGrade,
        subject.note,
        toInt(subject.archived),
        subject.createdAt,
        subject.updatedAt,
      ]
    );
    return subject;
  }

  async update(
    id: ID,
    patch: Partial<Omit<SubjectInput, 'name'> & { name: string; archived: boolean }>,
    now: number = Date.now()
  ): Promise<Subject | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next: Subject = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.targetGrade !== undefined ? { targetGrade: patch.targetGrade?.trim() || null } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      updatedAt: now,
    };
    await this.driver.run(
      `UPDATE subjects SET name = ?, description = ?, color = ?, target_grade = ?, note = ?, archived = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.name,
        next.description,
        next.color,
        next.targetGrade,
        next.note,
        toInt(next.archived),
        next.updatedAt,
        id,
      ]
    );
    void 0;
    return next;
  }

  /** Сколько сущностей ссылается на предмет — для предупреждения перед удалением. */
  async countRelations(id: ID): Promise<SubjectRelations> {
    const [tasks, events, sessions, goals] = await Promise.all([
      this.driver.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE subject_id = ?', [id]),
      this.driver.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE subject_id = ?', [id]),
      this.driver.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM study_sessions WHERE subject_id = ?', [id]),
      this.driver.getFirst<{ n: number }>('SELECT COUNT(*) AS n FROM goals WHERE subject_id = ?', [id]),
    ]);
    return {
      tasks: tasks?.n ?? 0,
      events: events?.n ?? 0,
      sessions: sessions?.n ?? 0,
      goals: goals?.n ?? 0,
    };
  }

  /**
   * Удалить предмет. Внешние ключи: задачи/события/сессии — SET NULL
   * (данные сохраняются, связь теряет предмет), цели — CASCADE.
   */
  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM subjects WHERE id = ?', [id]);
    return res.changes > 0;
  }

  /** Архивировать: предмет скрывается из списков выбора, но связи и история целы. */
  async archive(id: ID, now: number = Date.now()): Promise<boolean> {
    const res = await this.driver.run('UPDATE subjects SET archived = 1, updated_at = ? WHERE id = ?', [now, id]);
    return res.changes > 0;
  }
}
