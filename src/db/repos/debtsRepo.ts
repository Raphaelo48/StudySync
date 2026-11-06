import { newId } from '../../core/id';
import type { ChecklistItem, Debt, DebtKind, DebtStatus, DebtWithSubject, ID } from '../../models/types';
import type { SqlDriver } from '../driver';

interface DebtRow {
  id: string;
  subject_id: string | null;
  title: string;
  kind: string;
  teacher: string | null;
  attempt: number;
  retake_at: number | null;
  location: string | null;
  checklist_json: string;
  status: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
  passed_at: number | null;
  subject_name?: string | null;
  subject_color?: string | null;
}

function parseChecklist(raw: string | null): ChecklistItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is { text: unknown; done: unknown } => typeof x === 'object' && x !== null)
      .map((x) => ({ text: String(x.text ?? ''), done: x.done === true }))
      .filter((x) => x.text.trim().length > 0);
  } catch {
    return [];
  }
}

function mapDebt(row: DebtRow): DebtWithSubject {
  return {
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    kind: row.kind as DebtKind,
    teacher: row.teacher,
    attempt: row.attempt,
    retakeAt: row.retake_at,
    location: row.location,
    checklist: parseChecklist(row.checklist_json),
    status: row.status as DebtStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passedAt: row.passed_at,
    subject:
      row.subject_id && row.subject_name
        ? { id: row.subject_id, name: row.subject_name, color: row.subject_color ?? '#7C6CF0' }
        : null,
  };
}

const SELECT = `
  SELECT d.*, s.name AS subject_name, s.color AS subject_color
  FROM debts d LEFT JOIN subjects s ON s.id = d.subject_id`;

export interface DebtInput {
  subjectId?: ID | null;
  title: string;
  kind?: DebtKind;
  teacher?: string | null;
  attempt?: number;
  retakeAt?: number | null;
  location?: string | null;
  checklist?: ChecklistItem[];
  status?: DebtStatus;
  notes?: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export class DebtsRepo {
  constructor(private readonly driver: SqlDriver) {}

  /**
   * Несданные долги: сначала с назначенной датой (по дате), затем без даты (новые выше).
   * Сданные — отдельно, через listPassed.
   */
  async listOpen(): Promise<DebtWithSubject[]> {
    const rows = await this.driver.getAll<DebtRow>(
      `${SELECT} WHERE d.status != 'passed'
       ORDER BY CASE WHEN d.retake_at IS NULL THEN 1 ELSE 0 END, d.retake_at, d.created_at DESC`
    );
    return rows.map(mapDebt);
  }

  async listPassed(limit = 100): Promise<DebtWithSubject[]> {
    const rows = await this.driver.getAll<DebtRow>(
      `${SELECT} WHERE d.status = 'passed' ORDER BY COALESCE(d.passed_at, d.updated_at) DESC LIMIT ?`,
      [limit]
    );
    return rows.map(mapDebt);
  }

  /** Назначенные отработки в интервале (для сводки и напоминаний). */
  async listRetakesBetween(from: number, to: number): Promise<DebtWithSubject[]> {
    const rows = await this.driver.getAll<DebtRow>(
      `${SELECT} WHERE d.status != 'passed' AND d.retake_at IS NOT NULL AND d.retake_at >= ? AND d.retake_at < ?
       ORDER BY d.retake_at`,
      [from, to]
    );
    return rows.map(mapDebt);
  }

  async get(id: ID): Promise<DebtWithSubject | null> {
    const row = await this.driver.getFirst<DebtRow>(`${SELECT} WHERE d.id = ?`, [id]);
    return row ? mapDebt(row) : null;
  }

  async countOpen(): Promise<number> {
    const row = await this.driver.getFirst<{ n: number }>("SELECT COUNT(*) AS n FROM debts WHERE status != 'passed'");
    return row?.n ?? 0;
  }

  async create(input: DebtInput, now: number = Date.now()): Promise<Debt> {
    const debt: Debt = {
      id: newId(),
      subjectId: input.subjectId ?? null,
      title: input.title.trim(),
      kind: input.kind ?? 'other',
      teacher: clean(input.teacher),
      attempt: Math.max(1, input.attempt ?? 1),
      retakeAt: input.retakeAt ?? null,
      location: clean(input.location),
      checklist: input.checklist ?? [],
      status: input.status ?? (input.retakeAt ? 'scheduled' : 'open'),
      notes: clean(input.notes),
      createdAt: now,
      updatedAt: now,
      passedAt: input.status === 'passed' ? now : null,
    };
    await this.driver.run(
      `INSERT INTO debts (id, subject_id, title, kind, teacher, attempt, retake_at, location, checklist_json,
        status, notes, created_at, updated_at, passed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        debt.id, debt.subjectId, debt.title, debt.kind, debt.teacher, debt.attempt, debt.retakeAt,
        debt.location, JSON.stringify(debt.checklist), debt.status, debt.notes, debt.createdAt,
        debt.updatedAt, debt.passedAt,
      ]
    );
    return debt;
  }

  async update(id: ID, patch: Partial<DebtInput>, now: number = Date.now()): Promise<DebtWithSubject | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next: Debt = {
      ...current,
      ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.teacher !== undefined ? { teacher: clean(patch.teacher) } : {}),
      ...(patch.attempt !== undefined ? { attempt: Math.max(1, patch.attempt) } : {}),
      ...(patch.retakeAt !== undefined ? { retakeAt: patch.retakeAt } : {}),
      ...(patch.location !== undefined ? { location: clean(patch.location) } : {}),
      ...(patch.checklist !== undefined ? { checklist: patch.checklist } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.notes !== undefined ? { notes: clean(patch.notes) } : {}),
      updatedAt: now,
    };
    if (patch.status !== undefined) {
      next.passedAt = patch.status === 'passed' ? (current.passedAt ?? now) : null;
    }
    await this.driver.run(
      `UPDATE debts SET subject_id = ?, title = ?, kind = ?, teacher = ?, attempt = ?, retake_at = ?,
        location = ?, checklist_json = ?, status = ?, notes = ?, updated_at = ?, passed_at = ?
       WHERE id = ?`,
      [
        next.subjectId, next.title, next.kind, next.teacher, next.attempt, next.retakeAt, next.location,
        JSON.stringify(next.checklist), next.status, next.notes, next.updatedAt, next.passedAt, id,
      ]
    );
    return this.get(id);
  }

  /** Отметить пункт чек-листа. */
  async toggleChecklistItem(id: ID, index: number, now: number = Date.now()): Promise<DebtWithSubject | null> {
    const current = await this.get(id);
    if (!current || index < 0 || index >= current.checklist.length) return current;
    const checklist = current.checklist.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    return this.update(id, { checklist }, now);
  }

  /**
   * Не сдал — следующая попытка: номер попытки +1, дата сбрасывается,
   * чек-лист снова не отмечен.
   */
  async nextAttempt(id: ID, now: number = Date.now()): Promise<DebtWithSubject | null> {
    const current = await this.get(id);
    if (!current) return null;
    return this.update(
      id,
      {
        attempt: current.attempt + 1,
        retakeAt: null,
        status: 'open',
        checklist: current.checklist.map((it) => ({ ...it, done: false })),
      },
      now
    );
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM debts WHERE id = ?', [id]);
    return res.changes > 0;
  }
}
