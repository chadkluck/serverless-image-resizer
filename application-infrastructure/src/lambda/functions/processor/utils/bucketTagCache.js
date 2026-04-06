/**
 * In-memory cache for S3 bucket tag lookups.
 * Uses a module-level Map that persists across warm Lambda invocations
 * within the same execution environment, reducing repeated
 * GetBucketTagging API calls.
 *
 * No TTL is applied — the cache lives for the duration of the
 * Lambda execution environment lifetime.
 *
 * @module utils/bucketTagCache
 * @example
 * import { getCachedTags, setCachedTags } from './utils/bucketTagCache.js';
 *
 * // First lookup — cache miss
 * const tags = getCachedTags('my-output-bucket'); // null
 *
 * // Store tags after fetching from S3
 * setCachedTags('my-output-bucket', {
 *   AllowImageResizerEvents: 'true',
 *   'imageResizer:ImageOutputBasePrefix': '/prod/public/images'
 * });
 *
 * // Subsequent lookup — cache hit
 * const cached = getCachedTags('my-output-bucket');
 * console.log(cached.AllowImageResizerEvents); // 'true'
 */

/** @type {Map<string, Object>} */
const cache = new Map();

/**
 * Retrieve cached bucket tags for the given bucket name.
 *
 * @param {string} bucketName - Name of the S3 bucket to look up
 * @returns {Object|null} Cached tag object, or null if not cached
 * @example
 * const tags = getCachedTags('my-output-bucket');
 * if (tags) {
 *   console.log(tags.AllowImageResizerEvents);
 * }
 */
function getCachedTags(bucketName) {
  return cache.get(bucketName) || null;
}

/**
 * Store bucket tags in the cache for the given bucket name.
 *
 * @param {string} bucketName - Name of the S3 bucket
 * @param {Object} tags - Tag object to cache (key-value pairs)
 * @returns {void}
 * @example
 * setCachedTags('my-output-bucket', {
 *   AllowImageResizerEvents: 'true',
 *   'imageResizer:ImageOutputBasePrefix': '/@stageId/public/images'
 * });
 */
function setCachedTags(bucketName, tags) {
  cache.set(bucketName, tags);
}

export { getCachedTags, setCachedTags };
