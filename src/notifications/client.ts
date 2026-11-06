/**
 * Безопасная обёртка над expo-notifications.
 *
 * Принципы:
 * - Любой отказ ОС (нет разрешения, ограничения, веб-платформа) не должен
 *   ломать приложение: методы возвращают статус, а не бросают исключения.
 * - Мы не обещаем гарантированную доставку: ОС может ограничивать уведомления
 *   (режимы энергосбережения, отключённые каналы и т.п.).
 */
import { Platform } from 'react-native';
import { logger } from '../core/logger';

export type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'unavailable' | 'provisional';

export interface NotificationClient {
  /** Текущий статус разрешения (без запроса). */
  getPermissionStatus(): Promise<PermissionStatus>;
  /** Запросить разрешение. Возвращает итоговый статус. */
  requestPermission(): Promise<PermissionStatus>;
  /** Запланировать локальное уведомление с фиксированным идентификатором. */
  schedule(identifier: string, title: string, body: string, fireAt: number): Promise<boolean>;
  cancel(identifier: string): Promise<void>;
  cancelMany(identifiers: string[]): Promise<void>;
  /**
   * Идентификаторы всех запланированных уведомлений. Нужен, чтобы находить и снимать
   * «осиротевшие» напоминания (удалённые задачи и события). Необязателен.
   */
  listScheduledIds?(): Promise<string[]>;
  /** Поддерживаются ли локальные уведомления в текущем окружении. */
  isSupported(): boolean;
}

/** Клиент-заглушка: используется на веб-платформе и при ошибках модуля. */
export class NoopNotificationClient implements NotificationClient {
  constructor(private readonly status: PermissionStatus = 'unavailable') {}
  isSupported(): boolean {
    return false;
  }
  async getPermissionStatus(): Promise<PermissionStatus> {
    return this.status;
  }
  async requestPermission(): Promise<PermissionStatus> {
    return this.status;
  }
  async schedule(): Promise<boolean> {
    return false;
  }
  async cancel(): Promise<void> {}
  async cancelMany(): Promise<void> {}
}

let expoNotificationsModule: typeof import('expo-notifications') | null = null;
let expoLoadFailed = false;

/**
 * Android-канал для напоминаний. На Android 8+ звук и важность уведомления
 * определяются каналом, а настройки канала после создания изменить нельзя —
 * поэтому при смене параметров канала нужно менять его идентификатор.
 */
export const REMINDERS_CHANNEL_ID = 'reminders-v1';

/**
 * Одноразовая настройка модуля:
 * - обработчик показа уведомлений, когда приложение открыто (без него ОС
 *   не показывает и не озвучивает уведомление на переднем плане);
 * - Android-канал с высокой важностью и стандартным звуком.
 */
async function configureModule(mod: typeof import('expo-notifications')): Promise<void> {
  try {
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (error) {
    logger.warn('notifications', 'Не удалось установить обработчик уведомлений', { error });
  }
  if (Platform.OS === 'android') {
    try {
      await mod.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
        name: 'Напоминания',
        importance: mod.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
      });
    } catch (error) {
      logger.warn('notifications', 'Не удалось создать канал уведомлений', { error });
    }
  }
}

async function loadModule(): Promise<typeof import('expo-notifications') | null> {
  if (expoLoadFailed) return null;
  if (expoNotificationsModule) return expoNotificationsModule;
  try {
    const mod = await import('expo-notifications');
    await configureModule(mod);
    expoNotificationsModule = mod;
    return expoNotificationsModule;
  } catch (error) {
    expoLoadFailed = true;
    logger.warn('notifications', 'Модуль уведомлений недоступен в этом окружении', { error });
    return null;
  }
}

export class ExpoNotificationClient implements NotificationClient {
  isSupported(): boolean {
    return Platform.OS === 'ios' || Platform.OS === 'android';
  }

  async getPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isSupported()) return 'unavailable';
    const mod = await loadModule();
    if (!mod) return 'unavailable';
    try {
      const settings = await mod.getPermissionsAsync();
      return mapStatus(settings.status, settings.granted);
    } catch (error) {
      logger.error('notifications', 'Не удалось прочитать статус разрешения', error);
      return 'unknown';
    }
  }

  async requestPermission(): Promise<PermissionStatus> {
    if (!this.isSupported()) return 'unavailable';
    const mod = await loadModule();
    if (!mod) return 'unavailable';
    try {
      const current = await mod.getPermissionsAsync();
      if (current.granted) return mapStatus(current.status, current.granted);
      if (!current.canAskAgain) {
        // ОС больше не позволяет спрашивать — пользователь должен включить вручную.
        return 'denied';
      }
      const requested = await mod.requestPermissionsAsync();
      return mapStatus(requested.status, requested.granted);
    } catch (error) {
      logger.error('notifications', 'Ошибка запроса разрешения', error);
      return 'unknown';
    }
  }

  async schedule(identifier: string, title: string, body: string, fireAt: number): Promise<boolean> {
    if (!this.isSupported()) return false;
    const mod = await loadModule();
    if (!mod) return false;
    const permission = await this.getPermissionStatus();
    if (permission !== 'granted' && permission !== 'provisional') return false;
    if (fireAt <= Date.now()) return false; // прошедшие уведомления не планируем
    try {
      await mod.scheduleNotificationAsync({
        identifier,
        content: { title, body, sound: 'default' },
        trigger: {
          type: mod.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
          channelId: REMINDERS_CHANNEL_ID,
        },
      });
      return true;
    } catch (error) {
      // Идентификатор может уже существовать — отменяем и пробуем один раз снова.
      try {
        await mod.cancelScheduledNotificationAsync(identifier);
        await mod.scheduleNotificationAsync({
          identifier,
          content: { title, body, sound: 'default' },
          trigger: {
            type: mod.SchedulableTriggerInputTypes.DATE,
            date: new Date(fireAt),
            channelId: REMINDERS_CHANNEL_ID,
          },
        });
        return true;
      } catch (retryError) {
        logger.error('notifications', 'Не удалось запланировать уведомление', retryError ?? error);
        return false;
      }
    }
  }

  async cancel(identifier: string): Promise<void> {
    const mod = await loadModule();
    if (!mod) return;
    try {
      await mod.cancelScheduledNotificationAsync(identifier);
    } catch (error) {
      logger.warn('notifications', 'Не удалось отменить уведомление', { error });
    }
  }

  async cancelMany(identifiers: string[]): Promise<void> {
    for (const id of identifiers) {
      await this.cancel(id);
    }
  }

  async listScheduledIds(): Promise<string[]> {
    const mod = await loadModule();
    if (!mod) return [];
    try {
      const all = await mod.getAllScheduledNotificationsAsync();
      return all.map((n) => n.identifier);
    } catch (error) {
      logger.warn('notifications', 'Не удалось получить список запланированных уведомлений', { error });
      return [];
    }
  }
}

export function mapStatus(status: number | string, granted: boolean): PermissionStatus {
  if (granted) return 'granted';
  // expo-notifications возвращает числовой enum:
  // 0 = UNDETERMINED, 1 = DENIED, 2 = GRANTED, 3 = PROVISIONAL
  const numeric = typeof status === 'number' ? status : Number(status);
  if (!Number.isNaN(numeric)) {
    if (numeric === 1) return 'denied';
    if (numeric === 2) return 'granted';
    if (numeric === 3) return 'provisional';
    if (numeric === 0) return 'unknown';
  }
  const s = String(status).toLowerCase();
  if (s === 'denied') return 'denied';
  if (s === 'provisional') return 'provisional';
  if (s === 'granted') return 'granted';
  return 'unknown';
}

let activeClient: NotificationClient | null = null;

/** Единая точка доступа к клиенту уведомлений приложения. */
export function getNotificationClient(): NotificationClient {
  if (activeClient) return activeClient;
  activeClient =
    Platform.OS === 'ios' || Platform.OS === 'android'
      ? new ExpoNotificationClient()
      : new NoopNotificationClient();
  return activeClient;
}

/** Только для тестов: подменить клиент. */
export function setNotificationClientForTesting(client: NotificationClient | null): void {
  activeClient = client;
}
