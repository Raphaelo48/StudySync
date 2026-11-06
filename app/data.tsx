/**
 * Данные: экспорт в JSON, импорт с проверкой и выбором режима,
 * внутренние резервные копии, полный сброс (с двойным подтверждением).
 */
import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button, Card, IconButton, SectionTitle, Spinner } from '../src/components/ui/primitives';
import { BottomSheet, ConfirmDialog } from '../src/components/ui/overlays';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../src/state/AppContexts';
import {
  APP_VERSION,
  BackupParseError,
  exportAll,
  importBackup,
  listInternalBackups,
  parseBackup,
  restoreInternalBackup,
  deleteInternalBackup,
  serializeBackup,
  wipeAllData,
  type BackupFile,
  type ImportMode,
  type InternalBackupInfo,
} from '../src/logic/backup';
import { formatDateFull, formatTime } from '../src/core/time';
import { logger } from '../src/core/logger';
import { resyncAllNotifications } from '../src/notifications/scheduler';
import { getNotificationClient } from '../src/notifications/client';
import { photosSizeBytes, readPhotosBase64, writePhotosBase64 } from '../src/logic/lessonPhotos';

export default function DataScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const { reload: reloadSettings } = useSettings();
  const toast = useToast();
  const { bump } = useDataVersion();

  const [busy, setBusy] = useState<string | null>(null);
  const [backups, setBackups] = useState<InternalBackupInfo[] | null>(null);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmWipeFinal, setConfirmWipeFinal] = useState(false);
  /** Вопрос «включать ли фото конспектов» перед экспортом: число фото и размер. */
  const [photoQuestion, setPhotoQuestion] = useState<{ count: number; bytes: number } | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      setBackups(await listInternalBackups(db));
    } catch (e) {
      logger.error('data', 'Не удалось прочитать внутренние резервные копии', e);
      setBackups([]);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadBackups();
    }, [loadBackups])
  );

  const startExport = async () => {
    const names = [...(await db.lessonNotes.allPhotoNames())];
    if (names.length > 0 && Platform.OS !== 'web') {
      setPhotoQuestion({ count: names.length, bytes: photosSizeBytes(names) });
      return;
    }
    await doExport(false);
  };

  const doExport = async (includePhotos: boolean) => {
    setPhotoQuestion(null);
    setBusy('export');
    try {
      const backup = await exportAll(db);
      if (includePhotos) {
        backup.data.lessonPhotos = await readPhotosBase64([...(await db.lessonNotes.allPhotoNames())]);
      }
      const json = serializeBackup(backup);
      if (Platform.OS === 'web') {
        toast.info('Экспорт файла доступен в мобильной сборке. Данные можно скопировать в буфер обмена.');
        return;
      }
      const fileName = `studysync-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File(Paths.cache, fileName);
      if (file.exists) file.delete();
      file.create();
      await file.write(json);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Резервная копия StudySync',
          UTI: 'public.json',
        });
        toast.success('Файл копии передан. Храните его безопасно: внутри ваши учебные данные.');
      } else {
        toast.success(`Файл сохранён: ${file.uri}`);
      }
    } catch (e) {
      logger.error('data', 'Ошибка экспорта', e);
      toast.error('Не удалось выполнить экспорт');
    } finally {
      setBusy(null);
    }
  };

  const pickImportFile = async () => {
    setBusy('import');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) {
        setBusy(null);
        return;
      }
      const asset = result.assets[0]!;
      const file = new File(asset.uri);
      const text = await file.text();
      const backup = parseBackup(text);
      setPendingImport(backup);
      setImportMode('merge');
    } catch (e) {
      if (e instanceof BackupParseError) {
        toast.error(e.message + (e.issues.length > 0 ? `\n${e.issues.slice(0, 3).join('\n')}` : ''));
      } else {
        logger.error('data', 'Ошибка чтения файла импорта', e);
        toast.error('Не удалось прочитать файл');
      }
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (!pendingImport) return;
    setBusy('apply-import');
    try {
      const report = await importBackup(db, pendingImport, importMode);
      const restoredPhotos = pendingImport.data.lessonPhotos?.length
        ? await writePhotosBase64(pendingImport.data.lessonPhotos)
        : 0;
      await reloadSettings();
      await resyncAllNotifications(db, getNotificationClient());
      bump();
      setPendingImport(null);
      const parts = [
        `предметов: ${report.inserted.subjects}`,
        `задач: ${report.inserted.tasks}`,
        `событий: ${report.inserted.events}`,
        `сессий: ${report.inserted.studySessions}`,
        ...(report.inserted.debts > 0 ? [`долгов: ${report.inserted.debts}`] : []),
        ...(report.inserted.lessonNotes > 0 ? [`конспектов: ${report.inserted.lessonNotes}`] : []),
        ...(restoredPhotos > 0 ? [`фото: ${restoredPhotos}`] : []),
      ];
      toast.success(`Импорт завершён (${importMode === 'replace' ? 'замена' : 'слияние'}) — ${parts.join(', ')}`);
      if (report.duplicatesSkipped > 0) {
        toast.info(`Пропущено дубликатов: ${report.duplicatesSkipped}`);
      }
      if (report.warnings.length > 0) {
        toast.info(`Предупреждений: ${report.warnings.length}. ${report.warnings[0]}`);
      }
      await loadBackups();
    } catch (e) {
      logger.error('data', 'Ошибка импорта', e);
      toast.error('Импорт прерван, исходные данные не изменены');
    } finally {
      setBusy(null);
    }
  };

  const doWipe = async () => {
    setBusy('wipe');
    try {
      const { internalBackupId } = await wipeAllData(db);
      logger.info('data', 'Выполнен сброс данных', { internalBackupId });
      await reloadSettings();
      await resyncAllNotifications(db, getNotificationClient());
      bump();
      setConfirmWipe(false);
      setConfirmWipeFinal(false);
      toast.success('Данные удалены. Внутренняя копия сохранена и доступна для восстановления.');
      await loadBackups();
    } catch (e) {
      logger.error('data', 'Ошибка сброса данных', e);
      toast.error('Не удалось выполнить сброс');
    } finally {
      setBusy(null);
    }
  };

  const restoreBackup = async (id: string) => {
    setBusy('restore');
    try {
      await restoreInternalBackup(db, id);
      await reloadSettings();
      await resyncAllNotifications(db, getNotificationClient());
      bump();
      toast.success('Данные восстановлены из внутренней копии');
      await loadBackups();
    } catch (e) {
      logger.error('data', 'Ошибка восстановления', e);
      toast.error('Не удалось восстановить копию');
    } finally {
      setBusy(null);
    }
  };

  const removeBackup = async (id: string) => {
    await deleteInternalBackup(db, id);
    toast.info('Копия удалена');
    await loadBackups();
  };

  const backupSummary = pendingImport
    ? [
        `предметов: ${pendingImport.data.subjects.length}`,
        `задач: ${pendingImport.data.tasks.length}`,
        `событий: ${pendingImport.data.events.length}`,
        `сессий: ${pendingImport.data.studySessions.length}`,
        `целей: ${pendingImport.data.goals.length}`,
      ].join('\n')
    : '';

  return (
    <Screen testID="data-screen">
      <ScreenHeader title="Данные" testID="data-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        <Card style={{ backgroundColor: colors.infoSoft }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.info} />
            <Text style={{ color: colors.text, fontSize: fontSizes.sm, flex: 1, lineHeight: 19 }}>
              Все данные хранятся только на устройстве (SQLite, версия приложения {APP_VERSION}).
              Экспортированный JSON содержит ваши учебные записи и может включать личные сведения —
              храните файл копии так же бережно, как дневник.
            </Text>
          </View>
        </Card>

        <SectionTitle title="Экспорт" />
        <Card>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19, marginBottom: spacing.md }}>
            Создать JSON-файл со всеми данными: предметы, задачи, подзадачи, события, учебные сессии,
            цели, долги, конспекты и настройки. Фото конспектов можно включить по желанию. Файл можно открыть системным диалогом «Поделиться» (сохранить в файлы,
            отправить себе в мессенджер и т.д.).
          </Text>
          <Button
            testID="data-export"
            title="Экспортировать данные"
            icon="download-outline"
            loading={busy === 'export'}
            onPress={() => void startExport()}
          />
        </Card>

        <SectionTitle title="Импорт" />
        <Card>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19, marginBottom: spacing.md }}>
            Загрузить резервную копию StudySync. Файл проверяется: структура, версия формата,
            обязательные поля и связи. Импорт выполняется в транзакции — при ошибке данные останутся целыми.
          </Text>
          <Button
            testID="data-import"
            title="Выбрать файл и импортировать"
            icon="cloud-upload-outline"
            variant="secondary"
            loading={busy === 'import'}
            onPress={() => void pickImportFile()}
          />
        </Card>

        <SectionTitle title="Внутренние резервные копии" />
        <Card>
          {backups == null ? (
            <Spinner />
          ) : backups.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
              Внутренних копий пока нет. Они создаются автоматически перед импортом с заменой и перед сбросом данных.
            </Text>
          ) : (
            backups.map((b) => (
              <View key={b.id} style={[styles.backupRow, { borderBottomColor: colors.borderSoft }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '600' }}>
                    {formatDateFull(b.createdAt)}, {formatTime(b.createdAt)}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                    {b.reason === 'user-reset'
                      ? 'перед сбросом данных'
                      : b.reason.startsWith('auto-before-import')
                        ? 'перед импортом'
                        : b.reason}{' '}
                    · {(b.sizeBytes / 1024).toFixed(1)} КБ
                  </Text>
                </View>
                <Button
                  title="Восстановить"
                  size="sm"
                  variant="secondary"
                  loading={busy === 'restore'}
                  onPress={() => void restoreBackup(b.id)}
                />
                <IconButton
                  icon="trash-outline"
                  accessibilityLabel="Удалить внутреннюю копию"
                  color={colors.textMuted}
                  onPress={() => void removeBackup(b.id)}
                />
              </View>
            ))
          )}
        </Card>

        <SectionTitle title="Опасная зона" />
        <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19, marginBottom: spacing.md }}>
            Полный сброс удалит все предметы, задачи, события, сессии и цели, вернув настройки к исходным.
            Перед сбросом автоматически создаётся внутренняя резервная копия — её можно восстановить здесь же.
          </Text>
          <Button
            testID="data-wipe"
            title="Удалить все данные"
            icon="warning-outline"
            variant="danger"
            loading={busy === 'wipe'}
            onPress={() => setConfirmWipe(true)}
          />
        </Card>
        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {/* Подтверждение импорта */}
      <BottomSheet
        visible={pendingImport != null}
        title="Импортировать копию?"
        onClose={() => setPendingImport(null)}
        testID="import-sheet"
      >
        {pendingImport ? (
          <View style={{ paddingBottom: 16 }}>
            <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 }}>
              Файл от {formatDateFull(pendingImport.exportedAt)} (формат v{pendingImport.formatVersion},
              приложение {pendingImport.appVersion ?? 'не указано'}).{'\n'}
              {backupSummary}
            </Text>
            <View style={{ height: spacing.md }} />
            <View style={[styles.modeBox, { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderColor: importMode === 'merge' ? colors.primary : colors.border }]}>
              <Button
                title="Слияние"
                variant={importMode === 'merge' ? 'primary' : 'ghost'}
                size="sm"
                onPress={() => setImportMode('merge')}
              />
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 18, flex: 1 }}>
                Добавить недостающие записи. Существующие (с теми же ID) будут пропущены как дубликаты.
              </Text>
            </View>
            <View style={[styles.modeBox, { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderColor: importMode === 'replace' ? colors.danger : colors.border, marginTop: spacing.sm }]}>
              <Button
                title="Замена"
                variant={importMode === 'replace' ? 'danger' : 'ghost'}
                size="sm"
                onPress={() => setImportMode('replace')}
              />
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 18, flex: 1 }}>
                Текущие данные будут заменены данными файла. Перед заменой автоматически создаётся внутренняя копия.
              </Text>
            </View>
            <View style={{ height: spacing.lg }} />
            <Button
              testID="import-confirm"
              title={importMode === 'replace' ? 'Заменить данные' : 'Импортировать'}
              size="lg"
              loading={busy === 'apply-import'}
              onPress={() => void doImport()}
            />
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={photoQuestion != null} title="Фото конспектов" onClose={() => setPhotoQuestion(null)} testID="export-photos-sheet">
        {photoQuestion ? (
          <View style={{ gap: 10, paddingBottom: 12 }}>
            <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 }}>
              В конспектах {photoQuestion.count} фото (≈ {formatMegabytes(photoQuestion.bytes)}). С фото файл копии будет больше,
              без фото — только текст конспектов.
            </Text>
            <Button testID="export-with-photos" title={`С фото (≈ ${formatMegabytes(photoQuestion.bytes * 1.37)})`} icon="images-outline" onPress={() => void doExport(true)} />
            <Button testID="export-without-photos" title="Без фото" variant="secondary" icon="document-outline" onPress={() => void doExport(false)} />
            <Button title="Отмена" variant="ghost" onPress={() => setPhotoQuestion(null)} />
          </View>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmWipe}
        title="Удалить все данные?"
        message="Будут удалены все предметы, задачи, события, сессии и цели. Настройки вернутся к значениям по умолчанию. Автоматически создаётся внутренняя резервная копия."
        confirmLabel="Продолжить"
        cancelLabel="Отмена"
        danger
        onConfirm={() => {
          setConfirmWipe(false);
          setConfirmWipeFinal(true);
        }}
        onCancel={() => setConfirmWipe(false)}
      />
      <ConfirmDialog
        visible={confirmWipeFinal}
        title="Точно удалить?"
        message="Это действие затронет все ваши учебные данные на этом устройстве. Отменить его можно будет только восстановлением из внутренней копии."
        confirmLabel="Да, удалить всё"
        cancelLabel="Нет, оставить"
        danger
        testID="wipe-final-confirm"
        onConfirm={() => void doWipe()}
        onCancel={() => setConfirmWipeFinal(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1.5,
  },
});

/** «1,4 МБ» / «350 КБ». */
function formatMegabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
}
