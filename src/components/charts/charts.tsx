/**
 * Графики аналитики на react-native-svg и обычных View.
 * Собственная реализация вместо тяжёлых chart-библиотек: меньше зависимостей,
 * полный контроль стиля, гарантированная совместимость с Expo SDK 57.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '../../state/AppContexts';
import { WEEKDAY_SHORT } from '../../core/time';

/* ---------------------------------- BarChart ---------------------------------- */

export interface BarDatum {
  label: string;
  value: number;
  /** Вторая серия (например, выполненные задачи) — рисуется точкой/линией поверх. */
  secondary?: number;
}

export interface BarChartProps {
  data: BarDatum[];
  height?: number;
  valueSuffix?: string;
  testID?: string;
}

export function BarChart({ data, height = 120, valueSuffix = '', testID }: BarChartProps) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View testID={testID}>
      <View style={[styles.barRow, { height }]}>
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * (height - 22));
          return (
            <View key={`${d.label}-${i}`} style={styles.barCell}>
              <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', width: '100%' }}>
                {d.value > 0 ? (
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs - 1, marginBottom: 2 }}>
                    {d.value}
                    {valueSuffix}
                  </Text>
                ) : null}
                <View
                  style={{
                    width: '62%',
                    maxWidth: 26,
                    height: Math.max(3, h),
                    borderRadius: radii.sm,
                    backgroundColor: d.value > 0 ? colors.primary : colors.track,
                  }}
                />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.barLabels}>
        {data.map((d, i) => (
          <Text key={`l-${d.label}-${i}`} style={{ flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: fontSizes.xs - 1 }}>
            {d.label}
          </Text>
        ))}
      </View>
      <View style={{ height: spacing.xs }} />
    </View>
  );
}

/* ---------------------------------- DonutChart ---------------------------------- */

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
  testID?: string;
}

export function DonutChart({ slices, size = 140, centerLabel, centerValue, testID }: DonutChartProps) {
  const { colors, fontSizes } = useTheme();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const stroke = 16;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  let offsetAccum = 0;
  return (
    <View testID={testID} style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={stroke} fill="none" />
          {total > 0 &&
            slices.map((slice, i) => {
              const fraction = slice.value / total;
              const dash = fraction * circumference;
              const el = (
                <Circle
                  key={`${slice.label}-${i}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={slice.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offsetAccum}
                  strokeLinecap="butt"
                />
              );
              offsetAccum += dash;
              return el;
            })}
        </G>
      </Svg>
      {centerValue || centerLabel ? (
        <View style={styles.donutCenter}>
          {centerValue ? (
            <Text style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700' }}>{centerValue}</Text>
          ) : null}
          {centerLabel ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>{centerLabel}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------- Legend ---------------------------------- */

export function ChartLegend({ slices, testID }: { slices: DonutSlice[]; testID?: string }) {
  const { colors, fontSizes, spacing } = useTheme();
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      {slices.map((s) => (
        <View key={s.label} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: s.color }]} />
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, flex: 1 }} numberOfLines={1}>
            {s.label}
          </Text>
          <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '600' }}>
            {total > 0 ? `${Math.round((s.value / total) * 100)}%` : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------- HBar (план/факт) ---------------------------------- */

export interface HBarProps {
  label: string;
  value: number;
  max: number;
  color: string;
  valueLabel: string;
  testID?: string;
}

export function HBar({ label, value, max, color, valueLabel, testID }: HBarProps) {
  const { colors, fontSizes, radii } = useTheme();
  const fraction = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View testID={testID} style={{ marginBottom: 10 }}>
      <View style={styles.hbarHeader}>
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '600' }}>{valueLabel}</Text>
      </View>
      <View style={{ height: 10, backgroundColor: colors.track, borderRadius: radii.full, overflow: 'hidden' }}>
        <View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: color, borderRadius: radii.full }} />
      </View>
    </View>
  );
}

/** Подпись дня недели для дневной динамики. */
export function weekdayLabelShort(dayTs: number): string {
  return WEEKDAY_SHORT[new Date(dayTs).getDay()]!;
}

const styles = StyleSheet.create({
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  barCell: {
    flex: 1,
    height: '100%',
  },
  barLabels: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  donutCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  hbarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
});
