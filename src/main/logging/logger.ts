import log from 'electron-log/main';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.fileName = 'inventory.log';

export const logger = log;
