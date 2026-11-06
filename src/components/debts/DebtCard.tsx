/**
 * Карточка долга: предмет, что сдать, попытка, когда и где, кому, чек-лист.
 * compact — для блока на главной (без кнопок действий).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/AppContexts';
import { Badge } from '../ui/primitives';
import { formatDateWithWeekday, formatTime } from '../../core/time';
import { DEBT_KIND_LABELS, DEBT_STATUS_LABELS, type DebtWithSubject } from '../../models/types';
import { attemptLabel, checklistProgress, retakeWhenLabel } from '../../logic/debts';

export interface DebtCardProps {
  debt: DebtWithSubject;
  onPress?: () => void;
  onPassed?: () => void;
  onFailed?: () => void;
  onToggleItem?: (index: number) => void;
  compact?: boolean;
  now?: number;
  testID?: string;
}

export function DebtCard({ debt, onPress, onPassed, onFailed, onToggleItem, compact = false, now = Date.now(), testID }: DebtCardProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const accent = debt.subject?.color ?? colors.primary;
  const attempt = attemptLabel(debt.attempt);
  const progress = checklistProgress(debt.checklist);
  const passed = debt.status === 'passed';
  const overdue = debt.retakeAt != null && debt.retakeAt < now && !passed;
  const whenColor = overdue ? colors.danger : colors.textSecondary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Долг: ${debt.subject?.name ?? ''} ${debt.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSoft,
          borderRadius: radii.lg,
          padding: spacing.md + 2,
          marginBottom: spacing.sm,
          opacity: pressed ? 0.9 : passed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, fontWeight: '600' }} numberOfLines={1}>
          {debt.subject?.name ?? 'Без предмета'}
        </Text>
        <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }} numberOfLines={2}>
          {debt.title}
        </Text>

        {debt.retakeAt != null ? (
          <View style={styles.line}>
            <Ionicons name="calendar-outline" size={13} color={whenColor} />
            <Text style={{ color: whenColor, fontSize: fontSizes.sm, flexShrink: 1 }} numberOfLines={1}>
              {formatDateWithWeekday(debt.retakeAt)}, {formatTime(debt.retakeAt)}
              {passed ? '' : ` · ${retakeWhenLabel(debt.retakeAt, now)}`}
            </Text>
          </View>
        ) : !passed ? (
          <View style={styles.line}>
            <Ionicons name="help-circle-outline" size={13} color={colors.warning} />
            <Text style={{ color: colors.warning, fontSize: fontSizes.sm }}>Дата отработки не назначена</Text>
          </View>
        ) : null}

        {debt.location || debt.teacher ? (
          <View style={[styles.line, { gap: 12 }]}>
            {debt.location ? (
              <View style={styles.item}>
                <Ionicons name="location-outline" size={13} color={colors.textMuted} />
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }}>{debt.location}</Text>
              </View>
            ) : null}
            {debt.teacher ? (
              <View style={[styles.item, styles.fill]}>
                <Ionicons name="person-outline" size={13} color={colors.textMuted} />
                <Text style={[styles.fill, { color: colors.textSecondary, fontSize: fontSizes.sm }]} numberOfLines={1}>
                  {debt.teacher}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.line, { flexWrap: 'wrap', marginTop: 4 }]}>
          <Badge label={DEBT_KIND_LABELS[debt.kind]} color={accent} />
          {attempt ? <Badge label={attempt} color={colors.warning} icon="refresh" /> : null}
          {passed ? (
            <Badge label={DEBT_STATUS_LABELS.passed} color={colors.success} icon="checkmark" />
          ) : progress.total > 0 ? (
            <Badge
              label={`Готово ${progress.done}/${progress.total}`}
              color={progress.done === progress.total ? colors.success : colors.textMuted}
              icon="list-outline"
            />
          ) : null}
        </View>

        {!compact && !passed && debt.checklist.length > 0 ? (
          <View style={{ marginTop: spacing.sm, gap: 2 }}>
            {debt.checklist.map((it, i) => (
              <Pressable
                key={`${i}-${it.text}`}
                testID={testID ? `${testID}-item-${i}` : undefined}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: it.done }}
                accessibilityLabel={it.text}
                onPress={() => onToggleItem?.(i)}
                hitSlop={4}
                style={styles.check}
              >
                <Ionicons
                  name={it.done ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={it.done ? colors.success : colors.textMuted}
                />
                <Text
                  style={{
                    color: it.done ? colors.textMuted : colors.text,
                    fontSize: fontSizes.sm,
                    textDecorationLine: it.done ? 'line-through' : 'none',
                    flex: 1,
                  }}
                >
                  {it.text}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!compact && !passed && (onPassed || onFailed) ? (
          <View style={[styles.actions, { marginTop: spacing.sm }]}>
            {onPassed ? (
              <Pressable
                testID={testID ? `${testID}-passed` : undefined}
                accessibilityRole="button"
                onPress={onPassed}
                style={[styles.action, { backgroundColor: colors.successSoft, borderRadius: radii.md }]}
              >
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={{ color: colors.success, fontSize: fontSizes.sm, fontWeight: '700' }}>Сдал</Text>
              </Pressable>
            ) : null}
            {onFailed ? (
              <Pressable
                testID={testID ? `${testID}-failed` : undefined}
                accessibilityRole="button"
                accessibilityHint="Номер попытки увеличится, дату нужно будет назначить заново"
                onPress={onFailed}
                style={[styles.action, { backgroundColor: colors.dangerSoft, borderRadius: radii.md }]}
              >
                <Ionicons name="close-circle" size={16} color={colors.danger} />
                <Text style={{ color: colors.danger, fontSize: fontSizes.sm, fontWeight: '700' }}>Не сдал</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, borderWidth: 1 },
  accent: { width: 4, borderRadius: 4, alignSelf: 'stretch' },
  body: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  fill: { flex: 1, minWidth: 0 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
});
