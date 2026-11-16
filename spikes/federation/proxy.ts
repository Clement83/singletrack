import { fedifyWith } from '@fedify/next';
import { federation } from './federation';
export const proxy = fedifyWith(federation)();
export const config = { matcher: ['/.well-known/:path*', '/ap/:path*', '/nodeinfo/:path*'] };
