/**
 * Задачи: поиск, фильтры (статус, предмет, срок), сортировка, список карточек,
 * быстрое добавление. Все данные — из SQLite.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { Button, Card, EmptyState, Spinner } from '../../src/components/ui/primitives';
import { Chip } from '../../src/components/ui/primitives';
import { BottomSheet } from '../../src/components/ui/overlays';
import { SelectField } from '../../src/components/ui/inputs';
import { TaskCard } from '../../src/components/tasks/TaskCard';
import { useDataVersion, useDatabase, useTheme, useToast } from '../../src/state/AppContexts';
import type { TaskFilter, TaskSort } from '../../src/db/repos/tasksRepo';
import type { Subject, TaskWithSubject } from '../../src/models/types';
import { pluralRu } from '../../src/core/time';
import { restoreTaskStatus, toggleTaskDone } from '../../src/logic/taskStatusService';

type QuickFilter = 'active' | 'today' | 'overdue' | 'done' | 'all';

const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: 'active', label: 'Активные' },
  { value: 'today', label: 'На сегодня' },
  { value: 'overdue', label: 'Просрочены' },
  { value: 'done', label: 'Выполнены' },
  { value: 'all', label: 'Все' },
];

const SORT_LABELS: Record<TaskSort, string> = {
  deadline: 'По дедлайну',
  priority: 'По приоритету',
  created: 'По дате создания',
  title: 'По названию',
  duration: 'По длительности',
};

export default function TasksScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const router = useRouter();
  const toast = useToast();
  const { version, bump } = useDataVersion();

  const [quick, setQuick] = useState<QuickFilter>('active');
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string | null | undefined>(undefined); // undefined = не задан
  const [dueFilter, setDueFilter] = useState<TaskFilter['due'] | undefined>(undefined);
  const [sort, setSort] = useState<TaskSort>('deadline');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tasks, setTasks] = useState<TaskWithSubject[] | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async () => {
    const now = Date.now();
    const filter: TaskFilter = {
      status: quick === 'done' ? 'done' : quick === 'all' ? 'all' : 'active',
      sort,
      search: search.trim() || undefined,
      subjectId: subjectFilter,
      due: quick === 'today' ? 'today' : quick === 'overdue' ? 'overdue' : dueFilter,
    };
    const [list, subs] = await Promise.all([db.tasks.list(filter, now), db.subjects.list()]);
    setTasks(list);
    setSubjects(subs);
  }, [db, quick, search, sort, subjectFilter, dueFilter]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const activeFilterCount =
    (subjectFilter !== undefined ? 1 : 0) + (dueFilter !== undefined && quick !== 'today' && quick !== 'overdue' ? 1 : 0);

  const toggleDone = useCallback(
    async (task: TaskWithSubject) => {
      try {
        const updated = await toggleTaskDone(db, task.id);
        if (updated?.status === 'done') {
          toast.success(`«${task.title}» выполнена`, {
            label: 'Отменить',
            onPress: () => {
              void restoreTaskStatus(db, task.id, task.status).then(() => {
                bump();
                void load();
              });
            },
          });
        }
        bump();
        await load();
      } catch (e) {
        toast.error('Не удалось обновить задачу');
      }
    },
    [db, toast, bump, load]
  );

  const subjectOptions = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
    [subjects]
  );

  const countsLabel = tasks ? `${tasks.length} ${pluralRu(tasks.length, 'задача', 'задачи', 'задач')}` : '';

  return (
    <Screen testID="tasks-screen">
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontSize: fontSizes.xxl, fontWeight: '700' }}>Задачи</Text>
            <Text testID="tasks-count" style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 2 }}>
              {countsLabel}
            </Text>
          </View>
          <Pressable
            testID="tasks-filters"
            accessibilityRole="button"
            accessibilityLabel={`Фильтры${activeFilterCount > 0 ? `, активных: ${activeFilterCount}` : ''}`}
            onPress={() => setFiltersOpen(true)}
            style={[styles.filterButton, { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderColor: colors.border }]}
          >
            <Ionicons name="options-outline" size={18} color={colors.text} />
            {activeFilterCount > 0 ? (
              <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                <Text style={{ color: colors.onPrimary, fontSize: 10, fontWeight: '700' }}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Поиск */}
        <View
          style={[
            styles.searchRow,
            { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderColor: colors.border, marginTop: spacing.md },
          ]}
        >
          <Ionicons name="search" size={17} color={colors.textMuted} />
          <TextInput
            testID="tasks-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск задач…"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Поиск задач"
            style={{ flex: 1, color: colors.text, fontSize: fontSizes.md, paddingVertical: 10 }}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Быстрые фильтры */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: spacing.md }}
        >
          {QUICK_FILTERS.map((f) => (
            <Chip
              key={f.value}
              label={f.label}
              selected={quick === f.value}
              onPress={() => setQuick(f.value)}
              testID={`tasks-quick-${f.value}`}
            />
          ))}
        </ScrollView>
      </View>

      {tasks == null ? (
        <Spinner testID="tasks-loading" />
      ) : tasks.length === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
          <EmptyState
            testID="tasks-empty"
            icon={search ? 'search-outline' : 'clipboard-outline'}
            title={search ? 'Ничего не найдено' : 'Задач пока нет'}
            subtitle={
              search
                ? 'Попробуйте изменить запрос или сбросить фильтры'
                : 'Добавьте первую задачу — она появится в расписании и статистике'
            }
            actionLabel={search ? 'Сбросить фильтры' : 'Добавить задачу'}
            onAction={
              search
                ? () => {
                    setSearch('');
                    setSubjectFilter(undefined);
                    setDueFilter(undefined);
                    setQuick('active');
                  }
                : () => router.push('/task/edit')
            }
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 110 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              testID={`task-card-${t.id}`}
              onPress={() => router.push(`/task/${t.id}`)}
              onToggleDone={() => void toggleDone(t)}
              onFocus={() => router.push({ pathname: '/focus', params: { taskId: t.id } })}
            />
          ))}
        </ScrollView>
      )}

      {/* Фильтры и сортировка */}
      <BottomSheet visible={filtersOpen} title="Фильтры и сортировка" onClose={() => setFiltersOpen(false)}>
        <ScrollView bounces={false} style={{ maxHeight: 460 }}>
          <SelectField
            label="Предмет"
            options={subjectOptions}
            value={subjectFilter ?? null}
            onChange={(v) => setSubjectFilter(v ?? null)}
            allowClear
            clearLabel="Все предметы"
            testID="tasks-filter-subject"
          />
          <SelectField
            label="Срок"
            options={[
              { value: 'today', label: 'Сегодня' },
              { value: 'week', label: 'Ближайшие 7 дней' },
              { value: 'overdue', label: 'Просроченные' },
              { value: 'nodate', label: 'Без срока' },
            ]}
            value={dueFilter ?? null}
            onChange={(v) => setDueFilter((v as TaskFilter['due']) ?? undefined)}
            allowClear
            clearLabel="Любой срок"
            testID="tasks-filter-due"
          />
          <SelectField
            label="Сортировка"
            options={(Object.keys(SORT_LABELS) as TaskSort[]).map((s) => ({ value: s, label: SORT_LABELS[s] }))}
            value={sort}
            onChange={(v) => setSort((v as TaskSort) ?? 'deadline')}
            testID="tasks-sort"
          />
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            <Button
              title="Сбросить"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => {
                setSubjectFilter(undefined);
                setDueFilter(undefined);
                setSort('deadline');
                setQuick('active');
                setSearch('');
              }}
            />
            <Button title="Показать" style={{ flex: 1 }} onPress={() => setFiltersOpen(false)} />
          </View>
        </ScrollView>
      </BottomSheet>

      {/* FAB */}
      <Pressable
        testID="tasks-fab"
        accessibilityRole="button"
        accessibilityLabel="Добавить задачу"
        onPress={() => router.push('/task/edit')}
        style={({ pressed }) => [styles.fab, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="add" size={28} color={colors.onPrimary} />
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
  },
  filterButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
});
