/**
 * Отметка задачи выполненной из списков (главная, вкладка «Задачи»).
 * Помимо смены статуса синхронизирует напоминание о дедлайне: у выполненной
 * задачи оно снимается, при снятии отметки — восстанавливается.
 */
import type { AppDatabase } from '../db/database';
import type { ID, Task, TaskStatus } from '../models/types';
import { getNotificationClient } from '../notifications/client';
import { cancelTaskNotification, syncTaskDeadlineNotification } from '../notifications/scheduler';

async function syncDeadline(db: AppDatabase, task: Task, now: number): Promise<void> {
  const client = getNotificationClient();
  if (task.status === 'done') {
    await cancelTaskNotification(client, task.id);
  } else {
    const settings = await db.settings.get();
    await syncTaskDeadlineNotification(client, settings, task, now);
  }
}

export async function toggleTaskDone(db: AppDatabase, taskId: ID, now: number = Date.now()): Promise<Task | null> {
  const updated = await db.tasks.toggleDone(taskId, now);
  if (updated) await syncDeadline(db, updated, now);
  return updated;
}

/** Вернуть прежний статус (кнопка «Отменить» в тосте). */
export async function restoreTaskStatus(
  db: AppDatabase,
  taskId: ID,
  status: TaskStatus,
  now: number = Date.now()
): Promise<Task | null> {
  const updated = await db.tasks.setStatus(taskId, status, { now });
  if (updated) await syncDeadline(db, updated, now);
  return updated;
}
