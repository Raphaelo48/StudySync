/**
 * Расписание: представления «день», «неделя», «месяц»; создание/редактирование
 * событий, повторяющиеся серии, свободные промежутки, предупреждения о конфликтах.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { Badge, Button, Card, EmptyState, IconButton, Spinner } from '../../src/components/ui/primitives';
import { SegmentedControl } from '../../src/components/ui/inputs';
import { BottomSheet, ConfirmDialog } from '../../src/components/ui/overlays';
import { EventCard } from '../../src/components/schedule/EventCard';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../../src/state/AppContexts';
import { conflictingIds, freeSlotsForDay } from '../../src/logic/conflicts';
import {
  DAY_MS,
  MINUTE_MS,
  MONTH_GENITIVE,
  MONTH_NOMINATIVE,
  WEEKDAY_SHORT,
  addDays,
  formatDateFull,
  formatDateWithWeekday,
  formatDurationMinutes,
  formatTime,
  isSameDay,
  isSameMonth,
  isToday,
  monthGridDays,
  startOfDay,
  startOfMonth,
  startOfWeek,
  weekDays,
} from '../../src/core/time';
import { EVENT_KIND_LABELS, type CalendarEvent, type EventWithRelations } from '../../src/models/types';
import { cancelEventNotification } from '../../src/notifications/scheduler';
import { getNotificationClient } from '../../src/notifications/client';
import { describeEvent } from '../../src/logic/eventDisplay';
import { canHaveNote, lessonKeyFor } from '../../src/logic/lessonNotes';

type ViewMode = 'day' | 'week' | 'month';

export default function ScheduleScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const router = useRouter();
  const toast = useToast();
  const { version, bump } = useDataVersion();

  const [mode, setMode] = useState<ViewMode>('day');
  const [selectedDay, setSelectedDay] = useState<number>(() => startOfDay(Date.now()));
  const [events, setEvents] = useState<EventWithRelations[] | null>(null);
  const [sheetEvent, setSheetEvent] = useState<EventWithRelations | null>(null);
  const sheetInfo = sheetEvent ? describeEvent(sheetEvent) : null;
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);
  const [seriesSheet, setSeriesSheet] = useState<CalendarEvent | null>(null);

  const weekStartTs = useMemo(() => startOfWeek(selectedDay, settings.weekStart), [selectedDay, settings.weekStart]);
  const rangeFrom = mode === 'month' ? monthGridDays(selectedDay, settings.weekStart)[0]! : mode === 'week' ? weekStartTs : selectedDay;
  const rangeTo =
    mode === 'month'
      ? monthGridDays(selectedDay, settings.weekStart).slice(-1)[0]! + DAY_MS
      : mode === 'week'
        ? weekStartTs + 7 * DAY_MS
        : selectedDay + DAY_MS;

  const [noteKeys, setNoteKeys] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [list, keys] = await Promise.all([db.events.listRange(rangeFrom, rangeTo), db.lessonNotes.keysBetween(rangeFrom, rangeTo)]);
    setEvents(list);
    setNoteKeys(keys);
  }, [db, rangeFrom, rangeTo]);

  const openNote = (e: EventWithRelations) =>
    router.push({
      pathname: '/lesson-note',
      params: { key: lessonKeyFor(e), title: e.title, startAt: String(e.startAt), subjectId: e.subjectId ?? '' },
    });

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const dayEvents = useMemo(
    () => (events ?? []).filter((e) => e.startAt < selectedDay + DAY_MS && e.endAt > selectedDay).sort((a, b) => a.startAt - b.startAt),
    [events, selectedDay]
  );
  const dayConflictIds = useMemo(() => conflictingIds(dayEvents), [dayEvents]);

  const freeSlots = useMemo(
    () =>
      freeSlotsForDay(selectedDay, settings.studyWindowStartMin, settings.studyWindowEndMin, dayEvents.map((e) => ({ start: e.startAt, end: e.endAt })), {
        minMinutes: 20,
      }),
    [selectedDay, settings.studyWindowStartMin, settings.studyWindowEndMin, dayEvents]
  );

  const navigatePeriod = (dir: -1 | 1) => {
    if (mode === 'day') setSelectedDay((d) => addDays(d, dir));
    else if (mode === 'week') setSelectedDay((d) => addDays(d, dir * 7));
    else setSelectedDay((d) => startOfMonth(addDays(startOfMonth(d), dir > 0 ? 32 : -1)));
  };

  const periodLabel = useMemo(() => {
    if (mode === 'day') return formatDateWithWeekday(selectedDay);
    if (mode === 'week') {
      const end = addDays(weekStartTs, 6);
      return `${new Date(weekStartTs).getDate()} ${MONTH_GENITIVE[new Date(weekStartTs).getMonth()]} — ${new Date(end).getDate()} ${MONTH_GENITIVE[new Date(end).getMonth()]}`;
    }
    return `${MONTH_NOMINATIVE[new Date(selectedDay).getMonth()]} ${new Date(selectedDay).getFullYear()}`;
  }, [mode, selectedDay, weekStartTs]);

  const openCreate = (startAt?: number) => {
    const base = startAt ?? (() => {
      const d = new Date(selectedDay);
      d.setHours(Math.max(9, settings.studyWindowStartMin / 60), 0, 0, 0);
      return Math.max(d.getTime(), Date.now() + 5 * MINUTE_MS);
    })();
    router.push({ pathname: '/event/edit', params: { startAt: String(base) } });
  };

  const deleteEvent = async (event: CalendarEvent) => {
    try {
      await cancelEventNotification(getNotificationClient(), event.id);
      await db.events.delete(event.id);
      toast.success('Событие удалено');
      setConfirmDelete(null);
      setSheetEvent(null);
      bump();
      await load();
    } catch {
      toast.error('Не удалось удалить событие');
    }
  };

  const deleteSeriesVariant = async (event: CalendarEvent, variant: 'single' | 'future' | 'all') => {
    try {
      const client = getNotificationClient();
      if (variant === 'single' || !event.seriesId) {
        await cancelEventNotification(client, event.id);
        await db.events.delete(event.id);
      } else if (variant === 'future') {
        const series = await db.events.listSeries(event.seriesId);
        for (const e of series) {
          if (e.startAt >= event.startAt) await cancelEventNotification(client, e.id);
        }
        await db.events.deleteSeries(event.seriesId, event.startAt);
      } else {
        const series = await db.events.listSeries(event.seriesId);
        for (const e of series) await cancelEventNotification(client, e.id);
        await db.events.deleteSeries(event.seriesId);
      }
      toast.success(variant === 'single' ? 'Событие удалено' : 'Серия обновлена');
      setSeriesSheet(null);
      setSheetEvent(null);
      setConfirmDelete(null);
      bump();
      await load();
    } catch {
      toast.error('Не удалось удалить события серии');
    }
  };

  const onDeletePress = (event: CalendarEvent) => {
    if (event.seriesId) {
      setSeriesSheet(event);
    } else {
      setConfirmDelete(event);
    }
  };

  return (
    <Screen testID="schedule-screen">
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <View style={styles.headerRow}>
          <Text style={{ color: colors.text, fontSize: fontSizes.xxl, fontWeight: '700', flex: 1 }}>Расписание</Text>
          <IconButton
            icon="calendar-outline"
            accessibilityLabel="Перейти к сегодняшнему дню"
            onPress={() => setSelectedDay(startOfDay(Date.now()))}
            testID="schedule-today"
          />
          <IconButton
            icon="search"
            accessibilityLabel="Поиск расписания: группа, преподаватель, аудитория, предмет"
            onPress={() => router.push('/schedule-search')}
            testID="schedule-search"
          />
          <IconButton icon="add" accessibilityLabel="Добавить событие" onPress={() => openCreate()} testID="schedule-add" />
        </View>

        <SegmentedControl<ViewMode>
          testID="schedule-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'day', label: 'День' },
            { value: 'week', label: 'Неделя' },
            { value: 'month', label: 'Месяц' },
          ]}
        />

        <View style={styles.navRow}>
          <IconButton icon="chevron-back" accessibilityLabel="Предыдущий период" onPress={() => navigatePeriod(-1)} />
          <Text testID="schedule-period" style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', flex: 1, textAlign: 'center' }}>
            {periodLabel}
          </Text>
          <IconButton icon="chevron-forward" accessibilityLabel="Следующий период" onPress={() => navigatePeriod(1)} />
        </View>
      </View>

      {events == null ? (
        <Spinner testID="schedule-loading" />
      ) : mode === 'day' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {dayEvents.length === 0 ? (
            <Card style={{ marginTop: spacing.sm }}>
              <EmptyState
                testID="schedule-day-empty"
                icon="calendar-outline"
                title="Событий нет"
                subtitle="Свободный день — можно добавить занятие или учебную сессию"
                actionLabel="Добавить событие"
                onAction={() => openCreate()}
              />
            </Card>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              {dayEvents.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  hasConflict={dayConflictIds.has(e.id)}
                  onPress={() => setSheetEvent(e)}
                  hasNote={noteKeys.has(lessonKeyFor(e))}
                  onNotePress={canHaveNote(e) ? () => openNote(e) : undefined}
                  compact={settings.compactSchedule}
                  testID={`schedule-event-${e.id}`}
                />
              ))}
            </View>
          )}
          {freeSlots.length > 0 ? (
            <>
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginVertical: spacing.md }}>
                Свободные промежутки
              </Text>
              {freeSlots.map((slot, i) => (
                <Pressable
                  key={`${slot.start}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Свободное окно ${formatTime(slot.start)}—${formatTime(slot.end)}, ${formatDurationMinutes((slot.end - slot.start) / MINUTE_MS)}. Запланировать задачу.`}
                  onPress={() => router.push('/replan')}
                  style={[styles.freeSlot, { borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceAlt }]}
                >
                  <Ionicons name="time-outline" size={14} color={colors.success} />
                  <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }}>
                    {formatTime(slot.start)}–{formatTime(slot.end)}
                  </Text>
                  <Badge label={formatDurationMinutes((slot.end - slot.start) / MINUTE_MS)} color={colors.success} />
                  <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600', marginLeft: 'auto' }}>
                    Заполнить →
                  </Text>
                </Pressable
                >
              ))}
            </>
          ) : null}
        </ScrollView>
      ) : mode === 'week' ? (
        <WeekGrid
          events={events}
          weekStartTs={weekStartTs}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          onTapSlot={(ts) => openCreate(ts)}
          onTapEvent={setSheetEvent}
        />
      ) : (
        // Режим «Месяц»: сетка + список выбранного дня. Именно ScrollView —
        // в обычном View список дня обрезался по высоте экрана, и при 4+ занятиях
        // нижние карточки было не увидеть.
        <ScrollView
          testID="schedule-month-scroll"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <MonthGrid
            events={events}
            selectedDay={selectedDay}
            weekStart={settings.weekStart}
            onSelectDay={setSelectedDay}
            onMonthChange={(dir) => navigatePeriod(dir)}
          />
          <View testID="schedule-month-daylist" style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '700' }}>
                {formatDateWithWeekday(selectedDay)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Открыть день отдельным экраном"
                testID="schedule-month-open-day"
                hitSlop={8}
                onPress={() => setMode('day')}
              >
                <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600' }}>Дневной вид →</Text>
              </Pressable>
            </View>
            {dayEvents.length === 0 ? (
              <Card>
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                  В выбранный день занятий нет. Нажмите «+», чтобы добавить событие.
                </Text>
              </Card>
            ) : (
              dayEvents.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  hasConflict={dayConflictIds.has(e.id)}
                  onPress={() => setSheetEvent(e)}
                  hasNote={noteKeys.has(lessonKeyFor(e))}
                  onNotePress={canHaveNote(e) ? () => openNote(e) : undefined}
                  compact={settings.compactSchedule}
                  testID={`schedule-month-event-${e.id}`}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* Карточка события */}
      <BottomSheet
        visible={sheetEvent != null}
        title={sheetEvent?.title ?? ''}
        onClose={() => setSheetEvent(null)}
        testID="event-sheet"
      >
        {sheetEvent ? (
          <View>
            <View style={styles.sheetMeta}>
              <Ionicons name="time-outline" size={15} color={colors.textMuted} />
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.md }}>
                {formatDateWithWeekday(sheetEvent.startAt)} · {formatTime(sheetEvent.startAt)}–{formatTime(sheetEvent.endAt)}
              </Text>
            </View>
            <View style={styles.sheetMeta}>
              <Ionicons name="pricetag-outline" size={15} color={colors.textMuted} />
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.md }}>
                {[
                  sheetInfo?.kindLabel ?? EVENT_KIND_LABELS[sheetEvent.kind],
                  sheetInfo?.subjectName,
                  sheetEvent.location ? `ауд. ${sheetEvent.location}` : null,
                  sheetInfo?.isReplacement ? 'замена' : null,
                  sheetEvent.seriesId ? 'повторяющееся' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {sheetInfo?.teacher ? (
              <View style={styles.sheetMeta}>
                <Ionicons name="person-outline" size={15} color={colors.textMuted} />
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.md, flex: 1 }}>{sheetInfo.teacher}</Text>
              </View>
            ) : null}
            {sheetEvent.notes && !sheetInfo?.kindLabel && !sheetInfo?.teacher ? (
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: spacing.sm }}>{sheetEvent.notes}</Text>
            ) : null}
            {canHaveNote(sheetEvent) ? (
              <Button
                testID="event-sheet-note"
                title={noteKeys.has(lessonKeyFor(sheetEvent)) ? 'Открыть конспект' : 'Конспект к паре'}
                variant="secondary"
                icon="document-text-outline"
                style={{ marginTop: spacing.md }}
                onPress={() => {
                  const e = sheetEvent;
                  setSheetEvent(null);
                  openNote(e);
                }}
              />
            ) : null}
            {dayConflictIds.has(sheetEvent.id) ? (
              <View style={[styles.conflictNote, { backgroundColor: colors.dangerSoft, borderRadius: radii.md }]}>
                <Ionicons name="warning" size={15} color={colors.danger} />
                <Text style={{ color: colors.danger, fontSize: fontSizes.sm, flex: 1 }}>
                  Событие пересекается с другим в расписании. Измените время одного из них — автоматически ничего не удаляется.
                </Text>
              </View>
            ) : null}
            <View style={styles.sheetActions}>
              <Button
                title="Редактировать"
                variant="secondary"
                icon="create-outline"
                style={{ flex: 1 }}
                onPress={() => {
                  const id = sheetEvent.id;
                  setSheetEvent(null);
                  router.push({ pathname: '/event/edit', params: { eventId: id } });
                }}
              />
              <Button title="Удалить" variant="danger" icon="trash-outline" style={{ flex: 1 }} onPress={() => onDeletePress(sheetEvent)} />
            </View>
            <View style={{ height: 12 }} />
          </View>
        ) : null}
      </BottomSheet>

      {/* Выбор удаления серии */}
      <BottomSheet visible={seriesSheet != null} title="Удалить событие" onClose={() => setSeriesSheet(null)}>
        {seriesSheet ? (
          <View style={{ gap: 10, paddingBottom: 12 }}>
            <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginBottom: 4 }}>
              Это событие входит в серию повторений. Что удалить?
            </Text>
            <Button title="Только это событие" variant="secondary" onPress={() => void deleteSeriesVariant(seriesSheet, 'single')} />
            <Button title="Это и будущие события серии" variant="secondary" onPress={() => void deleteSeriesVariant(seriesSheet, 'future')} />
            <Button title="Всю серию целиком" variant="danger" onPress={() => setConfirmDelete(seriesSheet)} />
            <Button title="Отмена" variant="ghost" onPress={() => setSeriesSheet(null)} />
          </View>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDelete != null}
        title={seriesSheet ? 'Удалить всю серию?' : 'Удалить событие?'}
        message={
          seriesSheet
            ? 'Все события этой серии будут удалены безвозвратно.'
            : 'Событие будет удалено. Действие нельзя отменить.'
        }
        confirmLabel="Удалить"
        danger
        testID="schedule-delete-confirm"
        onConfirm={() => {
          if (!confirmDelete) return;
          if (seriesSheet?.seriesId && confirmDelete.seriesId) void deleteSeriesVariant(confirmDelete, 'all');
          else void deleteEvent(confirmDelete);
        }}
        onCancel={() => {
          setConfirmDelete(null);
          setSeriesSheet(null);
        }}
      />
    </Screen>
  );
}

/* ---------------------------------- Неделя ---------------------------------- */

interface WeekGridProps {
  events: EventWithRelations[];
  weekStartTs: number;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  onTapSlot: (ts: number) => void;
  onTapEvent: (e: EventWithRelations) => void;
}

function WeekGrid({ events, weekStartTs, selectedDay, onSelectDay, onTapSlot, onTapEvent }: WeekGridProps) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  const { settings } = useSettings();
  const days = useMemo(() => weekDays(weekStartTs), [weekStartTs]);
  const PPM = 1.05; // пикселей в минуте

  const [axisStartMin, axisEndMin] = useMemo(() => {
    let min = settings.studyWindowStartMin;
    let max = settings.studyWindowEndMin;
    for (const e of events) {
      const sMin = Math.floor((e.startAt - startOfDay(e.startAt)) / MINUTE_MS);
      const eMin = Math.ceil((e.endAt - startOfDay(e.endAt)) / MINUTE_MS);
      min = Math.min(min, sMin);
      max = Math.max(max, eMin);
    }
    return [Math.max(0, Math.floor(min / 60) * 60), Math.min(24 * 60, Math.ceil(max / 60) * 60)];
  }, [events, settings.studyWindowStartMin, settings.studyWindowEndMin]);

  const gridHeight = (axisEndMin - axisStartMin) * PPM;
  const conflictIds = useMemo(() => conflictingIds(events), [events]);

  const handleColumnTap = (dayTs: number) => (e: GestureResponderEvent) => {
    const minutesFromTop = e.nativeEvent.locationY / PPM;
    const minutes = Math.round((axisStartMin + minutesFromTop) / 15) * 15;
    const ts = dayTs + minutes * MINUTE_MS;
    onTapSlot(Math.max(ts, Date.now() + MINUTE_MS));
  };

  return (
    <ScrollView horizontal={false} style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {/* Заголовки дней */}
      <View style={[styles.weekHeaderRow, { paddingHorizontal: spacing.sm }]}>
        <View style={styles.timeGutter} />
        {days.map((d) => {
          const selected = isSameDay(d, selectedDay);
          const today = isToday(d);
          return (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityLabel={formatDateWithWeekday(d)}
              onPress={() => onSelectDay(d)}
              style={[
                styles.weekDayHeader,
                selected && { backgroundColor: colors.primarySoft, borderRadius: radii.md },
              ]}
            >
              <Text style={{ color: selected ? colors.primary : colors.textMuted, fontSize: fontSizes.xs, fontWeight: '600' }}>
                {WEEKDAY_SHORT[new Date(d).getDay()]}
              </Text>
              <Text
                style={{
                  color: today ? colors.primary : selected ? colors.primary : colors.text,
                  fontSize: fontSizes.md,
                  fontWeight: today || selected ? '700' : '500',
                }}
              >
                {new Date(d).getDate()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.weekGridBody, { paddingHorizontal: spacing.sm, height: gridHeight + 20 }]}>
          {/* Временная шкала */}
          <View style={[styles.timeGutter, { height: gridHeight }]}>
            {Array.from({ length: (axisEndMin - axisStartMin) / 60 + 1 }, (_, i) => {
              const minute = axisStartMin + i * 60;
              return (
                <Text
                  key={minute}
                  style={{ position: 'absolute', top: i * 60 * PPM - 7, right: 6, color: colors.textMuted, fontSize: 10 }}
                >
                  {String(Math.floor(minute / 60)).padStart(2, '0')}:00
                </Text>
              );
            })}
          </View>
          {/* Колонки дней */}
          {days.map((d) => {
            const dayEvents = events
              .filter((e) => isSameDay(e.startAt, d))
              .sort((a, b) => a.startAt - b.startAt);
            return (
              <Pressable
                key={d}
                onPress={handleColumnTap(d)}
                style={[
                  styles.weekColumn,
                  { height: gridHeight, borderColor: colors.borderSoft },
                  isSameDay(d, selectedDay) && { backgroundColor: colors.primarySoft + '33' },
                ]}
              >
                {/* Часовые линии */}
                {Array.from({ length: (axisEndMin - axisStartMin) / 60 + 1 }, (_, i) => (
                  <View
                    key={i}
                    style={{ position: 'absolute', top: i * 60 * PPM, left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSoft }}
                  />
                ))}
                {dayEvents.map((e) => {
                  const startMin = (e.startAt - startOfDay(e.startAt)) / MINUTE_MS;
                  const endMin = (e.endAt - startOfDay(e.endAt)) / MINUTE_MS;
                  const top = Math.max(0, (startMin - axisStartMin) * PPM);
                  const bottom = Math.min(gridHeight, (endMin - axisStartMin) * PPM);
                  const height = Math.max(18, bottom - top);
                  const accent = e.subject?.color ?? (e.kind === 'personal' ? colors.info : colors.primary);
                  const conflict = conflictIds.has(e.id);
                  return (
                    <Pressable
                      key={e.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${e.title}, ${formatTime(e.startAt)}–${formatTime(e.endAt)}`}
                      onPress={(ev) => {
                        ev.stopPropagation();
                        onTapEvent(e);
                      }}
                      style={{
                        position: 'absolute',
                        top,
                        left: 2,
                        right: 2,
                        height,
                        backgroundColor: `${accent}33`,
                        borderWidth: conflict ? 1.5 : 0,
                        borderColor: conflict ? colors.danger : 'transparent',
                        borderLeftWidth: 3,
                        borderLeftColor: accent,
                        borderRadius: 6,
                        paddingHorizontal: 4,
                        paddingVertical: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 10, fontWeight: '600' }}>
                        {e.title}
                      </Text>
                      {height > 30 ? (
                        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 9 }}>
                          {formatTime(e.startAt)}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs, textAlign: 'center', paddingVertical: spacing.sm }}>
        Нажмите на свободное место, чтобы создать событие
      </Text>
    </ScrollView>
  );
}

/* ---------------------------------- Месяц ---------------------------------- */

interface MonthGridProps {
  events: EventWithRelations[];
  selectedDay: number;
  weekStart: 0 | 1;
  onSelectDay: (day: number) => void;
  onMonthChange: (dir: -1 | 1) => void;
}

function MonthGrid({ events, selectedDay, weekStart, onSelectDay }: MonthGridProps) {
  const { colors, fontSizes, spacing } = useTheme();
  const grid = useMemo(() => monthGridDays(selectedDay, weekStart), [selectedDay, weekStart]);
  const weekdayLabels = useMemo(() => {
    const labels = [...WEEKDAY_SHORT];
    return weekStart === 1 ? [...labels.slice(1), labels[0]!] : labels;
  }, [weekStart]);
  const eventsByDay = useMemo(() => {
    const map = new Map<number, EventWithRelations[]>();
    for (const e of events) {
      const key = startOfDay(e.startAt);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.xs }}>
      <View style={styles.weekHeaderRow}>
        {weekdayLabels.map((wd, i) => (
          <Text key={`${wd}-${i}`} style={{ flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: fontSizes.xs, fontWeight: '600' }}>
            {wd}
          </Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {grid.map((day) => {
          const inMonth = isSameMonth(day, selectedDay);
          const dayEvents = eventsByDay.get(day) ?? [];
          const selected = isSameDay(day, selectedDay);
          const today = isToday(day);
          return (
            <Pressable
              key={day}
              testID={`month-day-${day}`}
              accessibilityRole="button"
              accessibilityLabel={`${formatDateFull(day)}, событий: ${dayEvents.length}`}
              onPress={() => onSelectDay(day)}
              style={styles.monthCell}
            >
              <View
                style={[
                  styles.monthDayCircle,
                  selected && { backgroundColor: colors.primary },
                  !selected && today && { borderWidth: 1, borderColor: colors.primary },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.onPrimary : inMonth ? colors.text : colors.textMuted,
                    fontSize: fontSizes.sm,
                    fontWeight: today || selected ? '700' : '500',
                  }}
                >
                  {new Date(day).getDate()}
                </Text>
              </View>
              <View style={styles.monthDots}>
                {dayEvents.slice(0, 3).map((e) => (
                  <View
                    key={e.id}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 2.5,
                      backgroundColor: selected ? colors.onPrimary : (e.subject?.color ?? colors.primary),
                    }}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs, textAlign: 'center', marginTop: spacing.md }}>
        Выберите день — его расписание появится ниже сетки месяца
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    gap: 2,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  freeSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  weekHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  weekDayHeader: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  weekGridBody: {
    flexDirection: 'row',
  },
  timeGutter: {
    width: 40,
  },
  weekColumn: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 4,
    gap: 3,
  },
  monthDayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthDots: {
    flexDirection: 'row',
    gap: 3,
    height: 5,
  },
  sheetMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  conflictNote: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    marginTop: 12,
    alignItems: 'flex-start',
  },
});
