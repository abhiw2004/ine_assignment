const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = meta === undefined
    ? `[${ts()}] ${level.toUpperCase()} ${msg}`
    : `[${ts()}] ${level.toUpperCase()} ${msg} ${safe(meta)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function safe(meta) {
  try {
    return typeof meta === 'string' ? meta : JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const logger = {
  debug: (m, x) => emit('debug', m, x),
  info: (m, x) => emit('info', m, x),
  warn: (m, x) => emit('warn', m, x),
  error: (m, x) => emit('error', m, x),
};
