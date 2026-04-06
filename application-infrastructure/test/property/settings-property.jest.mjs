/**
 * Property-based tests for config/settings.js
 *
 * Feature: 0-0-1-initial-project, Property 11: Settings module environment variable resolution
 *
 * Validates: Requirements 9.6, 15.2
 *
 * Uses fast-check to generate random combinations of env vars being set or unset.
 * For each combination, dynamically imports settings with cache busting and verifies:
 * - When an env var is set, the corresponding setting equals the parsed env var value
 * - When an env var is not set, the corresponding setting equals the defined default value
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fc from 'fast-check';

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
  const mod = await import(`${SETTINGS_PATH}?prop=${id}`);
  return mod.default;
}

let counter = 0;
function nextId() {
  return ++counter;
}

describe('Property 11: Settings module environment variable resolution', () => {
  // **Validates: Requirements 9.6, 15.2**

  it('should resolve each env var to its parsed value when set, or to the default when unset', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.constantFrom('true', 'false'), { nil: undefined }),
        fc.option(fc.string().filter(s => s.length > 0), { nil: undefined }),
        fc.option(fc.integer({ min: 1, max: 100000000 }), { nil: undefined }),
        fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
        fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,6}[a-z0-9]$/), { nil: undefined }),
        fc.option(fc.string(), { nil: undefined }),
        async (
          createWebpOpt,
          imageOutputBasePrefixOpt,
          maxImageFileSizeOpt,
          logLevelOpt,
          stageIdOpt,
          sourceBucketOpt
        ) => {
          // Set or delete each env var based on the generated option
          if (createWebpOpt !== undefined) {
            process.env.CREATE_WEBP_VERSION = createWebpOpt;
          } else {
            delete process.env.CREATE_WEBP_VERSION;
          }

          if (imageOutputBasePrefixOpt !== undefined) {
            process.env.IMAGE_OUTPUT_BASE_PREFIX = imageOutputBasePrefixOpt;
          } else {
            delete process.env.IMAGE_OUTPUT_BASE_PREFIX;
          }

          if (maxImageFileSizeOpt !== undefined) {
            process.env.MAX_IMAGE_FILE_SIZE = String(maxImageFileSizeOpt);
          } else {
            delete process.env.MAX_IMAGE_FILE_SIZE;
          }

          if (logLevelOpt !== undefined) {
            process.env.LOG_LEVEL = String(logLevelOpt);
          } else {
            delete process.env.LOG_LEVEL;
          }

          if (stageIdOpt !== undefined) {
            process.env.STAGE_ID = stageIdOpt;
          } else {
            delete process.env.STAGE_ID;
          }

          if (sourceBucketOpt !== undefined) {
            process.env.SOURCE_BUCKET = sourceBucketOpt;
          } else {
            delete process.env.SOURCE_BUCKET;
          }

          const settings = await loadSettings(nextId());

          // CREATE_WEBP_VERSION
          if (createWebpOpt !== undefined) {
            expect(settings.createWebpVersion).toBe(createWebpOpt === 'true');
          } else {
            expect(settings.createWebpVersion).toBe(true);
          }

          // IMAGE_OUTPUT_BASE_PREFIX
          // The implementation uses `|| default`, so empty string falls back to default
          if (imageOutputBasePrefixOpt !== undefined) {
            expect(settings.imageOutputBasePrefix).toBe(imageOutputBasePrefixOpt);
          } else {
            expect(settings.imageOutputBasePrefix).toBe('/{stageId}/public/images');
          }

          // MAX_IMAGE_FILE_SIZE
          // The implementation uses `parseInt(val, 10) || 26214400`
          // Since we generate min: 1, parseInt will always be truthy
          if (maxImageFileSizeOpt !== undefined) {
            expect(settings.maxImageFileSize).toBe(maxImageFileSizeOpt);
          } else {
            expect(settings.maxImageFileSize).toBe(26214400);
          }

          // LOG_LEVEL
          // The implementation uses `parseInt(val, 10) || 0`
          // parseInt('0') is 0 which is falsy, so 0 || 0 = 0 (matches default)
          if (logLevelOpt !== undefined) {
            if (logLevelOpt === 0) {
              // 0 is falsy, so parseInt('0') || 0 = 0, which is the default anyway
              expect(settings.logLevel).toBe(0);
            } else {
              expect(settings.logLevel).toBe(logLevelOpt);
            }
          } else {
            expect(settings.logLevel).toBe(0);
          }

          // STAGE_ID
          // The implementation uses `|| ''`, so empty string falls back to default ''
          if (stageIdOpt !== undefined) {
            expect(settings.stageId).toBe(stageIdOpt);
          } else {
            expect(settings.stageId).toBe('');
          }

          // SOURCE_BUCKET
          // The implementation uses `|| ''`, so empty string falls back to default ''
          if (sourceBucketOpt !== undefined) {
            if (sourceBucketOpt === '') {
              // Empty string is falsy, so '' || '' = ''
              expect(settings.sourceBucket).toBe('');
            } else {
              expect(settings.sourceBucket).toBe(sourceBucketOpt);
            }
          } else {
            expect(settings.sourceBucket).toBe('');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
