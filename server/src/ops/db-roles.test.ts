import { afterEach, describe, expect, it } from 'vitest';
import { asOwner, migrateAsOwner, migrateUrl, runtimeRole } from './db-roles.ts';

const KEYS = ['GRC_DATABASE_URL', 'GRC_DATABASE_URL_FILE', 'GRC_DATABASE_PASSWORD', 'GRC_DATABASE_PASSWORD_FILE', 'GRC_DATABASE_MIGRATE_URL', 'GRC_DATABASE_MIGRATE_PASSWORD', 'GRC_DATABASE_APP_ROLE'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('owner and run-time accounts (E16-31)', () => {
  it('names the run-time role from the server URL or GRC_DATABASE_APP_ROLE', () => {
    for (const k of KEYS) delete process.env[k];
    expect(migrateUrl()).toBeUndefined();
    expect(runtimeRole()).toBeUndefined();
    process.env.GRC_DATABASE_URL = 'postgres://grc_app@db.example.test:5432/grc';
    expect(runtimeRole()).toBe('grc_app');
    process.env.GRC_DATABASE_APP_ROLE = 'grc_runtime';
    expect(runtimeRole()).toBe('grc_runtime');
  });

  it('points the database settings at the owner only while the work runs', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.GRC_DATABASE_URL = 'postgres://grc_app@db.example.test/grc';
    process.env.GRC_DATABASE_PASSWORD_FILE = '/run/secrets/app_password';
    process.env.GRC_DATABASE_MIGRATE_URL = 'postgres://grc_owner@db.example.test/grc';
    process.env.GRC_DATABASE_MIGRATE_PASSWORD = 'owner-password-for-tests';
    const seen = await asOwner(async () => ({
      url: process.env.GRC_DATABASE_URL, password: process.env.GRC_DATABASE_PASSWORD, file: process.env.GRC_DATABASE_PASSWORD_FILE,
    }));
    expect(seen).toEqual({ url: 'postgres://grc_owner@db.example.test/grc', password: 'owner-password-for-tests', file: undefined });
    expect(process.env.GRC_DATABASE_URL).toBe('postgres://grc_app@db.example.test/grc');
    expect(process.env.GRC_DATABASE_PASSWORD).toBeUndefined();
    expect(process.env.GRC_DATABASE_PASSWORD_FILE).toBe('/run/secrets/app_password');
    // Put back even when the work fails.
    await expect(asOwner(async () => { throw new Error('migration failed'); })).rejects.toThrow('migration failed');
    expect(process.env.GRC_DATABASE_URL).toBe('postgres://grc_app@db.example.test/grc');
  });

  it('does nothing without an owner account, and refuses one without a database server', async () => {
    for (const k of KEYS) delete process.env[k];
    const build = async () => { throw new Error('should not build'); };
    expect(await migrateAsOwner('memory', build)).toBeNull();
    process.env.GRC_DATABASE_MIGRATE_URL = 'postgres://grc_owner@db.example.test/grc';
    await expect(migrateAsOwner('memory', build)).rejects.toThrow(/GRC_DATABASE_URL/);
  });
});
