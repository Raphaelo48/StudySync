/**
 * Просмотр чужого расписания (группа, преподаватель, аудитория) или занятий
 * одного предмета из своего расписания. Ничего не записывает в календарь:
 * для своей группы есть кнопка импорта.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Badge, Button, Card, Chip, EmptyState, Spinner } from '../src/components/ui/primitives';
import { SwitchRow } from '../src/components/ui/inputs';
import { useDatabase, useSettings, useTheme } from '../src/state/AppContexts';
import { fetchSchedule, KgeuError } from '../src/logic/kgeuClient';
import {
  baseLessonTitle,
  filterBySubject,
  fromToday,
  groupByDay,
  KIND_LABELS,
  lessonMeta,
  normalizeQuery,
  toViewLessons,
  topDisciplines,
  type ViewLesson,
} from '../src/logic/kgeuSearch';
import { pushRecent } from '../src/logic/prefs';
import { describeEvent } from '../src/logic/eventDisplay';
import { DAY_MS, formatDateWithWeekday, formatTime, pluralRu, startOfDay } from '../src/core/time';
import type { KgeuTargetKind } from '../src/models/types';
import { logger } from '../src/core/logger';

type ViewKind = KgeuTargetKind | 'subject';

/** Последние открытые расписания — чтобы «назад/вперёд» не ходили в сеть. */
const scheduleCache = new Map<string, { at: number; lessons: ViewLesson[] }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export default function ScheduleViewScreen() {
  const params = useLocalSearchParams<{ kind: ViewKind; id?: string; name?: string; subjectId?: string }>();
  const kind: ViewKind = params.kind ?? 'group';
  const id = Number(params.id);
  const name = params.name ?? '';
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const { settings, update } = useSettings();

  const [lessons, setLessons] = useState<ViewLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [includePast, setIncludePast] = useState(false);

  const cacheKey = `${kind}:${kind === 'subject' ? params.subjectId || name : id}`;

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const cached = scheduleCache.get(cacheKey);
        if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
          setLessons(cached.lessons);
          return;
        }
        let next: ViewLesson[];
        if (kind === 'subject') {
          next = await loadLocalSubject(db, params.subjectId || null, name);
        } else {
          next = toViewLessons(await fetchSchedule(kind, id));
          // Запоминаем запрос в «Недавних» только после успешной загрузки.
          const recent = pushRecent(settings.kgeuRecent, { kind, id, name });
          if (JSON.stringify(recent) !== JSON.stringify(settings.kgeuRecent)) void update({ kgeuRecent: recent });
        }
        scheduleCache.set(cacheKey, { at: Date.now(), lessons: next });
        setLessons(next);
      } catch (e) {
        setError(e instanceof KgeuError ? e.message : 'Не удалось загрузить расписание');
        logger.error('kgeu', 'Ошибка загрузки расписания для просмотра', e);
      } finally {
        setLoading(false);
      }
    },
    // settings.kgeuRecent читаем в момент загрузки; перезагрузка при его изменении не нужна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cacheKey, kind, id, name, db]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();
  const visible = useMemo(
    () => (lessons ? filterBySubject(fromToday(lessons, now, includePast), filter) : []),
    // now меняется каждый рендер — достаточно пересчёта по данным и фильтрам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lessons, filter, includePast]
  );
  const days = useMemo(() => groupByDay(visible), [visible]);
  const chips = useMemo(() => (lessons && kind !== 'subject' ? topDisciplines(fromToday(lessons, now, includePast)) : []), [
    lessons,
    kind,
    includePast,
    now,
  ]);
  const isOwnGroup = kind === 'group' && settings.kgeuGroupId === id;
  const metaKind: KgeuTargetKind = kind === 'subject' ? 'group' : kind;

  return (
    <Screen testID="schedule-view-screen" keyboardAvoiding>
      <ScreenHeader
        title={name || 'Расписание'}
        subtitle={kind === 'subject' ? 'предмет · моё расписание' : KIND_LABELS[kind].toLowerCase()}
        testID="schedule-view-header"
        right={
          kind !== 'subject' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Обновить расписание"
              hitSlop={8}
              onPress={() => void load(true)}
              testID="schedule-view-refresh"
            >
              <Ionicons name="refresh" size={21} color={colors.primary} />
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {kind === 'group' ? (
          <Card style={{ marginBottom: spacing.md }}>
            {isOwnGroup ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm }}>
                <Badge label="моя группа" color={colors.success} icon="star" />
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, flex: 1 }}>импортирована в расписание</Text>
              </View>
            ) : null}
            <Button
              testID="schedule-view-import"
              title={isOwnGroup ? 'Синхронизировать моё расписание' : 'Сделать моей группой и импортировать'}
              icon="download-outline"
              variant={isOwnGroup ? 'secondary' : 'primary'}
              onPress={() => router.push({ pathname: '/university', params: { groupId: String(id), groupName: name } })}
            />
          </Card>
        ) : null}

        {kind !== 'subject' ? (
          <View style={[styles.filterRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radii.md }]}>
            <Ionicons name="funnel-outline" size={16} color={colors.textMuted} />
            <TextInput
              testID="schedule-view-filter"
              value={filter}
              onChangeText={setFilter}
              placeholder="Фильтр по предмету"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              style={{ flex: 1, color: colors.text, fontSize: fontSizes.md, paddingVertical: 9 }}
            />
            {filter ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Сбросить фильтр" onPress={() => setFilter('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {chips.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }} style={{ marginTop: spacing.sm }}>
            {chips.map((c) => (
              <Chip
                key={c}
                label={c.length > 28 ? `${c.slice(0, 27)}…` : c}
                selected={normalizeQuery(filter) === normalizeQuery(c)}
                onPress={() => setFilter(normalizeQuery(filter) === normalizeQuery(c) ? '' : c)}
              />
            ))}
          </ScrollView>
        ) : null}

        <SwitchRow testID="schedule-view-past" label="Показывать прошедшие занятия" value={includePast} onValueChange={setIncludePast} />

        {loading && !lessons ? (
          <Spinner testID="schedule-view-loading" />
        ) : error ? (
          <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
            <Text style={{ color: colors.danger, fontSize: fontSizes.sm, lineHeight: 19 }}>{error}</Text>
            <Button title="Повторить" variant="secondary" style={{ marginTop: spacing.md }} onPress={() => void load(true)} />
          </Card>
        ) : days.length === 0 ? (
          <EmptyState
            icon="calendar-clear-outline"
            title={filter ? 'По фильтру ничего нет' : 'Занятий нет'}
            subtitle={
              filter
                ? 'Сбросьте фильтр или включите прошедшие занятия'
                : includePast
                  ? 'Сервер КГЭУ не вернул занятий на этот учебный год'
                  : 'Впереди занятий нет — включите прошедшие, чтобы посмотреть семестр'
            }
          />
        ) : (
          <>
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginBottom: spacing.sm }}>
              {visible.length} {pluralRu(visible.length, 'занятие', 'занятия', 'занятий')}
            </Text>
            {days.map((d) => (
              <View key={d.day} style={{ marginBottom: spacing.md }}>
                <Text style={{ color: d.day === startOfDay(now) ? colors.primary : colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '700', marginBottom: 6 }}>
                  {d.day === startOfDay(now) ? 'Сегодня, ' : d.day === startOfDay(now) + DAY_MS ? 'Завтра, ' : ''}
                  {formatDateWithWeekday(d.day)}
                </Text>
                {d.lessons.map((l) => (
                  <View
                    key={l.key}
                    testID={`view-lesson-${l.key}`}
                    style={[styles.lesson, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radii.md }]}
                  >
                    <View style={{ width: 48 }}>
                      <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '700' }}>{formatTime(l.startAt)}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>{formatTime(l.endAt)}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }} numberOfLines={2}>
                        {l.title}
                      </Text>
                      {lessonMeta(l, metaKind) ? (
                        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }} numberOfLines={2}>
                          {lessonMeta(l, metaKind)}
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
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Занятия одного предмета из своего расписания в том же формате, что и чужое расписание. */
async function loadLocalSubject(
  db: ReturnType<typeof useDatabase>,
  subjectId: string | null,
  title: string
): Promise<ViewLesson[]> {
  const now = Date.now();
  const events = await db.events.listRange(now - 200 * DAY_MS, now + 250 * DAY_MS);
  const want = normalizeQuery(title);
  return events
    .filter((e) => e.kind === 'lesson' && (subjectId ? e.subjectId === subjectId : normalizeQuery(baseLessonTitle(e.title)) === want))
    .map((e) => {
      const info = describeEvent(e);
      const sub = /\(подгр\.\s*(\d+)\)\s*$/u.exec(e.title);
      return {
        key: e.id,
        startAt: e.startAt,
        endAt: e.endAt,
        title: baseLessonTitle(e.title),
        kindLabel: info.kindLabel ?? null,
        subgroup: sub ? Number(sub[1]) : 0,
        teacher: info.teacher ?? null,
        location: info.location ?? null,
        groups: null,
        isReplacement: info.isReplacement === true,
      };
    })
    .sort((a, b) => a.startAt - b.startAt);
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  lesson: {
    flexDirection: 'row',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
});
