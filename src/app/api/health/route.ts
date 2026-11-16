import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    getDb().sqlite.prepare('SELECT 1').get();
    return NextResponse.json({ status: 'ok', version: config.version });
  } catch (e) {
    return NextResponse.json({ status: 'error', message: String(e) }, { status: 503 });
  }
}
