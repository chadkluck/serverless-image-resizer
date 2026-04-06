/**
 * Unit tests for config/settings.js
 *
 * Since settings.js reads process.env at module load time and exports a frozen
 * object, each test case dynamically imports the module with a unique cache-busting
 * query parameter to force re-evaluation with the desired env vars.
 *
 * Validates: Requirements 15.2, 15.3
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const SETTINGS_PATH = '../../src/lambda/functions/processor/config/settings.js';

/** Saved copy of process.env restored after each test. */
let savedEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
});

/**
 * Dynamically import settings with a unique query string so Node treats it as
 * a fresh module and re-reads process.env.
 *
 * @param {number} id - Unique identifier for cache busting
 * @returns {Promise<Object>} The default export (settings object)
 */
async function loadSettings(id) {
  const mod = await import(`${SETTINGS_PATH}?v=${id}`);
  return mod.default;
}

let counter = 0;
function nextId() {
  return ++counter;
}

describe('Settings module', () => {
  describe('default values (env vars unset)', () => {
    it('should default createWebpVersion to true', async () => {
      delete process.env.CREATE_WEBP_VERSION;
      const settings = await loadSettings(nextId());
      expect(settings.createWebpVersion).toBe(true);
    });

    it('should default imageOutputBasePrefix to /{stageId}/public/images', async () => {
      delete process.env.IMAGE_OUTPUT_BASE_PREFIX;
      const settings = await loadSettings(nextId());
      expect(settings.imageOutputBasePrefix).toBe('/{stageId}/public/images');
    });

    it('should default maxImageFileSize to 26214400', async () => {
      delete process.env.MAX_IMAGE_FILE_SIZE;
      const settings = await loadSettings(nextId());
      expect(settings.maxImageFileSize).toBe(26214400);
    });

    it('should default logLevel to 0', async () => {
      delete process.env.LOG_LEVEL;
      const settings = await loadSettings(nextId());
      expect(settings.logLevel).toBe(0);
    });

    it('should default stageId to empty string', async () => {
      delete process.env.STAGE_ID;
      const settings = await loadSettings(nextId());
      expect(settings.stageId).toBe('');
    });

    it('should default sourceBucket to empty string', async () => {
      delete process.env.SOURCE_BUCKET;
      const settings = await loadSettings(nextId());
      expect(settings.sourceBucket).toBe('');
    });
  });

  describe('env var parsing', () => {
    it('should parse CREATE_WEBP_VERSION "true" as true', async () => {
      process.env.CREATE_WEBP_VERSION = 'true';
      const settings = await loadSettings(nextId());
      expect(settings.createWebpVersion).toBe(true);
    });

    it('should parse CREATE_WEBP_VERSION "false" as false', async () => {
      process.env.CREATE_WEBP_VERSION = 'false';
      const settings = await loadSettings(nextId());
      expect(settings.createWebpVersion).toBe(false);
    });

    it('should parse MAX_IMAGE_FILE_SIZE string number as number', async () => {
      process.env.MAX_IMAGE_FILE_SIZE = '5242880';
      const settings = await loadSettings(nextId());
      expect(settings.maxImageFileSize).toBe(5242880);
    });

    it('should parse LOG_LEVEL string number as number', async () => {
      process.env.LOG_LEVEL = '3';
      const settings = await loadSettings(nextId());
      expect(settings.logLevel).toBe(3);
    });

    it('should read STAGE_ID as string', async () => {
      process.env.STAGE_ID = 'prod';
      const settings = await loadSettings(nextId());
      expect(settings.stageId).toBe('prod');
    });

    it('should read SOURCE_BUCKET as string', async () => {
      process.env.SOURCE_BUCKET = 'my-source-bucket';
      const settings = await loadSettings(nextId());
      expect(settings.sourceBucket).toBe('my-source-bucket');
    });

    it('should read IMAGE_OUTPUT_BASE_PREFIX as string', async () => {
      process.env.IMAGE_OUTPUT_BASE_PREFIX = '/custom/prefix';
      const settings = await loadSettings(nextId());
      expect(settings.imageOutputBasePrefix).toBe('/custom/prefix');
    });
  });

  describe('static size thresholds', () => {
    it('should have correct size values', async () => {
      const settings = await loadSettings(nextId());
      expect(settings.sizes).toEqual({
        xxLarge: 3000,
        xLarge: 1920,
        large: 1000,
        medium: 800,
        small: 500,
        thumb: 250
      });
    });
  });

  describe('frozen object', () => {
    it('should be frozen at the top level', async () => {
      const settings = await loadSettings(nextId());
      expect(Object.isFrozen(settings)).toBe(true);
    });

    it('should have a frozen sizes object', async () => {
      const settings = await loadSettings(nextId());
      expect(Object.isFrozen(settings.sizes)).toBe(true);
    });

    it('should not allow modification of top-level properties', async () => {
      const settings = await loadSettings(nextId());
      expect(() => { settings.logLevel = 99; }).toThrow();
    });

    it('should not allow modification of sizes properties', async () => {
      const settings = await loadSettings(nextId());
      expect(() => { settings.sizes.xxLarge = 9999; }).toThrow();
    });

    it('should not allow adding new properties', async () => {
      const settings = await loadSettings(nextId());
      expect(() => { settings.newProp = 'test'; }).toThrow();
    });
  });
});
