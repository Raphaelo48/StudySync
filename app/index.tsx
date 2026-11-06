/**
 * Точка входа: первый запуск → экран приветствия, иначе → основные разделы.
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
  return <Redirect href="/(tabs)" />;
}
