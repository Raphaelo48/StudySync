/**
 * Управление учебными предметами: список с использованием в данных,
 * создание, редактирование, архивация и удаление с явными последствиями.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Badge, Card, EmptyState, Spinner } from '../src/components/ui/primitives';
import { useDataVersion, useDatabase, useTheme } from '../src/state/AppContexts';
import type { Subject } from '../src/models/types';
import { pluralRu } from '../src/core/time';

interface SubjectWithUsage extends Subject {
  usage: { tasks: number; events: number; sessions: number };
}

export default function SubjectsScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const router = useRouter();
  const { version } = useDataVersion();
  const [items, setItems] = useState<SubjectWithUsage[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const subjects = await db.subjects.list(true);
    const withUsage = await Promise.all(
      subjects.map(async (s) => {
        const rel = await db.subjects.countRelations(s.id);
        return { ...s, usage: { tasks: rel.tasks, events: rel.events, sessions: rel.sessions } };
      })
    );
    setItems(withUsage);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  if (items == null) {
    return (
      <Screen testID="subjects-screen">
        <ScreenHeader title="Предметы" />
        <Spinner testID="subjects-loading" />
      </Screen>
    );
  }

  const visible = showArchived ? items : items.filter((s) => !s.archived);

  return (
    <Screen testID="subjects-screen">
      <ScreenHeader
        title="Предметы"
        testID="subjects-header"
        right={
          <Pressable
            testID="subjects-add"
            accessibilityRole="button"
            accessibilityLabel="Добавить предмет"
            hitSlop={8}
            onPress={() => router.push('/subject/edit')}
          >
            <Ionicons name="add-circle" size={26} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {visible.length === 0 ? (
          <Card>
            <EmptyState
              testID="subjects-empty"
              icon="school-outline"
              title={showArchived ? 'Предметов нет' : 'Активных предметов нет'}
              subtitle="Предметы помогают группировать задачи, занятия и статистику по цветам"
              actionLabel="Добавить предмет"
              onAction={() => router.push('/subject/edit')}
            />
          </Card>
        ) : (
          visible.map((s) => (
            <Pressable
              key={s.id}
              testID={`subject-row-${s.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Предмет ${s.name}`}
              onPress={() => router.push({ pathname: '/subject/edit', params: { subjectId: s.id } })}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSoft,
                  borderRadius: radii.lg,
                  padding: spacing.lg,
                  marginBottom: spacing.sm,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.colorDot, { backgroundColor: s.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: s.archived ? colors.textMuted : colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>
                  {s.name}
                </Text>
                <View style={styles.usageRow}>
                  {s.usage.tasks > 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                      {s.usage.tasks} {pluralRu(s.usage.tasks, 'задача', 'задачи', 'задач')}
                    </Text>
                  ) : null}
                  {s.usage.events > 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                      {s.usage.events} {pluralRu(s.usage.events, 'событие', 'события', 'событий')}
                    </Text>
                  ) : null}
                  {s.usage.sessions > 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                      {s.usage.sessions} {pluralRu(s.usage.sessions, 'сессия', 'сессии', 'сессий')}
                    </Text>
                  ) : null}
                  {s.usage.tasks + s.usage.events + s.usage.sessions === 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>ещё не используется</Text>
                  ) : null}
                </View>
              </View>
              {s.targetGrade ? <Badge label={`Цель: ${s.targetGrade}`} color={colors.primary} /> : null}
              {s.archived ? <Badge label="В архиве" color={colors.textMuted} /> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ))
        )}
        {items.some((s) => s.archived) ? (
          <Pressable
            accessibilityRole="button"
            testID="subjects-toggle-archived"
            onPress={() => setShowArchived((v) => !v)}
            style={{ alignSelf: 'center', padding: 12 }}
          >
            <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600' }}>
              {showArchived ? 'Скрыть архивные' : 'Показать архивные'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  usageRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 3,
    flexWrap: 'wrap',
  },
});
