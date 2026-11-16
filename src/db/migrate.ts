import { openDb } from './index';

const { sqlite } = openDb();
sqlite.close();
console.log('Migrations appliquées.');
