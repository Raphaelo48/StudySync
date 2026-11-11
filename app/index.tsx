/**
 * Точка входа: первый запуск → экран приветствия, иначе → стартовая вкладка
 * (по умолчанию «Главная», выбирается в разделе «Оформление»).
 */
import React from 'react';
import { Redirect } from 'expo-router';
import { useSettings } from '../src/state/AppContexts';
import { Spinner } from '../src/components/ui/primitives';
import { View } from 'react-native';

export default function Index() {
  const { settings, ready } = useSettings();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Spinner testID="boot-spinner" />
      </View>
    );
  }
  if (!settings.onboardingDone) {
    return <Redirect href="/welcome" />;
  }
  // Стартовая вкладка из настроек «Оформление».
  if (settings.startTab === 'schedule') return <Redirect href="/(tabs)/schedule" />;
  if (settings.startTab === 'tasks') return <Redirect href="/(tabs)/tasks" />;
  return <Redirect href="/(tabs)" />;
}
