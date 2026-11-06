/**
 * Первоначальная настройка: имя (необязательно), базовые параметры,
 * быстрый старт. Не блокирует приложение — всё можно «Пропустить».
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { Button, Card } from '../src/components/ui/primitives';
import { TextField } from '../src/components/ui/inputs';
import { SegmentedControl } from '../src/components/ui/inputs';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../src/state/AppContexts';
import { IS_DEMO } from '../src/core/appVariant';
import { hasUserData, seedDemoData } from '../src/logic/demoData';
import { SUBJECT_COLORS, type ThemeMode } from '../src/models/types';

const FEATURES: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; text: string }> = [
  { icon: 'calendar-outline', title: 'Расписание КГЭУ и сводка', text: 'Импорт пар по группе, напоминания и утренняя сводка: пары, дедлайны, отработки.' },
  { icon: 'checkbox-outline', title: 'Задачи и шаблоны', text: 'Курсовая, лаба, экзамен — этапы со сроками от даты защиты создаются сами.' },
  { icon: 'timer-outline', title: 'Фокус-сессии', text: 'Pomodoro или секундомер; активное время не теряется даже при закрытии приложения.' },
  { icon: 'git-compare-outline', title: 'Умный перепланировщик', text: 'При перегрузе предложит реалистичный план и покажет, что не помещается.' },
  { icon: 'alert-circle-outline', title: 'Долги и конспекты', text: 'Отработки с чек-листом «что взять» и фото доски к каждой паре.' },
];

export default function WelcomeScreen() {
  const { colors, fontSizes, spacing } = useTheme();
  const { settings, update } = useSettings();
  const db = useDatabase();
  const { bump } = useDataVersion();
  const toast = useToast();

  const [name, setName] = useState(settings.displayName);
  const [theme, setTheme] = useState<ThemeMode>(settings.themeMode);
  const [finishing, setFinishing] = useState(false);

  const finish = async (withDemo = false) => {
    setFinishing(true);
    try {
      await update({
        displayName: name.trim().slice(0, 60),
        themeMode: theme,
        onboardingDone: true,
      });
      if (withDemo && !(await hasUserData(db))) {
        await seedDemoData(db);
        bump();
      }
      router.replace('/(tabs)');
    } catch {
      toast.error('Не удалось сохранить настройки');
      setFinishing(false);
    }
  };

  return (
    <Screen testID="welcome-screen" scroll>
      <View style={{ paddingTop: spacing.xxxl, alignItems: 'center' }}>
        <View style={[styles.logo, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="school" size={30} color={colors.primary} />
        </View>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', marginTop: spacing.md }}>StudySync</Text>
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.md, textAlign: 'center', marginTop: spacing.xs, lineHeight: 20 }}>
          Учебный планировщик, который помогает успевать без стресса.
          {'\n'}Все данные остаются на вашем устройстве.
        </Text>
      </View>

      <View style={{ marginTop: spacing.xxl }}>
        <TextField
          testID="welcome-name"
          label="Как к вам обращаться? (необязательно)"
          value={name}
          onChangeText={setName}
          placeholder="Имя"
          maxLength={60}
        />
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.sm }}>
          Тема оформления
        </Text>
        <SegmentedControl<ThemeMode>
          testID="welcome-theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Светлая' },
            { value: 'dark', label: 'Тёмная' },
            { value: 'system', label: 'Системная' },
          ]}
        />
      </View>

      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        {FEATURES.map((f) => (
          <Card key={f.title} style={styles.featureCard}>
            <View style={[styles.featureIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={f.icon} size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>{f.title}</Text>
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, lineHeight: 18, marginTop: 2 }}>{f.text}</Text>
            </View>
          </Card>
        ))}
      </View>

      <View style={{ marginTop: spacing.xxl }}>
        {IS_DEMO ? (
          <>
            <Button
              testID="welcome-demo"
              title="Посмотреть на примере"
              size="lg"
              icon="sparkles-outline"
              loading={finishing}
              onPress={() => void finish(true)}
            />
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, textAlign: 'center', marginTop: 6, marginBottom: spacing.md }}>
              Добавим расписание, задачи и долги для примера. Убрать их можно в «Профиль → Сброс данных».
            </Text>
            <Button testID="welcome-start" title="Начать с чистого листа" size="lg" variant="secondary" icon="arrow-forward" onPress={() => void finish()} />
          </>
        ) : (
          <Button testID="welcome-start" title="Начать" size="lg" icon="arrow-forward" loading={finishing} onPress={() => void finish()} />
        )}
        <Button
          testID="welcome-skip"
          title="Пропустить настройку"
          variant="ghost"
          style={{ marginTop: spacing.sm }}
          onPress={() => void update({ onboardingDone: true }).then(() => router.replace('/(tabs)'))}
        />
      </View>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
