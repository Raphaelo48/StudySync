/**
 * Поле выбора времени суток (минуты от полуночи): триггер «07:30» и нижний лист
 * со степперами часов и минут. Используется для утренней сводки и учебного окна.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/AppContexts';
import { BottomSheet } from './overlays';
import { NumberStepper } from './inputs';

export function formatMinutesOfDay(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface TimeOfDayFieldProps {
  label: string;
  /** Минуты от полуночи. */
  value: number;
  onChange: (minutes: number) => void;
  minuteStep?: number;
  /** Разрешить 24:00 (конец суток) — для окончания интервала. */
  allowEndOfDay?: boolean;
  description?: string;
  testID?: string;
}

export function TimeOfDayField({
  label,
  value,
  onChange,
  minuteStep = 5,
  allowEndOfDay = false,
  description,
  testID,
}: TimeOfDayFieldProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(Math.floor(value / 60));
  const [minute, setMinute] = useState(value % 60);

  const openSheet = () => {
    setHour(Math.floor(value / 60));
    setMinute(value % 60);
    setOpen(true);
  };
  const maxHour = allowEndOfDay ? 24 : 23;
  const draft = Math.min(hour * 60 + (hour === 24 ? 0 : minute), allowEndOfDay ? 1440 : 1439);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatMinutesOfDay(value)}`}
        onPress={openSheet}
        style={styles.row}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: fontSizes.md }}>{label}</Text>
          {description ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: 2 }}>{description}</Text>
          ) : null}
        </View>
        <View
          style={[
            styles.chip,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radii.md },
          ]}
        >
          <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
          <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
            {value === 1440 ? '24:00' : formatMinutesOfDay(value)}
          </Text>
        </View>
      </Pressable>

      <BottomSheet visible={open} title={label} onClose={() => setOpen(false)} testID={testID ? `${testID}-sheet` : undefined}>
        <Text style={[styles.preview, { color: colors.text }]}>
          {draft === 1440 ? '24:00' : formatMinutesOfDay(draft)}
        </Text>
        <NumberStepper label="Час" value={hour} min={0} max={maxHour} step={1} onChange={setHour} testID={`${testID ?? 'tod'}-hour`} />
        {hour !== 24 ? (
          <NumberStepper
            label="Минуты"
            value={minute}
            min={0}
            max={60 - minuteStep}
            step={minuteStep}
            onChange={setMinute}
            testID={`${testID ?? 'tod'}-minute`}
          />
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            testID={testID ? `${testID}-confirm` : undefined}
            onPress={() => {
              onChange(draft);
              setOpen(false);
            }}
            style={[styles.confirm, { backgroundColor: colors.primary, borderRadius: radii.md }]}
          >
            <Text style={{ color: colors.onPrimary, fontSize: fontSizes.sm, fontWeight: '700' }}>Готово</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  preview: {
    fontSize: 40,
    fontWeight: '700',
    textAlign: 'center',
    marginVertical: 12,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    marginBottom: 8,
  },
  confirm: {
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
});
