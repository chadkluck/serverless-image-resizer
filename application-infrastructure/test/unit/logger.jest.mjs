/**
 * Unit tests for utils/logger.js
 *
 * Since logger.js imports settings (which reads process.env at module load time),
 * we use jest.unstable_mockModule to mock the settings module before dynamically
 * importing the logger. Each describe block loads logger with a specific logLevel
 * to test filtering behaviour.
 *
 * Validates: Requirements 14.1, 14.2, 14.3
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * Helper: mock settings with a given logLevel and dynamically import logger.
 *
 * @param {number} logLevel - The log level to configure
 * @returns {Promise<Object>} The default export (logger object)
 */
async function loadLoggerWithLevel(logLevel) {
  jest.unstable_mockModule(
    '../../src/lambda/functions/processor/config/settings.js',
    () => ({
      default: Object.freeze({
        sizes: Object.freeze({
          xxLarge: 3000, xLarge: 1920, large: 1000,
          medium: 800, small: 500, thumb: 250
        }),
        createWebpVersion: true,
        imageOutputBasePrefix: '/{stageId}/public/images',
        maxImageFileSize: 26214400,
        logLevel,
        stageId: '',
        sourceBucket: ''
      })
    })
  );

  const mod = await import(
    `../../src/lambda/functions/processor/utils/logger.js?lvl=${logLevel}-${Date.now()}`
  );
  return mod.default;
}

describe('Logger module', () => {
  let spyError;
  let spyWarn;
  let spyLog;

  beforeEach(() => {
    spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
    spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    spyLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('log level filtering', () => {
    it('should only output error() when logLevel is 0', async () => {
      const logger = await loadLoggerWithLevel(0);

      logger.error('test', 'error message');
      logger.warn('test', 'warn message');
      logger.info('test', 'info message');
      logger.debug('test', 'debug message');
      logger.trace('test', 'trace message');

      expect(spyError).toHaveBeenCalledTimes(1);
      expect(spyWarn).not.toHaveBeenCalled();
      expect(spyLog).not.toHaveBeenCalled();
    });

    it('should output error() and warn() when logLevel is 1', async () => {
      const logger = await loadLoggerWithLevel(1);

      logger.error('test', 'error message');
      logger.warn('test', 'warn message');
      logger.info('test', 'info message');
      logger.debug('test', 'debug message');
      logger.trace('test', 'trace message');

      expect(spyError).toHaveBeenCalledTimes(1);
      expect(spyWarn).toHaveBeenCalledTimes(1);
      expect(spyLog).not.toHaveBeenCalled();
    });

    it('should output error(), warn(), and info() when logLevel is 2', async () => {
      const logger = await loadLoggerWithLevel(2);

      logger.error('test', 'error message');
      logger.warn('test', 'warn message');
      logger.info('test', 'info message');
      logger.debug('test', 'debug message');
      logger.trace('test', 'trace message');

      expect(spyError).toHaveBeenCalledTimes(1);
      expect(spyWarn).toHaveBeenCalledTimes(1);
      expect(spyLog).toHaveBeenCalledTimes(1); // info only
    });

    it('should output error(), warn(), info(), and debug() when logLevel is 3', async () => {
      const logger = await loadLoggerWithLevel(3);

      logger.error('test', 'error message');
      logger.warn('test', 'warn message');
      logger.info('test', 'info message');
      logger.debug('test', 'debug message');
      logger.trace('test', 'trace message');

      expect(spyError).toHaveBeenCalledTimes(1);
      expect(spyWarn).toHaveBeenCalledTimes(1);
      expect(spyLog).toHaveBeenCalledTimes(2); // info + debug
    });

    it('should output all methods when logLevel is 5', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.error('test', 'error message');
      logger.warn('test', 'warn message');
      logger.info('test', 'info message');
      logger.debug('test', 'debug message');
      logger.trace('test', 'trace message');

      expect(spyError).toHaveBeenCalledTimes(1);
      expect(spyWarn).toHaveBeenCalledTimes(1);
      expect(spyLog).toHaveBeenCalledTimes(3); // info + debug + trace
    });
  });

  describe('structured output format', () => {
    it('should output valid JSON with required fields', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('resize', 'Generated variants');

      expect(spyLog).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(spyLog.mock.calls[0][0]);

      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('level', 'INFO');
      expect(entry).toHaveProperty('action', 'resize');
      expect(entry).toHaveProperty('message', 'Generated variants');
      expect(entry).toHaveProperty('requestId');
      expect(entry).toHaveProperty('sourceKey');
      expect(entry).toHaveProperty('outputBucket');
    });

    it('should include a valid ISO 8601 timestamp', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('test', 'timestamp check');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      const parsed = new Date(entry.timestamp);
      expect(parsed.toISOString()).toBe(entry.timestamp);
    });
  });

  describe('context fields via setContext', () => {
    it('should include context fields in log entries after setContext', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.setContext({
        requestId: 'req-abc-123',
        sourceKey: 'uploads/photo.jpg',
        outputBucket: 'dest-bucket'
      });

      logger.info('resize', 'Processing image');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry.requestId).toBe('req-abc-123');
      expect(entry.sourceKey).toBe('uploads/photo.jpg');
      expect(entry.outputBucket).toBe('dest-bucket');
    });

    it('should default context fields to empty strings when not set', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('test', 'no context');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry.requestId).toBe('');
      expect(entry.sourceKey).toBe('');
      expect(entry.outputBucket).toBe('');
    });
  });

  describe('each log method outputs at the correct level', () => {
    it('error() should output with level ERROR via console.error', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.error('tagValidation', 'Missing tag');

      expect(spyError).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(spyError.mock.calls[0][0]);
      expect(entry.level).toBe('ERROR');
      expect(entry.action).toBe('tagValidation');
      expect(entry.message).toBe('Missing tag');
    });

    it('warn() should output with level WARN via console.warn', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.warn('authorization', 'Bucket not authorized');

      expect(spyWarn).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(spyWarn.mock.calls[0][0]);
      expect(entry.level).toBe('WARN');
      expect(entry.action).toBe('authorization');
      expect(entry.message).toBe('Bucket not authorized');
    });

    it('info() should output with level INFO via console.log', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('resize', 'Generated 4 variants');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry.level).toBe('INFO');
    });

    it('debug() should output with level DEBUG via console.log', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.debug('pathResolution', 'Resolved path');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry.level).toBe('DEBUG');
    });

    it('trace() should output with level TRACE via console.log', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.trace('sqsEvent', 'Received record');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry.level).toBe('TRACE');
    });
  });

  describe('data parameter handling', () => {
    it('should include data field when data is provided', async () => {
      const logger = await loadLoggerWithLevel(5);

      const extraData = { sizes: ['large', 'medium'], count: 2 };
      logger.info('resize', 'Generated variants', extraData);

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry.data).toEqual(extraData);
    });

    it('should omit data field when data is not provided', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('resize', 'Generated variants');

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry).not.toHaveProperty('data');
    });

    it('should omit data field when data is undefined', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('resize', 'Generated variants', undefined);

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry).not.toHaveProperty('data');
    });

    it('should omit data field when data is null', async () => {
      const logger = await loadLoggerWithLevel(5);

      logger.info('resize', 'Generated variants', null);

      const entry = JSON.parse(spyLog.mock.calls[0][0]);
      expect(entry).not.toHaveProperty('data');
    });
  });
});
