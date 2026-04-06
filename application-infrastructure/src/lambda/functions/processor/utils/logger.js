/**
 * Configurable structured logger for the Processor Lambda.
 * Outputs JSON log entries to CloudWatch via console methods.
 * Log level is controlled by the `LOG_LEVEL` environment variable
 * through the settings module.
 *
 * Log levels:
 * - ERROR (0): Failures that prevent processing. Always logged.
 * - WARN  (1): Intentional skips, authorization failures.
 * - INFO  (2): Processing decisions, sizes generated/skipped.
 * - DEBUG (3): Detailed flow, tag values, path resolution steps.
 * - TRACE (5): Full request/response details (excluding AWS SDK responses).
 *
 * @module utils/logger
 * @example
 * import logger from './utils/logger.js';
 *
 * logger.setContext({ requestId: 'abc-123', sourceKey: 'uploads/img.jpg', outputBucket: 'my-bucket' });
 * logger.info('resize', 'Generated 4 size variants', { sizes: ['large', 'medium', 'small', 'thumb'] });
 * logger.error('tagValidation', 'Missing ImageOutputBucket tag', { key: 'uploads/img.jpg' });
 */

import settings from '../config/settings.js';

/** @enum {number} */
const LOG_LEVELS = Object.freeze({
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 5
});

/**
 * @typedef {Object} LogContext
 * @property {string} [requestId]    - Lambda invocation request ID
 * @property {string} [sourceKey]    - S3 object key being processed
 * @property {string} [outputBucket] - Target output bucket name
 */

/** @type {LogContext} */
let context = {};

/**
 * Set the logging context fields included in every log entry.
 *
 * @param {LogContext} ctx - Context object with requestId, sourceKey, and/or outputBucket
 * @returns {void}
 * @example
 * import logger from './utils/logger.js';
 * logger.setContext({ requestId: 'abc-123', sourceKey: 'uploads/photo.jpg', outputBucket: 'dest-bucket' });
 */
function setContext(ctx) {
  context = { ...ctx };
}

/**
 * Build a structured JSON log entry.
 *
 * @private
 * @param {string} level   - Log level name (ERROR, WARN, INFO, DEBUG, TRACE)
 * @param {string} action  - Action being performed when the log was created
 * @param {string} message - Human-readable log message
 * @param {Object} [data]  - Additional data to include (must not contain full AWS SDK responses)
 * @returns {string} JSON-serialized log entry
 */
function buildEntry(level, action, message, data) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    action,
    message,
    requestId: context.requestId || '',
    sourceKey: context.sourceKey || '',
    outputBucket: context.outputBucket || ''
  };

  if (data !== undefined && data !== null) {
    entry.data = data;
  }

  return JSON.stringify(entry);
}

/**
 * Log an ERROR-level message (level 0). Always logged regardless of configured log level.
 * Use for failures that prevent processing.
 *
 * @param {string} action  - Action being performed (e.g. 'tagValidation', 'resize')
 * @param {string} message - Descriptive error message
 * @param {Object} [data]  - Additional structured data (must not include full AWS SDK responses)
 * @returns {void}
 * @example
 * logger.error('tagValidation', 'Missing ImageOutputBucket tag', { key: 'uploads/img.jpg' });
 */
function error(action, message, data) {
  if (settings.logLevel >= LOG_LEVELS.ERROR) {
    console.error(buildEntry('ERROR', action, message, data));
  }
}

/**
 * Log a WARN-level message (level 1).
 * Use for intentional skips and authorization failures.
 *
 * @param {string} action  - Action being performed
 * @param {string} message - Descriptive warning message
 * @param {Object} [data]  - Additional structured data (must not include full AWS SDK responses)
 * @returns {void}
 * @example
 * logger.warn('authorization', 'Bucket not authorized', { bucket: 'some-bucket' });
 */
function warn(action, message, data) {
  if (settings.logLevel >= LOG_LEVELS.WARN) {
    console.warn(buildEntry('WARN', action, message, data));
  }
}

/**
 * Log an INFO-level message (level 2).
 * Use for processing decisions, sizes generated/skipped.
 *
 * @param {string} action  - Action being performed
 * @param {string} message - Descriptive info message
 * @param {Object} [data]  - Additional structured data (must not include full AWS SDK responses)
 * @returns {void}
 * @example
 * logger.info('resize', 'Generated size variants', { generated: ['large', 'medium'], skipped: ['xxLarge'] });
 */
function info(action, message, data) {
  if (settings.logLevel >= LOG_LEVELS.INFO) {
    console.log(buildEntry('INFO', action, message, data));
  }
}

/**
 * Log a DEBUG-level message (level 3).
 * Use for detailed flow, tag values, path resolution steps.
 *
 * @param {string} action  - Action being performed
 * @param {string} message - Descriptive debug message
 * @param {Object} [data]  - Additional structured data (must not include full AWS SDK responses)
 * @returns {void}
 * @example
 * logger.debug('pathResolution', 'Resolved output path', { path: '/prod/public/images/posts/photo/' });
 */
function debug(action, message, data) {
  if (settings.logLevel >= LOG_LEVELS.DEBUG) {
    console.log(buildEntry('DEBUG', action, message, data));
  }
}

/**
 * Log a TRACE-level message (level 5).
 * Use for full request/response details, excluding AWS SDK responses (per Requirement 14.2).
 *
 * @param {string} action  - Action being performed
 * @param {string} message - Descriptive trace message
 * @param {Object} [data]  - Additional structured data (must not include full AWS SDK responses)
 * @returns {void}
 * @example
 * logger.trace('sqsEvent', 'Received SQS record', { messageId: 'msg-123', eventSource: 'aws:sqs' });
 */
function trace(action, message, data) {
  if (settings.logLevel >= LOG_LEVELS.TRACE) {
    console.log(buildEntry('TRACE', action, message, data));
  }
}

/** @type {import('./logger.js')} */
const logger = {
  LOG_LEVELS,
  setContext,
  error,
  warn,
  info,
  debug,
  trace
};

export default logger;
