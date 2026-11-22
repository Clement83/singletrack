import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listMusic, musicFile, musicTitle } from '@/lib/outings/music';

describe('musique de fond de l’instance (#1706)', () => {
  it('titre lisible depuis le nom de fichier', () => {
    expect(musicTitle('night-summer-lounge-473222.mp3')).toBe('night summer lounge');
    expect(musicTitle('Piratos_by_Wowa_Chris_Rede.mp3')).toBe('Piratos by Wowa Chris Rede');
    expect(musicTitle('Hangtime.mp3')).toBe('Hangtime');
  });
  it('liste triée des fichiers audio, le reste ignoré ; dossier absent ⇒ aucune', () => {
    const dir = mkdtempSync(join(tmpdir(), 'music-'));
    for (const f of ['b.mp3', 'a.ogg', 'README.md', '.cache.mp3', 'c.WAV']) writeFileSync(join(dir, f), 'x');
    expect(listMusic(dir)).toEqual([{ id: 0, title: 'a' }, { id: 1, title: 'b' }, { id: 2, title: 'c' }]);
    expect(musicFile(1, dir)).toMatchObject({ path: join(dir, 'b.mp3'), type: 'audio/mpeg', size: 1 });
    expect(musicFile(3, dir)).toBeNull();
    expect(musicFile(-1, dir)).toBeNull();
    expect(musicFile(Number('../x'), dir)).toBeNull();
    expect(listMusic(join(dir, 'absent'))).toEqual([]);
  });
});
