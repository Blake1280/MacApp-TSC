import log from 'electron-log/main';
import { app } from 'electron';
import { join } from 'node:path';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.fileName = 'inventory.log';

// Pin the log location explicitly. Packaged builds were writing nothing —
// the default path resolution failed silently — which made the July 2026
// database-corruption investigations needlessly blind. userData is always
// resolvable by the time anything logs.
log.transports.file.resolvePathFn = () =>
  join(app.getPath('userData'), 'logs', 'inventory.log');

export const logger = log;
