import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config, hasDb } from '../config.js';
import { logger } from '../util/logger.js';

// Node 22+ ships a native global WebSocket; older runtimes (e.g. the Node 20 in
// our Playwright Docker image on Render) do not. @supabase/supabase-js builds its
// realtime client eagerly and requires a WebSocket implementation, so polyfill the
// global when it is missing. Node 22+ keeps its native implementation untouched.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

let supabase = null;

export function db() {
  if (!hasDb) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.'
    );
  }
  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    logger.info('Supabase client initialised');
  }
  return supabase;
}

export function dbReady() {
  return hasDb;
}

/** Unwrap a supabase-js {data,error} pair into data or throw. */
export function unwrap(res, ctx = 'query') {
  if (res.error) {
    const e = new Error(`${ctx}: ${res.error.message}`);
    e.details = res.error;
    throw e;
  }
  return res.data;
}
