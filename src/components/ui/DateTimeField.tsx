/**
 * Поле выбора даты и времени: триггер + нижний лист с мини-календарём
 * и степперами часов/минут. Без сторонних зависимостей, полностью офлайн.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MONTH_NOMINATIVE,
  WEEKDAY_SHORT,
  addDays,
  formatDateFull,
  formatTime,
  monthGridDays,
  isSameDay,
  startOfDay,
  startOfMonth,
} from '../../core/time';
import { useTheme, useSettings } from '../../state/AppContexts';
import { BottomSheet } from './overlays';
import { NumberStepper } from './inputs';

export interface DateTimeFieldProps {
  label?: string;
  /** Выбранная метка времени или null. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** date — только день; datetime — день и время. */
  mode?: 'date' | 'datetime';
  placeholder?: string;
  allowClear?: boolean;
  error?: string | null;
  minDate?: number;
  testID?: string;
}

export function DateTimeField({
  label,
  value,
  onChange,
  mode = 'datetime',
  placeholder = 'Выбрать дату',
  allowClear = true,
  error,
  minDate,
  testID,
}: DateTimeFieldProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number>(() => value ?? Date.now() + 3_600_000);
  const [viewMonth, setViewMonth] = useState<number>(() => startOfMonth(value ?? Date.now()));

  const openSheet = () => {
    const base = value ?? defaultFutureTs(minDate);
    setDraft(base);
    setViewMonth(startOfMonth(base));
    setOpen(true);
  };

  const displayText = useMemo(() => {
    if (value == null) return placeholder;
    return mode === 'datetime' ? `${formatDateFull(value)}, ${formatTime(value)}` : formatDateFull(value);
  }, [value, mode, placeholder]);

  const grid = useMemo(() => monthGridDays(viewMonth, settings.weekStart), [viewMonth, settings.weekStart]);
  const weekdayLabels = useMemo(() => {
    const labels = [...WEEKDAY_SHORT];
    return settings.weekStart === 1 ? [...labels.slice(1), labels[0]!] : labels;
  }, [settings.weekStart]);

  const draftDate = new Date(draft);
  const hour = draftDate.getHours();
  const minute = draftDate.getMinutes();

  const setHourMinute = (h: number, m: number) => {
    const d = new Date(draft);
    d.setHours(h, m, 0, 0);
    setDraft(d.getTime());
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? (
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: 6 }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${displayText}` : displayText}
        onPress={openSheet}
        style={[
          styles.trigger,
          {
            backgroundColor: colors.surfaceAlt,
            borderRadius: radii.md,
            borderColor: error ? colors.danger : colors.border,
            paddingHorizontal: spacing.md + 2,
          },
        ]}
      >
        <Ionicons name={mode === 'datetime' ? 'time-outline' : 'calendar-outline'} size={17} color={colors.textSecondary} />
        <Text style={{ color: value != null ? colors.text : colors.textMuted, fontSize: fontSizes.md, flex: 1 }} numberOfLines={1}>
          {displayText}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>
      {error ? <Text style={{ color: colors.danger, fontSize: fontSizes.xs + 1, marginTop: 4 }}>{error}</Text> : null}

      <BottomSheet visible={open} title={label ?? 'Дата и время'} onClose={() => setOpen(false)} testID={testID ? `${testID}-sheet` : undefined}>
        <ScrollView bounces={false} style={{ maxHeight: 520 }}>
          {/* Навигация по месяцам */}
          <View style={styles.monthNav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Предыдущий месяц"
              onPress={() => setViewMonth(startOfMonth(addDays(viewMonth, -1)))}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>
              {MONTH_NOMINATIVE[new Date(viewMonth).getMonth()]} {new Date(viewMonth).getFullYear()}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Следующий месяц"
              onPress={() => setViewMonth(startOfMonth(addDays(startOfMonth(viewMonth), 32)))}
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </Pressable>
          </View>

          {/* Заголовки дней недели */}
          <View style={styles.weekHeader}>
            {weekdayLabels.map((wd, i) => (
              <Text
                key={`${wd}-${i}`}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  color: i >= 5 && settings.weekStart === 1 ? colors.primary : colors.textMuted,
                  fontSize: fontSizes.xs,
                  fontWeight: '600',
                }}
              >
                {wd}
              </Text>
            ))}
          </View>

          {/* Сетка дней */}
          <View style={styles.grid}>
            {grid.map((day) => {
              const inMonth = new Date(day).getMonth() === new Date(viewMonth).getMonth();
              const selected = isSameDay(day, draft);
              const isToday = isSameDay(day, Date.now());
              const disabled = minDate != null && day < startOfDay(minDate) && !isSameDay(day, minDate);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityLabel={formatDateFull(day)}
                  accessibilityState={{ selected, disabled: !!disabled }}
                  disabled={disabled}
                  onPress={() => {
                    const d = new Date(draft);
                    const nd = new Date(day);
                    nd.setHours(d.getHours(), d.getMinutes(), 0, 0);
                    setDraft(nd.getTime());
                  }}
                  style={styles.gridCell}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      selected && { backgroundColor: colors.primary },
                      !selected && isToday && { borderWidth: 1, borderColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={{
                        color: selected ? colors.onPrimary : !inMonth ? colors.textMuted : disabled ? colors.textMuted : colors.text,
                        fontSize: fontSizes.sm,
                        fontWeight: isToday || selected ? '700' : '500',
                        opacity: disabled ? 0.4 : 1,
                      }}
                    >
                      {new Date(day).getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {mode === 'datetime' ? (
            <View style={{ marginTop: spacing.md }}>
              <NumberStepper
                label="Час"
                value={hour}
                min={0}
                max={23}
                step={1}
                onChange={(h) => setHourMinute(h, minute)}
                testID={`${testID ?? 'dt'}-hour`}
              />
              <NumberStepper
                label="Минуты"
                value={minute}
                min={0}
                max={55}
                step={5}
                onChange={(m) => setHourMinute(hour, m)}
                testID={`${testID ?? 'dt'}-minute`}
              />
            </View>
          ) : null}

          <View style={styles.sheetActions}>
            {allowClear ? (
              <Pressable
                accessibilityRole="button"
                testID={testID ? `${testID}-clear` : undefined}
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
                hitSlop={8}
              >
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, fontWeight: '600' }}>Сбросить</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              testID={testID ? `${testID}-confirm` : undefined}
              onPress={() => {
                const result = mode === 'date' ? (() => {
                  const d = new Date(draft);
                  d.setHours(23, 59, 0, 0);
                  return d.getTime();
                })() : draft;
                onChange(result);
                setOpen(false);
              }}
              style={[styles.confirmButton, { backgroundColor: colors.primary, borderRadius: radii.md }]}
            >
              <Text style={{ color: colors.onPrimary, fontSize: fontSizes.sm, fontWeight: '700' }}>Выбрать</Text>
            </Pressable>
          </View>
          <View style={{ height: 8 }} />
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function defaultFutureTs(minDate?: number): number {
  const base = minDate != null && minDate > Date.now() ? minDate : Date.now();
  const d = new Date(base + 3_600_000);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    borderWidth: 1,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  weekHeader: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 3,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  confirmButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
});
