/**
 * Персонализация на одном экране: тема, цвет акцента, размер текста,
 * вид карточек пар с живым примером, стартовая вкладка, блоки главной.
 * Всё применяется сразу и сохраняется в настройках.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button, Card, Chip } from '../src/components/ui/primitives';
import { SegmentedControl, SwitchRow } from '../src/components/ui/inputs';
import { EventCard } from '../src/components/schedule/EventCard';
import { useResolvedColorScheme, useSettings, useTheme } from '../src/state/AppContexts';
import { ACCENTS } from '../src/theme/tokens';
import { HOME_BLOCKS, toggleHomeBlock } from '../src/logic/prefs';
import { DEFAULT_SETTINGS, type EventWithRelations, type FontScale, type HomeBlock, type StartTab, type ThemeMode } from '../src/models/types';

const BLOCK_LABELS: Record<HomeBlock, string> = {
  stats: 'Статистика дня',
  dayload: 'Загруженность',
  lessons: 'Ближайшие пары',
  debts: 'Долги',
  priority: 'Высокий приоритет',
  deadlines: 'Дедлайны',
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
  const isCustomized =
    settings.themeMode !== DEFAULT_SETTINGS.themeMode ||
    settings.accentColor !== DEFAULT_SETTINGS.accentColor ||
    settings.fontScale !== DEFAULT_SETTINGS.fontScale ||
    settings.compactSchedule !== DEFAULT_SETTINGS.compactSchedule ||
    settings.startTab !== DEFAULT_SETTINGS.startTab ||
    hidden.length > 0;

  const accentLabel = ACCENTS.find((a) => a.id === settings.accentColor)?.label ?? '';
  const rowLabel = { color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600' as const, marginBottom: 6 };

  return (
    <Screen testID="appearance-screen">
      <ScreenHeader title="Персонализация" testID="appearance-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48, gap: spacing.md }}>
        {/* Вид: тема, акцент, размер текста — одной карточкой */}
        <Card>
          <Text style={rowLabel}>Тема</Text>
          <SegmentedControl<ThemeMode>
            testID="appearance-theme"
            value={settings.themeMode}
            onChange={(v) => void update({ themeMode: v })}
            options={[
              { value: 'light', label: 'Светлая', icon: 'sunny-outline' },
              { value: 'dark', label: 'Тёмная', icon: 'moon-outline' },
              { value: 'system', label: 'Авто', icon: 'contrast-outline' },
            ]}
          />

          <Text style={[rowLabel, { marginTop: spacing.md }]}>
            Цвет акцента: <Text style={{ color: colors.primary }}>{accentLabel.toLowerCase()}</Text>
          </Text>
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
                  hitSlop={4}
                  style={[styles.swatchRing, { borderColor: selected ? color : 'transparent' }]}
                >
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    {selected ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={[rowLabel, { marginTop: spacing.md }]}>Размер текста</Text>
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
        </Card>

        {/* Живой пример: сразу видно акцент, размер текста и вид карточки */}
        <View>
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginBottom: 6 }}>Так будет выглядеть пара в расписании</Text>
          <EventCard event={sampleLesson()} compact={settings.compactSchedule} testID="appearance-preview" />
        </View>

        <Card>
          <SwitchRow
            testID="appearance-compact"
            label="Компактные карточки пар"
            description="Вид, аудитория и преподаватель в одну строку"
            value={settings.compactSchedule}
            onValueChange={(v) => void update({ compactSchedule: v })}
          />
          <Text style={[rowLabel, { marginTop: spacing.sm }]}>При запуске открывать</Text>
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

        <Card>
          <Text style={rowLabel}>Блоки на главной</Text>
          <View style={styles.chips}>
            {HOME_BLOCKS.map((b) => (
              <Chip
                key={b}
                testID={`home-block-${b}`}
                label={BLOCK_LABELS[b]}
                selected={!hidden.includes(b)}
                onPress={() => void update({ homeHiddenBlocks: toggleHomeBlock(hidden, b, hidden.includes(b)) })}
              />
            ))}
          </View>
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: spacing.sm }}>
            Нажмите, чтобы скрыть или показать. Задачи на сегодня и просроченные видны всегда.
          </Text>
        </Card>

        {isCustomized ? (
          <Button
            testID="appearance-reset"
            title="Сбросить оформление"
            variant="ghost"
            icon="refresh"
            onPress={() =>
              void update({
                themeMode: DEFAULT_SETTINGS.themeMode,
                accentColor: DEFAULT_SETTINGS.accentColor,
                fontScale: DEFAULT_SETTINGS.fontScale,
                compactSchedule: DEFAULT_SETTINGS.compactSchedule,
                startTab: DEFAULT_SETTINGS.startTab,
                homeHiddenBlocks: [],
              })
            }
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', justifyContent: 'space-between' },
  swatchRing: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
