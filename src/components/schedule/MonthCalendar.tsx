/**
 * Месячная сетка с переключением месяцев и точками на днях, где есть занятия.
 * Используется при просмотре расписания группы, преподавателя или аудитории.
 */
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from '../ui/primitives';
import { useTheme } from '../../state/AppContexts';
import {
  MONTH_NOMINATIVE,
  WEEKDAY_SHORT,
  addDays,
  formatDateFull,
  isSameDay,
  isSameMonth,
  isToday,
  monthGridDays,
  startOfMonth,
} from '../../core/time';

interface Props {
  selectedDay: number;
  weekStart: 0 | 1;
  /** Сколько занятий в каждом дне (ключ — начало дня). */
  counts: Map<number, number>;
  onSelectDay: (day: number) => void;
  testID?: string;
}

export function shiftMonth(day: number, dir: -1 | 1): number {
  return startOfMonth(addDays(startOfMonth(day), dir > 0 ? 32 : -1));
}

export function MonthCalendar({ selectedDay, weekStart, counts, onSelectDay, testID }: Props) {
  const { colors, fontSizes } = useTheme();
  const grid = useMemo(() => monthGridDays(selectedDay, weekStart), [selectedDay, weekStart]);
  const weekdayLabels = useMemo(() => {
    const labels = [...WEEKDAY_SHORT];
    return weekStart === 1 ? [...labels.slice(1), labels[0]!] : labels;
  }, [weekStart]);
  const d = new Date(selectedDay);

  return (
    <View testID={testID}>
      <View style={styles.navRow}>
        <IconButton icon="chevron-back" accessibilityLabel="Предыдущий месяц" onPress={() => onSelectDay(shiftMonth(selectedDay, -1))} testID={testID ? `${testID}-prev` : undefined} />
        <Text testID={testID ? `${testID}-label` : undefined} style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', flex: 1, textAlign: 'center' }}>
          {MONTH_NOMINATIVE[d.getMonth()]} {d.getFullYear()}
        </Text>
        <IconButton icon="chevron-forward" accessibilityLabel="Следующий месяц" onPress={() => onSelectDay(shiftMonth(selectedDay, 1))} testID={testID ? `${testID}-next` : undefined} />
      </View>
      <View style={styles.weekHeaderRow}>
        {weekdayLabels.map((wd, i) => (
          <Text key={`${wd}-${i}`} style={{ flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: fontSizes.xs, fontWeight: '600' }}>
            {wd}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {grid.map((day) => {
          const inMonth = isSameMonth(day, selectedDay);
          const n = counts.get(day) ?? 0;
          const selected = isSameDay(day, selectedDay);
          const today = isToday(day);
          return (
            <Pressable
              key={day}
              testID={testID ? `${testID}-day-${day}` : undefined}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${formatDateFull(day)}, занятий: ${n}`}
              onPress={() => onSelectDay(day)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.circle,
                  selected && { backgroundColor: colors.primary },
                  !selected && today && { borderWidth: 1, borderColor: colors.primary },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.onPrimary : inMonth ? colors.text : colors.textMuted,
                    fontSize: fontSizes.sm,
                    fontWeight: today || selected || n > 0 ? '700' : '400',
                    opacity: inMonth ? 1 : 0.6,
                  }}
                >
                  {new Date(day).getDate()}
                </Text>
              </View>
              <View style={styles.dots}>
                {Array.from({ length: Math.min(n, 4) }, (_, i) => (
                  <View key={i} style={[styles.dot, { backgroundColor: colors.primary, opacity: inMonth ? 1 : 0.45 }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  weekHeaderRow: { flexDirection: 'row', marginBottom: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3, gap: 2 },
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 2, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
