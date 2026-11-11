/**
 * Оформление и персонализация: тема, цвет акцента, размер шрифта,
 * стартовая вкладка, блоки главного экрана, компактное расписание.
 * Всё применяется сразу и сохраняется в настройках.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Card, SectionTitle } from '../src/components/ui/primitives';
import { SegmentedControl, SwitchRow } from '../src/components/ui/inputs';
import { EventCard } from '../src/components/schedule/EventCard';
import { useResolvedColorScheme, useSettings, useTheme } from '../src/state/AppContexts';
import { ACCENTS } from '../src/theme/tokens';
import { HOME_BLOCKS, toggleHomeBlock } from '../src/logic/prefs';
import type { EventWithRelations, FontScale, HomeBlock, StartTab, ThemeMode } from '../src/models/types';

const BLOCK_LABELS: Record<HomeBlock, { label: string; description: string }> = {
  stats: { label: 'Статистика дня', description: 'выполнено, фокус, запланировано' },
  dayload: { label: 'Загруженность дня', description: 'шкала нагрузки и перепланирование' },
  lessons: { label: 'Ближайшие занятия', description: 'пары на сегодня и завтра' },
  debts: { label: 'Долги и отработки', description: 'два ближайших долга' },
  priority: { label: 'Высокий приоритет', description: 'важные задачи' },
  deadlines: { label: 'Ближайшие дедлайны', description: 'сроки задач на неделю' },
};

/** Пример пары для предпросмотра вида карточек. */
function sampleLesson(): EventWithRelations {
  const start = new Date();
  start.setHours(9, 40, 0, 0);
  return {
    id: 'preview',
    title: 'Маркетинг ИТ-продуктов',
    kind: 'lesson',
    subjectId: null,
    taskId: null,
    location: 'Б-301',
    startAt: start.getTime(),
    endAt: start.getTime() + 90 * 60_000,
    notes: 'Лекция · Петрова Анна Сергеевна · пара №2',
    seriesId: null,
    recurrence: null,
    notifyOffsetMinutes: null,
    source: 'kgeu',
    sourceRef: 'preview',
    createdAt: 0,
    updatedAt: 0,
    subject: null,
    task: null,
  };
}

export default function AppearanceScreen() {
  const { colors, fontSizes, spacing } = useTheme();
  const scheme = useResolvedColorScheme();
  const { settings, update } = useSettings();
  const hidden = settings.homeHiddenBlocks;

  return (
    <Screen testID="appearance-screen">
      <ScreenHeader title="Оформление" testID="appearance-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        <SectionTitle title="Тема" />
        <Card>
          <SegmentedControl<ThemeMode>
            testID="appearance-theme"
            value={settings.themeMode}
            onChange={(v) => void update({ themeMode: v })}
            options={[
              { value: 'light', label: 'Светлая', icon: 'sunny-outline' },
              { value: 'dark', label: 'Тёмная', icon: 'moon-outline' },
              { value: 'system', label: 'Системная', icon: 'contrast-outline' },
            ]}
          />
        </Card>

        <SectionTitle title="Цвет акцента" />
        <Card>
          <View style={styles.swatches}>
            {ACCENTS.map((a) => {
              const selected = settings.accentColor === a.id;
              const color = scheme === 'dark' ? a.dark.primary : a.light.primary;
              return (
                <Pressable
                  key={a.id}
                  testID={`accent-${a.id}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Цвет акцента: ${a.label}`}
                  onPress={() => void update({ accentColor: a.id })}
                  style={styles.swatchWrap}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: color, borderColor: selected ? colors.text : 'transparent' },
                    ]}
                  >
                    {selected ? <Ionicons name="checkmark" size={20} color="#FFFFFF" /> : null}
                  </View>
                  <Text style={{ color: selected ? colors.text : colors.textMuted, fontSize: fontSizes.xs, marginTop: 4 }} numberOfLines={1}>
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <SectionTitle title="Размер текста" />
        <Card>
          <SegmentedControl<FontScale>
            testID="appearance-font"
            value={settings.fontScale}
            onChange={(v) => void update({ fontScale: v })}
            options={[
              { value: 'small', label: 'Мельче' },
              { value: 'normal', label: 'Обычный' },
              { value: 'large', label: 'Крупнее' },
            ]}
          />
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.md, marginTop: spacing.md }}>
            Так выглядит основной текст приложения.
          </Text>
        </Card>

        <SectionTitle title="Расписание" />
        <Card>
          <SwitchRow
            testID="appearance-compact"
            label="Компактные карточки пар"
            description="Вид, аудитория и преподаватель в одну строку — больше пар на экране"
            value={settings.compactSchedule}
            onValueChange={(v) => void update({ compactSchedule: v })}
          />
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginBottom: spacing.sm }}>Предпросмотр</Text>
          <EventCard event={sampleLesson()} compact={settings.compactSchedule} testID="appearance-preview" />
        </Card>

        <SectionTitle title="При запуске открывать" />
        <Card>
          <SegmentedControl<StartTab>
            testID="appearance-start-tab"
            value={settings.startTab}
            onChange={(v) => void update({ startTab: v })}
            options={[
              { value: 'index', label: 'Главная' },
              { value: 'schedule', label: 'Расписание' },
              { value: 'tasks', label: 'Задачи' },
            ]}
          />
        </Card>

        <SectionTitle title="Блоки на главной" />
        <Card>
          {HOME_BLOCKS.map((b) => (
            <SwitchRow
              key={b}
              testID={`home-block-${b}`}
              label={BLOCK_LABELS[b].label}
              description={BLOCK_LABELS[b].description}
              value={!hidden.includes(b)}
              onValueChange={(v) => void update({ homeHiddenBlocks: toggleHomeBlock(hidden, b, v) })}
            />
          ))}
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: spacing.xs }}>
            Задачи на сегодня и просроченные показываются всегда.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  swatchWrap: {
    width: '30%',
    alignItems: 'center',
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
