/** Build-time configuration. Only public values belong here. */

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? '';

export const SUPABASE_URL = rawUrl;
export const SUPABASE_ANON_KEY = rawKey;

/** True only when a real project URL and key were supplied. */
export const IS_CONFIGURED =
  /^https?:\/\/.+/.test(rawUrl) &&
  rawKey.length > 20 &&
  !rawUrl.includes('YOUR-PROJECT') &&
  !rawKey.includes('your-');

export const APP_ORIGIN = (import.meta.env.VITE_APP_URL as string | undefined)?.trim() || window.location.origin;

export const OWNER_EMAIL = 'anishrajb21@gmail.com';
export const APP_VERSION = '1.0.0';
