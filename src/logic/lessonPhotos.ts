/**
 * Фото конспектов: хранение в каталоге приложения, сжатие, base64 для резервной копии.
 * Только для мобильной среды (expo-file-system, expo-image-manipulator).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { newId } from '../core/id';
import { logger } from '../core/logger';

/** Длинная сторона после сжатия: текст на доске читается, файл ~200–500 КБ. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_QUALITY = 0.6;

function photosDir(): Directory {
  const dir = new Directory(Paths.document, 'lesson-notes');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function photoFile(name: string): File {
  return new File(photosDir(), name);
}

export function photoUri(name: string): string {
  return photoFile(name).uri;
}

/** Сжать снимок и сохранить в каталог конспектов. Возвращает имя файла. */
export async function storePhoto(sourceUri: string, width?: number, height?: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(sourceUri);
  const longSide = Math.max(width ?? 0, height ?? 0);
  if (!longSide || longSide > PHOTO_MAX_SIDE) {
    ctx.resize((width ?? 0) >= (height ?? 0) ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: PHOTO_QUALITY, format: SaveFormat.JPEG });
  const name = `${newId()}.jpg`;
  new File(saved.uri).moveSync(photoFile(name));
  return name;
}

export function deletePhoto(name: string): void {
  try {
    const f = photoFile(name);
    if (f.exists) f.delete();
  } catch (error) {
    logger.warn('notes', 'Не удалось удалить фото конспекта', { name, error });
  }
}

export function photosSizeBytes(names: string[]): number {
  let total = 0;
  for (const n of names) {
    const f = photoFile(n);
    if (f.exists) total += f.size ?? 0;
  }
  return total;
}

/** Фото для резервной копии. Отсутствующие файлы пропускаются. */
export async function readPhotosBase64(names: string[]): Promise<Array<{ name: string; base64: string }>> {
  const out: Array<{ name: string; base64: string }> = [];
  for (const name of names) {
    const f = photoFile(name);
    if (!f.exists) continue;
    out.push({ name, base64: await f.base64() });
  }
  return out;
}

/** Восстановить фото из резервной копии (существующие файлы не перезаписываются). */
export async function writePhotosBase64(photos: Array<{ name: string; base64: string }>): Promise<number> {
  let written = 0;
  for (const p of photos) {
    const f = photoFile(p.name);
    if (f.exists) continue;
    f.create();
    await f.write(p.base64, { encoding: 'base64' });
    written += 1;
  }
  return written;
}
