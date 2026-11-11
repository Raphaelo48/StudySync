/**
 * Глобальные контексты приложения: база данных, настройки, тема, тосты.
 *
 * Иерархия провайдеров (app/_layout.tsx):
 * DatabaseProvider → SettingsProvider → ThemeProvider → ToastProvider → TimerProvider
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Text, View, useColorScheme } from 'react-native';
import { AppDatabase } from '../db/database';
import { createExpoDriver } from '../db/drivers/expoDriver';
import { DEFAULT_SETTINGS, type ThemeMode, type UserSettings } from '../models/types';
import { buildTheme, type Theme } from '../theme/tokens';
import { logger } from '../core/logger';

/* ---------------------------------- База данных ---------------------------------- */

const DatabaseContext = createContext<AppDatabase | null>(null);

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const driver = createExpoDriver();
        const database = await AppDatabase.open(driver);
        if (!cancelled) setDb(database);
      } catch (e) {
        logger.error('db', 'Не удалось открыть базу данных', e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Неизвестная ошибка базы данных');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    // Крайний случай: БД не открылась. Показываем понятное сообщение,
    // а не пустой экран.
    return <FatalErrorScreen message={error} />;
  }
  if (!db) return null; // корневой layout показывает splash, пока null
  return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): AppDatabase {
  const db = useContext(DatabaseContext);
  if (!db) throw new Error('useDatabase вне DatabaseProvider');
  return db;
}

function FatalErrorScreen({ message }: { message: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0F1222',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Text style={{ color: '#ECEEF7', fontSize: 17, fontWeight: '600', marginBottom: 8 }}>
        Не удалось запустить StudySync
      </Text>
      <Text style={{ color: '#A6ADCB', fontSize: 14, textAlign: 'center' }}>{message}</Text>
    </View>
  );
}

/* ---------------------------------- Настройки ---------------------------------- */

interface SettingsContextValue {
  settings: UserSettings;
  ready: boolean;
  update(patch: Partial<Omit<UserSettings, 'createdAt' | 'updatedAt'>>): Promise<UserSettings>;
  reload(): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const db = useDatabase();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const s = await db.settings.get();
    setSettings(s);
    setReady(true);
  }, [db]);

  useEffect(() => {
    reload().catch((e) => logger.error('settings', 'Ошибка загрузки настроек', e));
  }, [reload]);

  const update = useCallback(
    async (patch: Partial<Omit<UserSettings, 'createdAt' | 'updatedAt'>>) => {
      const next = await db.settings.update(patch);
      setSettings(next);
      return next;
    },
    [db]
  );

  const value = useMemo(() => ({ settings, ready, update, reload }), [settings, ready, update, reload]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings вне SettingsProvider');
  return ctx;
}

/* ---------------------------------- Тема ---------------------------------- */

interface ThemeContextValue {
  theme: Theme;
  resolvedMode: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const { settings } = useSettings();
  const mode: ThemeMode = settings.themeMode;
  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;
  const theme = useMemo(
    () => buildTheme(resolved === 'dark', settings.accentColor, settings.fontScale),
    [resolved, settings.accentColor, settings.fontScale]
  );
  const value = useMemo(() => ({ theme, resolvedMode: resolved }), [theme, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) return buildTheme(true); // защита вне провайдера (тесты)
  return ctx.theme;
}

export function useResolvedColorScheme(): 'light' | 'dark' {
  const ctx = useContext(ThemeContext);
  if (!ctx) return 'dark';
  return ctx.resolvedMode;
}

/* ---------------------------------- «Версия данных» ---------------------------------- */

/**
 * Простой механизм межэкранной синхронизации: любое изменение данных
 * увеличивает счётчик, экраны перечитывают данные при фокусе и по изменению.
 */
const DataVersionContext = createContext<{ version: number; bump: () => void }>({
  version: 0,
  bump: () => {},
});

export function DataVersionProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ version, bump }), [version, bump]);
  return <DataVersionContext.Provider value={value}>{children}</DataVersionContext.Provider>;
}

export function useDataVersion(): { version: number; bump: () => void } {
  return useContext(DataVersionContext);
}

/* ---------------------------------- Тосты ---------------------------------- */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  show(kind: ToastKind, message: string, action?: ToastAction): void;
  success(message: string, action?: ToastAction): void;
  error(message: string, action?: ToastAction): void;
  info(message: string, action?: ToastAction): void;
  hide(id: number): void;
  toasts: ToastItem[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProviderInternal({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const hide = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string, action?: ToastAction) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-2), { id, kind, message, action }]);
      const timer = setTimeout(() => hide(id), action ? 5000 : 3000);
      timers.current.set(id, timer);
    },
    [hide]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      hide,
      success: (m, a) => show('success', m, a),
      error: (m, a) => show('error', m, a),
      info: (m, a) => show('info', m, a),
      toasts,
    }),
    [show, hide, toasts]
  );
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Вне провайдера (например, в изолированных тестах) — безопасная заглушка.
    return {
      show: () => {},
      hide: () => {},
      success: () => {},
      error: () => {},
      info: () => {},
      toasts: [],
    };
  }
  return ctx;
}
