/**
 * Карточка события расписания (занятие / личное / учебный блок).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatTime } from '../../core/time';
import type { EventWithRelations } from '../../models/types';
import { EVENT_KIND_LABELS } from '../../models/types';
import { useTheme } from '../../state/AppContexts';
import { Badge } from '../ui/primitives';
import { describeEvent } from '../../logic/eventDisplay';

export interface EventCardProps {
  event: EventWithRelations;
  hasConflict?: boolean;
  onPress?: () => void;
  testID?: string;
  compact?: boolean;
  /** Есть ли конспект к этой паре (значок заполнен). */
  hasNote?: boolean;
  /** Открыть конспект; если не задано — кнопки конспекта нет. */
  onNotePress?: () => void;
}

export function EventCard({ event, hasConflict = false, onPress, testID, compact = false, hasNote = false, onNotePress }: EventCardProps) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  const accent = event.subject?.color ?? (event.kind === 'personal' ? colors.info : colors.primary);
  const icon = event.kind === 'lesson' ? 'school-outline' : event.kind === 'study' ? 'timer-outline' : 'person-outline';
  const info = describeEvent(event);
  const isLesson = event.kind === 'lesson';
  const a11y = [
    info.kindLabel ?? EVENT_KIND_LABELS[event.kind],
    event.title,
    `${formatTime(event.startAt)}–${formatTime(event.endAt)}`,
    info.location ? `аудитория ${info.location}` : null,
    info.teacher ? `преподаватель ${info.teacher}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: hasConflict ? colors.danger : colors.borderSoft,
          borderWidth: hasConflict ? 1.5 : StyleSheet.hairlineWidth,
          borderRadius: radii.md + 2,
          paddingVertical: compact ? spacing.sm + 2 : spacing.md + 2,
          paddingHorizontal: spacing.md + 2,
          marginBottom: spacing.sm,
          opacity: pressed && onPress ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.accent, { backgroundColor: accent, borderRadius: radii.full }]} />
      <View style={styles.timeCol}>
        <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '700' }}>{formatTime(event.startAt)}</Text>
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>{formatTime(event.endAt)}</Text>
      </View>
      <View style={styles.body}>
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>
          {event.title}
        </Text>
        {isLesson ? (
          // Занятие: под названием — аудитория и преподаватель, без повтора названия.
          info.location || info.teacher ? (
            <View style={[styles.metaRow, styles.lessonMeta]}>
              {info.location ? (
                <View style={styles.metaItem}>
                  <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                  <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }} numberOfLines={1}>
                    {info.location}
                  </Text>
                </View>
              ) : null}
              {info.teacher ? (
                <View style={[styles.metaItem, styles.fill]}>
                  <Ionicons name="person-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.fill, { color: colors.textSecondary, fontSize: fontSizes.sm }]} numberOfLines={1}>
                    {info.teacher}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null
        ) : (
          <View style={styles.metaRow}>
            <Ionicons name={icon} size={12} color={colors.textMuted} />
            <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }} numberOfLines={1}>
              {[EVENT_KIND_LABELS[event.kind], info.subjectName, info.location, event.seriesId ? 'повторяется' : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        )}
        {isLesson && (info.subjectName || event.seriesId) ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }} numberOfLines={1}>
            {[info.subjectName, event.seriesId ? 'повторяется' : null].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {hasConflict ? (
          <View style={styles.metaRow}>
            <Ionicons name="warning" size={12} color={colors.danger} />
            <Text style={{ color: colors.danger, fontSize: fontSizes.sm }}>Пересечение с другим событием</Text>
          </View>
        ) : null}
        {info.kindLabel || info.isReplacement ? (
          <View style={styles.metaRow}>
            {info.kindLabel ? <Badge label={info.kindLabel} color={accent} /> : null}
            {info.isReplacement ? <Badge label="замена" color={colors.warning} icon="swap-horizontal" /> : null}
          </View>
        ) : null}
      </View>
      {onNotePress ? (
        <Pressable
          testID={testID ? `${testID}-note` : undefined}
          accessibilityRole="button"
          accessibilityLabel={hasNote ? 'Открыть конспект пары' : 'Добавить конспект к паре'}
          onPress={onNotePress}
          hitSlop={10}
          style={[styles.noteButton, { backgroundColor: hasNote ? colors.primarySoft : 'transparent', borderRadius: 10 }]}
        >
          <Ionicons name={hasNote ? 'document-text' : 'document-text-outline'} size={19} color={hasNote ? colors.primary : colors.textMuted} />
        </Pressable>
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  accent: {
    width: 4,
    alignSelf: 'stretch',
    minHeight: 28,
  },
  timeCol: {
    width: 46,
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    gap: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  noteButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonMeta: {
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  // Преподаватель занимает оставшуюся ширину и обрезается многоточием.
  fill: {
    flex: 1,
    minWidth: 0,
  },
});
