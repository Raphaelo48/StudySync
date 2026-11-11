/**
 * Поиск расписания КГЭУ: группа, преподаватель, аудитория — по публичным
 * справочникам личного кабинета; предмет — по своему расписанию в приложении.
 * Пустой запрос показывает недавние поиски.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button, Card, EmptyState, SectionTitle, Spinner } from '../src/components/ui/primitives';
import { SegmentedControl } from '../src/components/ui/inputs';
import { useDatabase, useSettings, useTheme } from '../src/state/AppContexts';
import { fetchAuditoriums, fetchGroups, fetchTeachers, KgeuError } from '../src/logic/kgeuClient';
import { searchLocalSubjects, searchNamed, type LocalSubjectHit } from '../src/logic/kgeuSearch';
import { DAY_MS, formatDateWithWeekday, formatTime, pluralRu } from '../src/core/time';
import type { CalendarEvent, KgeuRecent, KgeuTargetKind } from '../src/models/types';
import { logger } from '../src/core/logger';

type SearchMode = KgeuTargetKind | 'subject';

interface Item {
  id: number;
  name: string;
  hint: string | null;
}

/** Справочники держим в памяти до закрытия приложения: они меняются редко. */
const listCache: Partial<Record<KgeuTargetKind, Item[]>> = {};

async function loadList(kind: KgeuTargetKind): Promise<Item[]> {
  const cached = listCache[kind];
  if (cached) return cached;
  let items: Item[];
  if (kind === 'group') {
    items = (await fetchGroups()).map((g) => ({
      id: g.id,
      name: g.name,
      hint: [g.facul, g.kurs ? `${g.kurs} курс` : null].filter(Boolean).join(' · ') || null,
    }));
  } else if (kind === 'teacher') {
    items = (await fetchTeachers()).map((t) => ({ id: t.id, name: t.name, hint: t.kaf ?? null }));
  } else {
    items = (await fetchAuditoriums()).map((a) => ({ id: a.id, name: a.name, hint: null }));
  }
  listCache[kind] = items;
  return items;
}

const PLACEHOLDERS: Record<SearchMode, string> = {
  group: 'Группа, например ПИ-1-23',
  teacher: 'Фамилия преподавателя',
  aud: 'Аудитория, например Б-301',
  subject: 'Название предмета',
};

const KIND_ICONS: Record<KgeuTargetKind, keyof typeof Ionicons.glyphMap> = {
  group: 'people-outline',
  teacher: 'person-outline',
  aud: 'business-outline',
};

function openTarget(kind: KgeuTargetKind, id: number, name: string) {
  router.push({ pathname: '/schedule-view', params: { kind, id: String(id), name } });
}

export default function ScheduleSearchScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const { settings } = useSettings();

  const [mode, setMode] = useState<SearchMode>('group');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);

  const load = useCallback(async (kind: KgeuTargetKind) => {
    setLoading(true);
    setError(null);
    try {
      setList(await loadList(kind));
    } catch (e) {
      setList(null);
      setError(e instanceof KgeuError ? e.message : 'Не удалось загрузить список');
      logger.error('kgeu', 'Ошибка загрузки справочника', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'subject') return;
    setList(listCache[mode] ?? null);
    void load(mode);
  }, [mode, load]);

  useFocusEffect(
    useCallback(() => {
      if (mode !== 'subject') return;
      const now = Date.now();
      void db.events.listRange(now - 200 * DAY_MS, now + 250 * DAY_MS).then(setEvents);
    }, [db, mode])
  );

  const results = useMemo(() => (list && query.trim() ? searchNamed(list, query) : []), [list, query]);
  const subjectHits = useMemo<LocalSubjectHit[]>(
    () => (mode === 'subject' && events ? searchLocalSubjects(events, query, Date.now()) : []),
    [mode, events, query]
  );

  const recent = settings.kgeuRecent;

  return (
    <Screen testID="schedule-search-screen" keyboardAvoiding>
      <ScreenHeader title="Поиск расписания" testID="schedule-search-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <SegmentedControl<SearchMode>
          testID="search-mode"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: 'group', label: 'Группа' },
            { value: 'teacher', label: 'Препод.' },
            { value: 'aud', label: 'Ауд.' },
            { value: 'subject', label: 'Предмет' },
          ]}
        />

        <View style={[styles.searchRow, { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderColor: colors.border, marginTop: spacing.md }]}>
          <Ionicons name="search" size={17} color={colors.textMuted} />
          <TextInput
            testID="search-input"
            value={query}
            onChangeText={setQuery}
            placeholder={PLACEHOLDERS[mode]}
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            style={{ flex: 1, color: colors.text, fontSize: fontSizes.md, paddingVertical: 10 }}
            returnKeyType="search"
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Очистить" onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {mode === 'subject' ? (
          <>
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: spacing.sm, lineHeight: 16 }}>
              Ищет по вашему расписанию. Чтобы найти предмет у другой группы или преподавателя, откройте их
              расписание и введите название в фильтр.
            </Text>
            {events == null ? (
              <Spinner />
            ) : subjectHits.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title={events.some((e) => e.kind === 'lesson') ? 'Ничего не найдено' : 'В расписании пока нет занятий'}
                subtitle={events.some((e) => e.kind === 'lesson') ? 'Попробуйте часть названия' : 'Импортируйте расписание группы'}
              />
            ) : (
              <View style={{ marginTop: spacing.md }}>
                {subjectHits.map((h) => (
                  <ResultRow
                    key={h.subjectId ?? h.title}
                    icon="book-outline"
                    title={h.title}
                    hint={
                      h.nextAt
                        ? `ближайшая: ${formatDateWithWeekday(h.nextAt)}, ${formatTime(h.nextAt)} · впереди ${h.upcoming} ${pluralRu(h.upcoming, 'занятие', 'занятия', 'занятий')}`
                        : `занятий в расписании: ${h.total}, все прошли`
                    }
                    onPress={() =>
                      router.push({ pathname: '/schedule-view', params: { kind: 'subject', name: h.title, subjectId: h.subjectId ?? '' } })
                    }
                    testID={`subject-hit-${h.title}`}
                  />
                ))}
              </View>
            )}
          </>
        ) : !query.trim() ? (
          <>
            {mode === 'group' && settings.kgeuGroupId != null ? (
              <>
                <SectionTitle title="Моя группа" />
                <ResultRow
                  icon="star-outline"
                  title={settings.kgeuGroupName ?? 'Моя группа'}
                  hint="импортирована в расписание"
                  onPress={() => openTarget('group', settings.kgeuGroupId!, settings.kgeuGroupName ?? 'Моя группа')}
                  testID="search-own-group"
                />
              </>
            ) : null}
            {recent.length > 0 ? (
              <>
                <SectionTitle title="Недавние" />
                {recent.map((r: KgeuRecent) => (
                  <ResultRow
                    key={`${r.kind}:${r.id}`}
                    icon={KIND_ICONS[r.kind]}
                    title={r.name}
                    hint={r.kind === 'group' ? 'группа' : r.kind === 'teacher' ? 'преподаватель' : 'аудитория'}
                    onPress={() => openTarget(r.kind, r.id, r.name)}
                    testID={`recent-${r.kind}-${r.id}`}
                  />
                ))}
              </>
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: spacing.lg, textAlign: 'center' }}>
                Начните вводить — {mode === 'teacher' ? 'фамилию' : 'название'}, результаты появятся сразу
              </Text>
            )}
          </>
        ) : loading && !list ? (
          <Spinner testID="search-loading" />
        ) : error ? (
          <Card style={{ marginTop: spacing.lg, borderColor: colors.danger, borderWidth: 1 }}>
            <Text style={{ color: colors.danger, fontSize: fontSizes.sm, lineHeight: 19 }}>{error}</Text>
            <Button title="Повторить" variant="secondary" style={{ marginTop: spacing.md }} onPress={() => void load(mode as KgeuTargetKind)} />
          </Card>
        ) : results.length === 0 ? (
          <EmptyState icon="search-outline" title="Ничего не найдено" subtitle="Проверьте написание или введите меньше букв" />
        ) : (
          <View style={{ marginTop: spacing.md }}>
            {results.map((it) => (
              <ResultRow
                key={it.id}
                icon={KIND_ICONS[mode as KgeuTargetKind]}
                title={it.name}
                hint={it.hint}
                onPress={() => openTarget(mode as KgeuTargetKind, it.id, it.name)}
                testID={`search-result-${it.id}`}
              />
            ))}
          </View>
        )}

        {error && mode !== 'subject' && !query.trim() ? (
          <Card style={{ marginTop: spacing.lg, borderColor: colors.danger, borderWidth: 1 }}>
            <Text style={{ color: colors.danger, fontSize: fontSizes.sm, lineHeight: 19 }}>{error}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ResultRow({
  icon,
  title,
  hint,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string | null;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, fontSizes, radii } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${title}, ${hint}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radii.md, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }} numberOfLines={1}>
          {title}
        </Text>
        {hint ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
});
