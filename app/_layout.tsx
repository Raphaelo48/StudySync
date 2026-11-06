/**
 * Корневой layout: провайдеры (БД → настройки → тема → данные → тосты → таймер),
 * стек навигации, статус-бар и хост тостов.
 */
import React, { useEffect } from 'react';
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
} from '../src/state/AppContexts';
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
