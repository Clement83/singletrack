import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { meta } from '@/db/schema';

describe('db', () => {
  it('applique les migrations et lit/écrit la table meta', () => {
    const { db, sqlite } = openDb(':memory:');
    db.insert(meta).values({ key: 'schema', value: '1' }).run();
    expect(db.select().from(meta).all()[0].value).toBe('1');
    sqlite.close();
  });
});
