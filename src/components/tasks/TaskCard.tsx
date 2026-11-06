/**
 * Карточка задачи — основной элемент списков.
 * Показывает статус, приоритет, предмет, дедлайн, план/факт времени,
 * быстрые действия (отметить выполнение, открыть фокус).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatDurationMinutes,
  relativeDayLabel,
  timeUntilLabel,
} from '../../core/time';
import { PRIORITY_LABELS, STATUS_LABELS, type TaskWithSubject } from '../../models/types';
import { priorityColor, statusColor } from '../../theme/tokens';
import { useTheme } from '../../state/AppContexts';
import { Badge } from '../ui/primitives';

export interface TaskCardProps {
  task: TaskWithSubject;
  now?: number;
  onPress?: () => void;
  onToggleDone?: () => void;
  onFocus?: () => void;
  compact?: boolean;
  testID?: string;
}

export function TaskCard({ task, now = Date.now(), onPress, onToggleDone, onFocus, compact = false, testID }: TaskCardProps) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  const done = task.status === 'done';
  const overdue = !done && task.deadlineAt != null && task.deadlineAt < now;
  const dueLabel = task.deadlineAt ? relativeDayLabel(task.deadlineAt, now) : null;
  const timeLeft = task.deadlineAt && !overdue ? timeUntilLabel(task.deadlineAt, now) : null;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`Задача ${task.title}, статус ${STATUS_LABELS[task.status]}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.borderSoft,
          borderRadius: radii.lg,
          padding: spacing.lg,
          opacity: pressed ? 0.85 : 1,
          marginBottom: spacing.sm + 2,
        },
      ]}
    >
      {/* Полоса приоритета */}
      <View style={[styles.priorityStripe, { backgroundColor: priorityColor(colors, task.priority), borderRadius: radii.full }]} />

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Pressable
            testID={testID ? `${testID}-toggle` : undefined}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={done ? 'Снять отметку выполнения' : 'Отметить выполненной'}
            hitSlop={8}
            onPress={onToggleDone}
          >
            <Ionicons
              name={done ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={done ? colors.success : colors.textMuted}
            />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text
              numberOfLines={2}
              style={{
                color: done ? colors.textMuted : colors.text,
                fontSize: fontSizes.md,
                fontWeight: '600',
                textDecorationLine: done ? 'line-through' : 'none',
              }}
            >
              {task.title}
            </Text>
            <View style={styles.metaRow}>
              {task.subject ? (
                <View style={styles.subjectRow}>
                  <View style={[styles.subjectDot, { backgroundColor: task.subject.color }]} />
                  <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }} numberOfLines={1}>
                    {task.subject.name}
                  </Text>
                </View>
              ) : null}
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                {formatDurationMinutes(task.plannedMinutes)}
              </Text>
              {task.actualMinutes > 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                  факт {formatDurationMinutes(task.actualMinutes)}
                </Text>
              ) : null}
            </View>
          </View>
          {!compact && onFocus && !done ? (
            <Pressable
              testID={testID ? `${testID}-focus` : undefined}
              accessibilityRole="button"
              accessibilityLabel="Начать фокус-сессию"
              hitSlop={8}
              onPress={onFocus}
              style={[styles.focusButton, { backgroundColor: colors.primarySoft, borderRadius: radii.full }]}
            >
              <Ionicons name="play" size={15} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.badgeRow}>
          <Badge label={STATUS_LABELS[task.status]} color={statusColor(colors, task.status)} />
          {task.priority === 3 ? (
            <Badge label={PRIORITY_LABELS[3] + ' приоритет'} color={colors.danger} icon="flag" />
          ) : null}
          {dueLabel ? (
            <Badge
              label={overdue ? `Просрочено · ${dueLabel}` : `Срок · ${dueLabel}${timeLeft ? ` · через ${timeLeft}` : ''}`}
              color={overdue ? colors.danger : colors.textSecondary}
              icon={overdue ? 'alert-circle' : 'calendar-outline'}
            />
          ) : null}
          {task.deferCount > 0 ? (
            <Badge label={`Переносов: ${task.deferCount}`} color={colors.textMuted} icon="swap-horizontal" />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  priorityStripe: {
    width: 4,
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  titleWrap: {
    flex: 1,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 140,
  },
  subjectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  focusButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
