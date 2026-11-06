/**
 * Виджеты главного экрана: индикатор загруженности дня, плитки статистики,
 * мини-карточка активного таймера.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/AppContexts';
import { DAY_LOAD_LABELS, type DayLoadInfo } from '../../logic/analytics';
import { formatDurationMinutes, formatSecondsClock } from '../../core/time';

/* ---------------------------------- DayLoadBar ---------------------------------- */

export function DayLoadBar({ load, onPress }: { load: DayLoadInfo; onPress?: () => void }) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  const levelColor =
    load.level === 'overload'
      ? colors.danger
      : load.level === 'busy'
        ? colors.warning
        : load.level === 'moderate'
          ? colors.info
          : colors.success;
  const ratio = Math.min(load.ratio, 1);
  const content = (
    <View>
      <View style={styles.loadHeader}>
        <View style={styles.loadLabelRow}>
          <Ionicons name="speedometer-outline" size={15} color={levelColor} />
          <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '600' }}>
            {DAY_LOAD_LABELS[load.level]}
          </Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
          {Math.round(load.ratio * 100)}% окна
        </Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.track, borderRadius: radii.full, overflow: 'hidden', marginTop: spacing.sm }}>
        <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: levelColor, borderRadius: radii.full }} />
      </View>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: spacing.xs + 2 }}>
        Занятия {formatDurationMinutes(load.scheduledMinutes)} · задачи {formatDurationMinutes(load.taskMinutes)} · доступно{' '}
        {formatDurationMinutes(load.capacityMinutes)}
      </Text>
      {load.level === 'overload' && onPress ? (
        <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600', marginTop: spacing.xs + 2 }}>
          Перепланировать день →
        </Text>
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Загруженность дня: ${DAY_LOAD_LABELS[load.level]}`} onPress={onPress}>
        {content}
      </Pressable>
    );
  }
  return content;
}

/* ---------------------------------- StatTile ---------------------------------- */

export interface StatTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  color: string;
  testID?: string;
}

export function StatTile({ icon, value, label, color, testID }: StatTileProps) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.statTile,
        { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radii.lg, padding: spacing.md + 2 },
      ]}
    >
      <View style={[styles.statIcon, { backgroundColor: `${color}1F` }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSizes.xl, fontWeight: '700', marginTop: spacing.sm }}>
        {value}
      </Text>
      <Text numberOfLines={2} style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

/* ---------------------------------- TimerMiniCard ---------------------------------- */

export interface TimerMiniCardProps {
  phase: 'work' | 'break';
  remainingLabel: string;
  elapsedLabel: string;
  taskTitle: string | null;
  onPress: () => void;
  testID?: string;
}

export function TimerMiniCard({ phase, remainingLabel, elapsedLabel, taskTitle, onPress, testID }: TimerMiniCardProps) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  const tint = phase === 'work' ? colors.primary : colors.success;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Идёт сессия фокуса, осталось ${remainingLabel}. Открыть таймер.`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.timerMini,
        {
          backgroundColor: colors.surface,
          borderColor: tint,
          borderRadius: radii.lg,
          padding: spacing.lg,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={[styles.timerPulse, { backgroundColor: tint }]} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '700' }}>
          {phase === 'work' ? 'Идёт фокус-сессия' : 'Перерыв'}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 1 }}>
          {taskTitle ?? 'Без задачи'} · прошло {elapsedLabel}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: tint, fontSize: fontSizes.xl, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {remainingLabel}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>открыть</Text>
      </View>
    </Pressable>
  );
}

/** Форматирование оставшегося времени фазы. */
export function formatRemaining(ms: number | null): string {
  if (ms == null) return '∞';
  return formatSecondsClock(Math.ceil(ms / 1000));
}

const styles = StyleSheet.create({
  loadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loadLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statTile: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
  },
  timerPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
