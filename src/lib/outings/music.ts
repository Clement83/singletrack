import { createReadStream, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Background music of the summary export (#1706). Files live in a folder **of the instance** (`SUMMARY_MUSIC_DIR`,
 * default `music/` next to the database), never in the repository: free-to-use tracks (Unminus, Pixabay…) usually
 * allow use inside a video but not redistributing the file itself.
 */
export type MusicTrack = { id: number; title: string };

const TYPES: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };

export function musicDir(): string {
  return process.env.SUMMARY_MUSIC_DIR || join(dirname(process.env.DATABASE_URL || './data/singletrack.db'), 'music');
}

/** Audio files of the folder, sorted by name (the index is the id). Missing folder ⇒ no music. */
function files(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.') && TYPES[extname(f).toLowerCase()]).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Readable title from a file name: no extension, no trailing catalogue number, separators as spaces. */
export function musicTitle(file: string): string {
  return file
    .slice(0, file.length - extname(file).length)
    .replace(/[-_]+\d{4,}$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function listMusic(dir = musicDir()): MusicTrack[] {
  return files(dir).map((f, id) => ({ id, title: musicTitle(f) }));
}

/** File of track `id`, `null` if unknown. Only names read from the folder are joined: no forged path. */
export function musicFile(id: number, dir = musicDir()): { path: string; type: string; size: number } | null {
  const f = Number.isInteger(id) && id >= 0 ? files(dir)[id] : undefined;
  if (!f) return null;
  const path = join(dir, f);
  return { path, type: TYPES[extname(f).toLowerCase()], size: statSync(path).size };
}

export function musicStream(path: string): ReadableStream {
  return Readable.toWeb(createReadStream(path)) as ReadableStream;
}
