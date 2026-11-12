/**
 * Просмотр расписания группы, преподавателя или аудитории в виде месяца:
 * сетка с точками на днях с занятиями, под ней — пары выбранного дня.
 * Ничего не записывает в календарь; для группы есть кнопка импорта.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Badge, Button, Card, Spinner } from '../src/components/ui/primitives';
import { MonthCalendar } from '../src/components/schedule/MonthCalendar';
import { useSettings, useTheme } from '../src/state/AppContexts';
import { fetchSchedule, KgeuError } from '../src/logic/kgeuClient';
import {
  filterBySubject,
  initialDay,
  KIND_LABELS,
  lessonMeta,
  lessonsByDay,
  nearestLessonDay,
  toViewLessons,
  type ViewLesson,
} from '../src/logic/kgeuSearch';
import { pushRecent } from '../src/logic/prefs';
import { formatDateShort, formatDateWithWeekday, formatTime, isToday, pluralRu, startOfDay } from '../src/core/time';
import type { KgeuTargetKind } from '../src/models/types';
import { logger } from '../src/core/logger';

/** Последние открытые расписания — чтобы «назад/вперёд» не ходили в сеть. */
const scheduleCache = new Map<string, { at: number; lessons: ViewLesson[] }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export default function ScheduleViewScreen() {
  const params = useLocalSearchParams<{ kind: KgeuTargetKind; id?: string; name?: string }>();
  const kind: KgeuTargetKind = params.kind === 'teacher' || params.kind === 'aud' ? params.kind : 'group';
  const id = Number(params.id);
  const name = params.name ?? '';
  const { colors, fontSizes, spacing, radii } = useTheme();
  const { settings, update } = useSettings();

  const [lessons, setLessons] = useState<ViewLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(Date.now()));

  const cacheKey = `${kind}:${id}`;

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const cached = scheduleCache.get(cacheKey);
        let next: ViewLesson[];
        if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
          next = cached.lessons;
        } else {
          next = toViewLessons(await fetchSchedule(kind, id));
          scheduleCache.set(cacheKey, { at: Date.now(), lessons: next });
          // Запоминаем запрос в «Недавних» только после успешной загрузки.
          const recent = pushRecent(settings.kgeuRecent, { kind, id, name });
          if (JSON.stringify(recent) !== JSON.stringify(settings.kgeuRecent)) void update({ kgeuRecent: recent });
        }
        setLessons(next);
        if (!force) setSelectedDay(initialDay(next, Date.now()));
      } catch (e) {
        setError(e instanceof KgeuError ? e.message : 'Не удалось загрузить расписание');
        logger.error('kgeu', 'Ошибка загрузки расписания для просмотра', e);
      } finally {
        setLoading(false);
      }
    },
    // settings.kgeuRecent читаем в момент загрузки; перезагрузка при его изменении не нужна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKey, kind, id, name]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => (lessons ? filterBySubject(lessons, filter) : []), [lessons, filter]);
  const byDay = useMemo(() => lessonsByDay(visible), [visible]);
  const counts = useMemo(() => new Map([...byDay].map(([d, l]) => [d, l.length])), [byDay]);
  const dayLessons = byDay.get(selectedDay) ?? [];
  const nextDay = useMemo(() => nearestLessonDay(visible, selectedDay, 1), [visible, selectedDay]);
  const prevDay = useMemo(() => nearestLessonDay(visible, selectedDay, -1), [visible, selectedDay]);
  const isOwnGroup = kind === 'group' && settings.kgeuGroupId === id;

  return (
    <Screen testID="schedule-view-screen" keyboardAvoiding>
      <ScreenHeader
        title={name || 'Расписание'}
        subtitle={isOwnGroup ? 'моя группа' : KIND_LABELS[kind].toLowerCase()}
        testID="schedule-view-header"
        right={
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Фильтр по предмету"
              accessibilityState={{ selected: filterOpen || !!filter }}
              hitSlop={8}
              onPress={() => {
                if (filterOpen) setFilter('');
                setFilterOpen((v) => !v);
              }}
              testID="schedule-view-filter-toggle"
            >
              <Ionicons name={filter ? 'funnel' : 'funnel-outline'} size={20} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Обновить расписание" hitSlop={8} onPress={() => void load(true)} testID="schedule-view-refresh">
              <Ionicons name="refresh" size={21} color={colors.primary} />
            </Pressable>
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {filterOpen ? (
          <View style={[styles.filterRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radii.md, marginBottom: spacing.sm }]}>
            <Ionicons name="funnel-outline" size={16} color={colors.textMuted} />
            <TextInput
              testID="schedule-view-filter"
              value={filter}
              onChangeText={setFilter}
              placeholder="Название предмета"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              autoFocus
              style={{ flex: 1, color: colors.text, fontSize: fontSizes.md, paddingVertical: 8 }}
            />
            {filter ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Сбросить фильтр" onPress={() => setFilter('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {loading && !lessons ? (
          <Spinner testID="schedule-view-loading" />
        ) : error && !lessons ? (
          <Card style={{ borderColor: colors.danger, borderWidth: 1, marginTop: spacing.md }}>
            <Text style={{ color: colors.danger, fontSize: fontSizes.sm, lineHeight: 19 }}>{error}</Text>
            <Button title="Повторить" variant="secondary" style={{ marginTop: spacing.md }} onPress={() => void load(true)} />
          </Card>
        ) : (
          <>
            <MonthCalendar testID="view-month" selectedDay={selectedDay} weekStart={settings.weekStart} counts={counts} onSelectDay={setSelectedDay} />

            <View style={[styles.dayHeader, { marginTop: spacing.md, marginBottom: spacing.sm }]}>
              <Text testID="schedule-view-day" style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '700', flex: 1 }}>
                {isToday(selectedDay) ? 'Сегодня, ' : ''}
                {formatDateWithWeekday(selectedDay)}
              </Text>
              {dayLessons.length > 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                  {dayLessons.length} {pluralRu(dayLessons.length, 'пара', 'пары', 'пар')}
                </Text>
              ) : null}
            </View>

            {dayLessons.length === 0 ? (
              <View testID="schedule-view-empty-day" style={{ alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm }}>
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                  {visible.length === 0 ? (filter ? 'По фильтру занятий нет' : 'Сервер КГЭУ не вернул занятий') : 'В этот день занятий нет'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {prevDay != null ? (
                    <Button testID="schedule-view-prev-day" title={`← ${formatDateShort(prevDay)}`} variant="secondary" size="sm" onPress={() => setSelectedDay(prevDay)} />
                  ) : null}
                  {nextDay != null ? (
                    <Button testID="schedule-view-next-day" title={`Ближайшее: ${formatDateShort(nextDay)} →`} variant="secondary" size="sm" onPress={() => setSelectedDay(nextDay)} />
                  ) : null}
                </View>
              </View>
            ) : (
              dayLessons.map((l) => (
                <View
                  key={l.key}
                  testID={`view-lesson-${l.key}`}
                  style={[styles.lesson, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radii.md }]}
                >
                  <View style={{ width: 46 }}>
                    <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '700' }}>{formatTime(l.startAt)}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>{formatTime(l.endAt)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }} numberOfLines={2}>
                      {l.title}
                    </Text>
                    {lessonMeta(l, kind) ? (
                      <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }} numberOfLines={2}>
                        {lessonMeta(l, kind)}
                      </Text>
                    ) : null}
                    {l.kindLabel || l.isReplacement ? (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                        {l.kindLabel ? <Badge label={l.kindLabel} color={colors.primary} /> : null}
                        {l.isReplacement ? <Badge label="замена" color={colors.warning} icon="swap-horizontal" /> : null}
                      </View>
                    ) : null}
                  </View>
                </View>
              ))
            )}

            {kind === 'group' ? (
              <Button
                testID="schedule-view-import"
                title={isOwnGroup ? 'Синхронизировать моё расписание' : 'Сделать моей группой и импортировать'}
                icon="download-outline"
                variant="secondary"
                style={{ marginTop: spacing.lg }}
                onPress={() => router.push({ pathname: '/university', params: { groupId: String(id), groupName: name } })}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12 },
  dayHeader: { flexDirection: 'row', alignItems: 'center' },
  lesson: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
});
