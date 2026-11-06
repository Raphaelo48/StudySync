/**
 * Конспект к паре: фото доски/слайдов (камера или галерея, со сжатием),
 * текстовая заметка и отметка «важно к экзамену».
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button } from '../src/components/ui/primitives';
import { SwitchRow } from '../src/components/ui/inputs';
import { ConfirmDialog } from '../src/components/ui/overlays';
import { useDataVersion, useDatabase, useTheme, useToast } from '../src/state/AppContexts';
import { formatDateWithWeekday, formatTime } from '../src/core/time';
import { deletePhoto, photoUri, storePhoto } from '../src/logic/lessonPhotos';
import { logger } from '../src/core/logger';

const MAX_PHOTOS_PER_NOTE = 20;

export default function LessonNoteScreen() {
  const params = useLocalSearchParams<{ key: string; title: string; startAt: string; subjectId?: string }>();
  const lessonKey = params.key;
  const lessonTitle = params.title ?? 'Пара';
  const lessonStartAt = Number(params.startAt);
  const subjectId = params.subjectId ? params.subjectId : null;

  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const toast = useToast();
  const { bump } = useDataVersion();
  const { width } = useWindowDimensions();

  const [text, setText] = useState('');
  const [important, setImportant] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Фото, добавленные в этом сеансе: если выйти без сохранения — удаляем файлы.
  const addedThisSession = useRef<string[]>([]);
  const saved = useRef(false);

  useEffect(() => {
    void db.lessonNotes.getByKey(lessonKey).then((n) => {
      if (n) {
        setText(n.text);
        setImportant(n.important);
        setPhotos(n.photos);
      }
      setLoaded(true);
    });
    return () => {
      if (!saved.current) addedThisSession.current.forEach(deletePhoto);
    };
  }, [db, lessonKey]);

  const addPhotos = async (source: 'camera' | 'library') => {
    if (photos.length >= MAX_PHOTOS_PER_NOTE) {
      toast.info(`Не больше ${MAX_PHOTOS_PER_NOTE} фото на пару`);
      return;
    }
    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toast.error(source === 'camera' ? 'Нет доступа к камере — разрешите его в настройках телефона' : 'Нет доступа к галерее');
        return;
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsMultipleSelection: true,
              selectionLimit: MAX_PHOTOS_PER_NOTE - photos.length,
              quality: 1,
            });
      if (result.canceled) return;
      setAdding(true);
      const names: string[] = [];
      for (const asset of result.assets) {
        names.push(await storePhoto(asset.uri, asset.width, asset.height));
      }
      addedThisSession.current.push(...names);
      setPhotos((p) => [...p, ...names].slice(0, MAX_PHOTOS_PER_NOTE));
    } catch (error) {
      logger.error('notes', 'Не удалось добавить фото', error);
      toast.error('Не удалось добавить фото');
    } finally {
      setAdding(false);
    }
  };

  const removePhoto = (name: string) => {
    setPhotos((p) => p.filter((x) => x !== name));
    setToDelete(null);
    setViewer(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const before = await db.lessonNotes.getByKey(lessonKey);
      await db.lessonNotes.upsert({ subjectId, lessonKey, lessonTitle, lessonStartAt, text, important, photos });
      // Файлы фото, убранных из конспекта, больше не нужны.
      for (const name of [...(before?.photos ?? []), ...addedThisSession.current]) {
        if (!photos.includes(name)) deletePhoto(name);
      }
      saved.current = true;
      bump();
      toast.success(text.trim() || photos.length > 0 ? 'Конспект сохранён' : 'Пустой конспект удалён');
      router.back();
    } catch (error) {
      logger.error('notes', 'Не удалось сохранить конспект', error);
      toast.error('Не удалось сохранить конспект');
    } finally {
      setSaving(false);
    }
  };

  const thumb = Math.floor((width - spacing.lg * 2 - 16) / 3);
  const when = Number.isFinite(lessonStartAt) ? `${formatDateWithWeekday(lessonStartAt)}, ${formatTime(lessonStartAt)}` : '';

  return (
    <Screen testID="lesson-note-screen" keyboardAvoiding>
      <ScreenHeader title="Конспект" subtitle={`${lessonTitle}${when ? ` · ${when}` : ''}`} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={styles.actions}>
          <Button title="Сфотографировать" icon="camera-outline" variant="secondary" onPress={() => void addPhotos('camera')} style={{ flex: 1 }} loading={adding} testID="note-camera" />
          <Button title="Из галереи" icon="images-outline" variant="secondary" onPress={() => void addPhotos('library')} style={{ flex: 1 }} testID="note-library" />
        </View>

        {photos.length > 0 ? (
          <View style={[styles.grid, { marginTop: spacing.md }]}>
            {photos.map((name, i) => (
              <Pressable
                key={name}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Фото ${i + 1}, открыть`}
                onPress={() => setViewer(name)}
                onLongPress={() => setToDelete(name)}
                style={{ width: thumb, height: thumb, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}
              >
                <Image source={{ uri: photoUri(name) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить фото ${i + 1}`}
                  onPress={() => setToDelete(name)}
                  hitSlop={6}
                  style={styles.thumbDelete}
                >
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </Pressable>
            ))}
          </View>
        ) : loaded ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: spacing.md }}>
            Сфотографируйте доску или слайд — фото сожмутся, чтобы не занимать много места.
          </Text>
        ) : null}

        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginTop: spacing.lg, marginBottom: 6 }}>
          Заметка
        </Text>
        <TextInput
          testID="note-text"
          value={text}
          onChangeText={setText}
          placeholder="Главное с пары, задание на дом, что спросят на экзамене…"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={20000}
          textAlignVertical="top"
          style={[
            styles.textArea,
            { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radii.md, fontSize: fontSizes.md },
          ]}
        />

        <SwitchRow testID="note-important" label="Важно к экзамену" description="Попадёт в подборку «Важное» по предмету" value={important} onValueChange={setImportant} />

        <View style={{ height: spacing.lg }} />
        <Button testID="note-save" title="Сохранить" icon="checkmark" size="lg" loading={saving} onPress={() => void save()} />
      </ScrollView>

      <Modal visible={viewer != null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          {viewer ? <Image source={{ uri: photoUri(viewer) }} style={styles.viewerImage} resizeMode="contain" /> : null}
          <View style={styles.viewerBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Удалить фото" onPress={() => viewer && setToDelete(viewer)} hitSlop={10}>
              <Ionicons name="trash-outline" size={24} color="#fff" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setViewer(null)} hitSlop={10}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={toDelete != null}
        title="Удалить фото?"
        message="Фото уберётся из конспекта после сохранения."
        confirmLabel="Удалить"
        danger
        onConfirm={() => toDelete && removePhoto(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbDelete: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textArea: { minHeight: 140, borderWidth: 1, padding: 12, marginBottom: 12 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerBar: { position: 'absolute', top: 48, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between' },
});
