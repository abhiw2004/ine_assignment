import { createClient } from '@supabase/supabase-js';
import { config, hasDb } from '../config.js';
import { logger } from '../util/logger.js';

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
