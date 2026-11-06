/**
 * Инициализация базы данных приложения и точка доступа к репозиториям.
 */
import { DatabaseError, type SqlDriver } from './driver';
import { runMigrations, getSchemaVersion, SCHEMA_VERSION } from './schema';
import { SubjectsRepo } from './repos/subjectsRepo';
import { TasksRepo } from './repos/tasksRepo';
import { SubtasksRepo } from './repos/subtasksRepo';
import { EventsRepo } from './repos/eventsRepo';
import { SessionsRepo } from './repos/sessionsRepo';
import { SettingsRepo } from './repos/settingsRepo';
import { GoalsRepo } from './repos/goalsRepo';
import { TimerRepo } from './repos/timerRepo';
import { PlanHistoryRepo } from './repos/planHistoryRepo';
import { DebtsRepo } from './repos/debtsRepo';
import { LessonNotesRepo } from './repos/lessonNotesRepo';
import { IDLE_TIMER_STATE } from '../models/types';

export class AppDatabase {
  readonly subjects: SubjectsRepo;
  readonly tasks: TasksRepo;
  readonly subtasks: SubtasksRepo;
  readonly events: EventsRepo;
  readonly sessions: SessionsRepo;
  readonly settings: SettingsRepo;
  readonly goals: GoalsRepo;
  readonly timer: TimerRepo;
  readonly plans: PlanHistoryRepo;
  readonly debts: DebtsRepo;
  readonly lessonNotes: LessonNotesRepo;

  private constructor(readonly driver: SqlDriver) {
    this.subjects = new SubjectsRepo(driver);
    this.tasks = new TasksRepo(driver);
    this.subtasks = new SubtasksRepo(driver);
    this.events = new EventsRepo(driver);
    this.sessions = new SessionsRepo(driver);
    this.settings = new SettingsRepo(driver);
    this.goals = new GoalsRepo(driver);
    this.timer = new TimerRepo(driver);
    this.plans = new PlanHistoryRepo(driver);
    this.debts = new DebtsRepo(driver);
    this.lessonNotes = new LessonNotesRepo(driver);
  }

  /**
   * Открыть базу: включить и проверить внешние ключи, применить миграции,
   * убедиться в наличии строк-синглтонов (настройки, состояние таймера).
   */
  static async open(driver: SqlDriver): Promise<AppDatabase> {
    // PRAGMA foreign_keys нельзя менять внутри транзакции — выполняем до миграций.
    await driver.exec('PRAGMA foreign_keys = ON;');
    const fk = await driver.getFirst<{ foreign_keys: number | null }>('PRAGMA foreign_keys;');
    if (!fk || fk.foreign_keys !== 1) {
      throw new DatabaseError(
        'Внешние ключи SQLite не активированы — целостность данных не гарантируется'
      );
    }
    await runMigrations(driver);
    const version = await getSchemaVersion(driver);
    if (version !== SCHEMA_VERSION) {
      throw new DatabaseError(`Версия схемы ${version} не соответствует ожидаемой ${SCHEMA_VERSION}`);
    }
    const db = new AppDatabase(driver);
    await db.settings.ensureRow();
    await db.timer.ensureRow(IDLE_TIMER_STATE);
    return db;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
