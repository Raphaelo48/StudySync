/**
 * Все конспекты: фильтр по предмету и «только важное к экзамену».
 * Удобно пролистать перед зачётом или экзаменом.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Card, Chip, EmptyState, Spinner } from '../src/components/ui/primitives';
import { useDataVersion, useDatabase, useTheme } from '../src/state/AppContexts';
import type { LessonNote, Subject } from '../src/models/types';
import { formatDateWithWeekday, formatTime } from '../src/core/time';
import { photoUri } from '../src/logic/lessonPhotos';

export default function NotesScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const router = useRouter();
  const { version } = useDataVersion();
  const [notes, setNotes] = useState<LessonNote[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [onlyImportant, setOnlyImportant] = useState(false);

  const load = useCallback(async () => {
    const [n, s] = await Promise.all([db.lessonNotes.listAll(), db.subjects.list(true)]);
    setNotes(n);
    setSubjects(s);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const subjectsWithNotes = useMemo(() => {
    const ids = new Set((notes ?? []).map((n) => n.subjectId).filter((x): x is string => x != null));
    return subjects.filter((s) => ids.has(s.id));
  }, [notes, subjects]);

  if (notes == null) {
    return (
      <Screen testID="notes-screen">
        <ScreenHeader title="Конспекты" />
        <Spinner />
      </Screen>
    );
  }

  const visible = notes.filter((n) => (!subjectFilter || n.subjectId === subjectFilter) && (!onlyImportant || n.important));

  return (
    <Screen testID="notes-screen">
      <ScreenHeader title="Конспекты" subtitle={`${notes.length} к парам`} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {notes.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={{ marginBottom: spacing.md }}>
            <Chip label="★ Важное" selected={onlyImportant} onPress={() => setOnlyImportant((v) => !v)} testID="notes-important" />
            <Chip label="Все предметы" selected={subjectFilter == null} onPress={() => setSubjectFilter(null)} />
            {subjectsWithNotes.map((s) => (
              <Chip key={s.id} label={s.name} color={s.color} selected={subjectFilter === s.id} onPress={() => setSubjectFilter(s.id)} />
            ))}
          </ScrollView>
        ) : null}

        {visible.length === 0 ? (
          <Card>
            <EmptyState
              icon="document-text-outline"
              title={notes.length === 0 ? 'Конспектов пока нет' : 'Ничего не найдено'}
              subtitle={
                notes.length === 0
                  ? 'Откройте пару в расписании и нажмите на значок конспекта — можно сфотографировать доску и записать главное'
                  : 'Попробуйте другой фильтр'
              }
            />
          </Card>
        ) : (
          visible.map((n) => {
            const subject = n.subjectId ? subjectById.get(n.subjectId) : undefined;
            return (
              <Pressable
                key={n.id}
                testID={`note-${n.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Конспект: ${n.lessonTitle}, ${formatDateWithWeekday(n.lessonStartAt)}`}
                onPress={() =>
                  router.push({
                    pathname: '/lesson-note',
                    params: { key: n.lessonKey, title: n.lessonTitle, startAt: String(n.lessonStartAt), subjectId: n.subjectId ?? '' },
                  })
                }
                style={({ pressed }) => [
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSoft,
                    borderRadius: radii.lg,
                    padding: spacing.md + 2,
                    marginBottom: spacing.sm,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}
              >
                <View style={[styles.accent, { backgroundColor: subject?.color ?? colors.primary }]} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.titleRow}>
                    <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {n.lessonTitle}
                    </Text>
                    {n.important ? <Ionicons name="star" size={15} color={colors.warning} /> : null}
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                    {formatDateWithWeekday(n.lessonStartAt)}, {formatTime(n.lessonStartAt)}
                    {n.photos.length > 0 ? ` · ${n.photos.length} фото` : ''}
                  </Text>
                  {n.text.trim() ? (
                    <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }} numberOfLines={3}>
                      {n.text.trim()}
                    </Text>
                  ) : null}
                  {n.photos.length > 0 ? (
                    <View style={styles.thumbs}>
                      {n.photos.slice(0, 4).map((p) => (
                        <Image key={p} source={{ uri: photoUri(p) }} style={[styles.thumb, { borderRadius: radii.sm }]} />
                      ))}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: 8, paddingRight: 8 },
  card: { flexDirection: 'row', gap: 12, borderWidth: 1 },
  accent: { width: 4, borderRadius: 4, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  thumbs: { flexDirection: 'row', gap: 6, marginTop: 6 },
  thumb: { width: 56, height: 56 },
});
