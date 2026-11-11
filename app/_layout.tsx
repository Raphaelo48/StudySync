/**
 * Корневой layout: провайдеры (БД → настройки → тема → данные → тосты → таймер),
 * стек навигации, статус-бар и хост тостов.
 */
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DatabaseProvider,
  DataVersionProvider,
  SettingsProvider,
  ThemeProvider,
  ToastProviderInternal,
  useDataVersion,
  useResolvedColorScheme,
  useSettings,
  useTheme,
  useToast,
} from '../src/state/AppContexts';
import { runAutoSync } from '../src/logic/kgeuAutoSync';
import { pluralRu } from '../src/core/time';
import { TimerProvider } from '../src/state/TimerContext';
import { ToastHost } from '../src/components/ui/overlays';
import { getNotificationClient } from '../src/notifications/client';
import { resyncAllNotifications } from '../src/notifications/scheduler';
import { useDatabase } from '../src/state/AppContexts';
import { logger } from '../src/core/logger';

/** Мост статус-бара к текущей теме. */
function StatusBarBridge() {
  const scheme = useResolvedColorScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

/**
 * Однократная синхронизация напоминаний при старте приложения:
 * чистит устаревшие и перепланирует актуальные уведомления.
 */
function NotificationsSyncBridge() {
  const db = useDatabase();
  const { settings, ready } = useSettings();
  const { version } = useDataVersion();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        await resyncAllNotifications(db, getNotificationClient());
      } catch (e) {
        logger.warn('notifications', 'Синхронизация напоминаний при старте не удалась', { e });
      }
    })();
    return () => {
      cancelled = true;
      void cancelled;
    };
    // Пересинхронизация при изменении настроек и любых данных.
  }, [db, ready, settings.notificationsEnabled, settings.notifyLesson, settings.notifyLessonBeforeMin, settings.notifyDeadline, settings.notifyDeadlineBeforeMin, settings.morningDigestEnabled, settings.morningDigestTimeMin, version]);
  return null;
}

/**
 * Автообновление расписания своей группы: при запуске и при возвращении из фона
 * (не чаще раза в 6 часов, только если включено в настройках). Ошибки сети
 * не показываются — расписание просто останется прежним до следующей попытки.
 */
function KgeuAutoSyncBridge() {
  const db = useDatabase();
  const { ready, reload } = useSettings();
  const { bump } = useDataVersion();
  const toast = useToast();
  const running = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const attempt = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const res = await runAutoSync(db);
        if (res.status === 'synced') {
          await reload();
          if (res.changes > 0) {
            bump();
            toast.info(
              `Расписание ${res.groupName} обновлено: ${res.changes} ${pluralRu(res.changes, 'изменение', 'изменения', 'изменений')}`
            );
          }
        }
      } catch (e) {
        logger.warn('kgeu', 'Автообновление расписания не удалось', { e });
      } finally {
        running.current = false;
      }
    };
    void attempt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void attempt();
    });
    return () => sub.remove();
    // ready меняется один раз — подписка живёт всё время работы приложения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ready]);
  return null;
}

function ThemedStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
      <Stack.Screen name="task/[id]" />
      <Stack.Screen name="task/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="event/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="focus" options={{ animation: 'fade' }} />
      <Stack.Screen name="replan" />
      <Stack.Screen name="university" />
      <Stack.Screen name="schedule-search" />
      <Stack.Screen name="schedule-view" />
      <Stack.Screen name="appearance" />
      <Stack.Screen name="subjects" />
      <Stack.Screen name="subject/edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" />
      <Stack.Screen name="data" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="debts" />
      <Stack.Screen name="notes" />
      <Stack.Screen name="lesson-note" />
      <Stack.Screen name="debt/edit" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <SettingsProvider>
          <ThemeProvider>
            <DataVersionProvider>
              <ToastProviderInternal>
                <TimerProvider>
                  <StatusBarBridge />
                  <NotificationsSyncBridge />
                  <KgeuAutoSyncBridge />
                  <ThemedStack />
                  <ToastHost />
                </TimerProvider>
              </ToastProviderInternal>
            </DataVersionProvider>
          </ThemeProvider>
        </SettingsProvider>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
