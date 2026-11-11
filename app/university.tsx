/**
 * Импорт и синхронизация расписания КГЭУ.
 *
 * Работает через публичный API личного кабинета (без пароля и WebView):
 * поиск группы → предпросмотр (период, число занятий, замены, дифф) →
 * подтверждение → транзакционное применение. Пользовательские события
 * не затрагиваются; повторный импорт обновляет изменения (идемпотентно).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Badge, Button, Card, EmptyState, Spinner } from '../src/components/ui/primitives';
import { ConfirmDialog } from '../src/components/ui/overlays';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../src/state/AppContexts';
import { SwitchRow } from '../src/components/ui/inputs';
import { fetchGroups, KgeuError, type KgeuGroup } from '../src/logic/kgeuClient';
import { computeSyncDiff, parseLessonRow, type ParsedLesson } from '../src/logic/kgeuImport';
import { importKgeuSchedule, removeKgeuImport, type KgeuImportReport } from '../src/logic/kgeuService';
import { formatDateShort, formatTime, pluralRu } from '../src/core/time';
import { logger } from '../src/core/logger';

export default function UniversityScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const toast = useToast();
  const { bump } = useDataVersion();
  const { settings, update } = useSettings();
  const params = useLocalSearchParams<{ groupId?: string; groupName?: string }>();

  const [query, setQuery] = useState('');
  const [allGroups, setAllGroups] = useState<KgeuGroup[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<KgeuGroup | null>(null);
  const [previewLessons, setPreviewLessons] = useState<ParsedLesson[] | null>(null);
  const [previewDiff, setPreviewDiff] = useState<ReturnType<typeof computeSyncDiff> | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<KgeuImportReport | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const filteredGroups = useMemo(() => {
    if (!allGroups) return [];
    const q = query.trim().toLowerCase();
    if (!q) return allGroups.slice(0, 60);
    return allGroups
      .filter((g) => g.name.toLowerCase().includes(q) || (g.facul ?? '').toLowerCase().includes(q))
      .slice(0, 60);
  }, [allGroups, query]);

  // Переход из поиска расписания: сразу открыть выбранную группу.
  useEffect(() => {
    const id = Number(params.groupId);
    if (Number.isInteger(id) && id > 0 && params.groupName) {
      void openGroup({ id, name: params.groupName });
    }
    // Только при открытии экрана с параметрами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.groupId]);

  const loadGroups = async () => {
    setLoadingGroups(true);
    setGroupsError(null);
    try {
      const groups = await fetchGroups();
      setAllGroups(groups);
    } catch (e) {
      const msg = e instanceof KgeuError ? e.message : 'Не удалось загрузить список групп';
      setGroupsError(msg);
      logger.error('kgeu', 'Ошибка загрузки списка групп', e);
    } finally {
      setLoadingGroups(false);
    }
  };

  const openGroup = async (group: KgeuGroup) => {
    setSelected(group);
    setPreviewLessons(null);
    setPreviewDiff(null);
    setPreviewError(null);
    setReport(null);
    setLoadingPreview(true);
    try {
      const [rows, existing] = await Promise.all([
        import('../src/logic/kgeuClient').then((m) => m.fetchGroupSchedule(group.id)),
        db.events.listBySourceRefPrefix('kgeu', `${group.id}:`),
      ]);
      const lessons = rows.map((r) => parseLessonRow(r, group.id)).filter((l): l is ParsedLesson => l != null);
      lessons.sort((a, b) => a.startAt - b.startAt);
      setPreviewLessons(lessons);
      setPreviewDiff(computeSyncDiff(existing, lessons));
      setImportedCount(existing.length);
    } catch (e) {
      const msg = e instanceof KgeuError ? e.message : 'Не удалось загрузить расписание группы';
      setPreviewError(msg);
      logger.error('kgeu', 'Ошибка загрузки расписания', e);
    } finally {
      setLoadingPreview(false);
    }
  };

  const doImport = async () => {
    if (!selected) return;
    setImporting(true);
    try {
      const rep = await importKgeuSchedule(db, { groupId: selected.id, groupName: selected.name });
      setReport(rep);
      // Запоминаем свою группу — для автообновления при запуске и быстрого поиска.
      await update({ kgeuGroupId: selected.id, kgeuGroupName: selected.name, kgeuLastSyncAt: Date.now() });
      bump();
      toast.success(
        `Расписание ${selected.name}: добавлено ${rep.inserted}, обновлено ${rep.updated}, удалено устаревших ${rep.removed}, предметов создано ${rep.subjectsCreated}`
      );
      await openGroup(selected);
    } catch (e) {
      const msg = e instanceof KgeuError ? e.message : 'Не удалось импортировать расписание';
      toast.error(msg);
      logger.error('kgeu', 'Ошибка импорта', e);
    } finally {
      setImporting(false);
    }
  };

  const doRemove = async () => {
    if (!selected) return;
    const removed = await removeKgeuImport(db, selected.id);
    setConfirmRemove(false);
    if (settings.kgeuGroupId === selected.id) {
      await update({ kgeuGroupId: null, kgeuGroupName: null, kgeuLastSyncAt: null });
    }
    setImportedCount(0);
    setReport(null);
    bump();
    toast.success(`Удалено импортированных событий: ${removed}`);
    await openGroup(selected);
  };

  const periodLabel = useMemo(() => {
    if (!previewLessons || previewLessons.length === 0) return null;
    const min = previewLessons[0]!.startAt;
    const max = previewLessons[previewLessons.length - 1]!.startAt;
    return `${formatDateShort(min)} — ${formatDateShort(max)}`;
  }, [previewLessons]);

  return (
    <Screen testID="university-screen">
      <ScreenHeader
        title="Расписание КГЭУ"
        testID="university-header"
        right={
          selected ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Сменить группу" hitSlop={8} onPress={() => setSelected(null)}>
              <Ionicons name="swap-horizontal" size={22} color={colors.primary} />
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {!selected ? (
          <>
            <Card style={{ backgroundColor: colors.infoSoft, marginBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Ionicons name="information-circle" size={16} color={colors.info} />
                <Text style={{ color: colors.text, fontSize: fontSizes.sm, lineHeight: 19, flex: 1 }}>
                  Импорт использует публичные данные личного кабинета КГЭУ — пароль не нужен.
                  Требуется интернет; занятия создаются как обычные события расписания
                  (повторный импорт обновляет изменения и убирает отменённые).
                </Text>
              </View>
            </Card>

            {settings.kgeuGroupId != null ? (
              <Card style={{ marginBottom: spacing.lg }} testID="kgeu-own-group">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Моя группа ${settings.kgeuGroupName ?? ''}, открыть`}
                  onPress={() => void openGroup({ id: settings.kgeuGroupId!, name: settings.kgeuGroupName ?? 'Моя группа' })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <Ionicons name="people-outline" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>
                      Моя группа: {settings.kgeuGroupName ?? '—'}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                      {settings.kgeuLastSyncAt
                        ? `обновлено ${formatDateShort(settings.kgeuLastSyncAt)} в ${formatTime(settings.kgeuLastSyncAt)}`
                        : 'ещё не обновлялось'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
                <SwitchRow
                  testID="kgeu-autosync"
                  label="Обновлять при открытии приложения"
                  description="Не чаще раза в 6 часов, без уведомлений об ошибках сети"
                  value={settings.autoSyncGroup}
                  onValueChange={(v) => void update({ autoSyncGroup: v })}
                />
              </Card>
            ) : null}

            <Button
              testID="kgeu-open-search"
              title="Поиск: преподаватель, аудитория, предмет"
              variant="secondary"
              icon="search"
              style={{ marginBottom: spacing.lg }}
              onPress={() => router.push('/schedule-search')}
            />

            <View
              style={[
                styles.searchRow,
                { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={17} color={colors.textMuted} />
              <TextInput
                testID="kgeu-search"
                value={query}
                onChangeText={setQuery}
                placeholder="Группа, например А-1-22, или институт"
                placeholderTextColor={colors.textMuted}
                style={{ flex: 1, color: colors.text, fontSize: fontSizes.md, paddingVertical: 10 }}
                returnKeyType="search"
                onSubmitEditing={() => allGroups == null && void loadGroups()}
              />
            </View>
            <View style={{ height: spacing.md }} />
            <Button
              testID="kgeu-find"
              title={allGroups ? 'Обновить список групп' : 'Найти группы'}
              icon="cloud-download-outline"
              loading={loadingGroups}
              onPress={() => void loadGroups()}
            />
            {groupsError ? (
              <Card style={{ marginTop: spacing.lg, borderColor: colors.danger, borderWidth: 1 }}>
                <Text style={{ color: colors.danger, fontSize: fontSizes.sm, lineHeight: 19 }}>{groupsError}</Text>
              </Card>
            ) : null}

            {allGroups ? (
              filteredGroups.length === 0 ? (
                <EmptyState title="Ничего не найдено" subtitle="Уточните название группы или института" />
              ) : (
                <View style={{ marginTop: spacing.lg }}>
                  {filteredGroups.map((g) => (
                    <Pressable
                      key={g.id}
                      testID={`kgeu-group-${g.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Группа ${g.name}, ${g.facul ?? ''}, ${g.kurs ?? ''} курс`}
                      onPress={() => void openGroup(g)}
                      style={({ pressed }) => [
                        styles.groupRow,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.borderSoft,
                          borderRadius: radii.md,
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>{g.name}</Text>
                        <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                          {[g.facul, g.kurs ? `${g.kurs} курс` : null, g.yearName].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  ))}
                </View>
              )
            ) : null}
          </>
        ) : (
          <>
            <Card style={{ marginBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: fontSizes.xl, fontWeight: '700' }}>{selected.name}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 2 }}>
                    {[selected.facul, selected.kurs ? `${selected.kurs} курс` : null].filter(Boolean).join(' · ')}
                    {periodLabel ? ` · ${periodLabel}` : ''}
                  </Text>
                </View>
                {importedCount > 0 ? <Badge label={`импортировано: ${importedCount}`} color={colors.success} /> : null}
              </View>
            </Card>

            {loadingPreview ? (
              <Spinner testID="kgeu-preview-loading" />
            ) : previewError ? (
              <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
                <Text style={{ color: colors.danger, fontSize: fontSizes.sm, lineHeight: 19 }}>{previewError}</Text>
                <Button title="Повторить" variant="secondary" style={{ marginTop: spacing.md }} onPress={() => void openGroup(selected)} />
              </Card>
            ) : previewLessons ? (
              <>
                <Card style={{ marginBottom: spacing.lg }}>
                  <View style={styles.statsRow}>
                    <StatCell value={String(previewLessons.length)} label={pluralRu(previewLessons.length, 'занятие', 'занятия', 'занятий')} />
                    <StatCell value={String(previewLessons.filter((l) => l.isReplacement).length)} label="замен" />
                    <StatCell value={String(previewDiff?.insert.length ?? 0)} label="добавится" color={colors.success} />
                    <StatCell value={String(previewDiff?.update.length ?? 0)} label="обновится" color={colors.warning} />
                    <StatCell value={String(previewDiff?.remove.length ?? 0)} label="уйдёт" color={colors.danger} />
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: spacing.sm, lineHeight: 16 }}>
                    Дисциплин в расписании: {new Set(previewLessons.map((l) => l.subjectName)).size} — при импорте они станут
                    предметами (существующие с теми же названиями переиспользуются, дубликаты не создаются).
                  </Text>
                  {report ? (
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: 4, lineHeight: 16 }}>
                      Последний импорт: +{report.inserted} / ~{report.updated} / −{report.removed}, без изменений {report.unchanged}, предметов создано {report.subjectsCreated}
                    </Text>
                  ) : null}
                </Card>

                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.sm }}>
                  Ближайшие занятия
                </Text>
                {previewLessons.slice(0, 8).map((l) => (
                  <View
                    key={l.ref}
                    style={[styles.lessonRow, { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radii.md }]}
                  >
                    <View style={{ width: 92 }}>
                      <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '700' }}>{formatDateShort(l.startAt)}</Text>
                      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                        {formatTime(l.startAt)}–{formatTime(l.endAt)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={2} style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '500' }}>
                        {l.title}
                      </Text>
                      <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                        {[l.kindLabel, l.location].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {l.isReplacement ? <Badge label="замена" color={colors.warning} /> : null}
                  </View>
                ))}

                <View style={{ height: spacing.lg }} />
                <Button
                  testID="kgeu-import"
                  title={importedCount > 0 ? 'Синхронизировать расписание' : 'Импортировать расписание'}
                  icon="download-outline"
                  size="lg"
                  loading={importing}
                  disabled={previewLessons.length === 0}
                  onPress={() => void doImport()}
                />
                {importedCount > 0 ? (
                  <Button
                    testID="kgeu-remove"
                    title="Удалить импорт этой группы"
                    variant="ghost"
                    icon="trash-outline"
                    style={{ marginTop: spacing.sm }}
                    onPress={() => setConfirmRemove(true)}
                  />
                ) : null}
                <Button
                  title="Открыть расписание"
                  variant="secondary"
                  icon="calendar-outline"
                  style={{ marginTop: spacing.sm }}
                  onPress={() => router.push('/(tabs)/schedule')}
                />
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmRemove}
        title="Удалить импортированное расписание?"
        message={`Будут удалены только события, импортированные из КГЭУ для группы ${selected?.name ?? ''} (${importedCount}). Созданные вами вручную события останутся.`}
        confirmLabel="Удалить"
        danger
        testID="kgeu-remove-confirm"
        onConfirm={() => void doRemove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </Screen>
  );
}

function StatCell({ value, label, color }: { value: string; label: string; color?: string }) {
  const { colors, fontSizes } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: color ?? colors.text, fontSize: fontSizes.lg, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs, textAlign: 'center' }}>{label}</Text>
    </View>
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
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
});
