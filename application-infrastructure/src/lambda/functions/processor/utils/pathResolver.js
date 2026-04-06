/**
 * Output path resolution with placeholder substitution.
 * Resolves the full output prefix for processed images by combining
 * a base prefix (from bucket tags or stack parameters), an optional
 * ImageOutputPath from object tags, and the original file name.
 *
 * Placeholder rules:
 * - Bucket tag values use `@stageId` as the placeholder
 * - Stack parameter values use `{stageId}` as the placeholder
 * - When no placeholder exists in the chosen base prefix, the stageId
 *   value is ignored
 *
 * @module utils/pathResolver
 * @example
 * import { resolveOutputPath } from './utils/pathResolver.js';
 *
 * // Bucket tag prefix with @stageId placeholder
 * const path = resolveOutputPath(
 *   '/web/@stageId/public/img',
 *   '/{stageId}/public/images',
 *   { ImageOutputPath: 'posts/2026-05-09' },
 *   'prod',
 *   'myImage'
 * );
 * console.log(path); // '/web/prod/public/img/posts/2026-05-09/myImage/'
 */

/**
 * Resolve the full output path prefix for a processed image.
 *
 * @param {string|null|undefined} bucketBasePrefix - Base prefix from the
 *   output bucket's `imageResizer:ImageOutputBasePrefix` tag. May contain
 *   an `@stageId` placeholder. When provided (non-empty), takes priority
 *   over the stack parameter.
 * @param {string} stackBasePrefix - Fallback base prefix from the
 *   `IMAGE_OUTPUT_BASE_PREFIX` stack parameter / environment variable.
 *   May contain a `{stageId}` placeholder.
 * @param {Object} objectTags - Tags read from the uploaded S3 object.
 * @param {string} [objectTags.ImageOutputPath] - Optional path segment
 *   appended after the resolved base prefix (e.g. `posts/2026-05-09`).
 * @param {string} [objectTags.stageId] - Stage identifier carried on the
 *   object (used only when the base prefix contains a placeholder).
 * @param {string} stageId - Stage identifier from the Lambda environment
 *   (used for `{stageId}` substitution in the stack parameter value).
 * @param {string} originalFileName - Original file name without extension,
 *   extracted from the S3 object key.
 * @returns {string} Fully resolved output path prefix ending with `/`.
 *
 * @example
 * // Stack parameter fallback with {stageId}
 * resolveOutputPath(null, '/{stageId}/public/images', {}, 'test', 'photo');
 * // → '/test/public/images/photo/'
 *
 * @example
 * // No placeholder — stageId ignored
 * resolveOutputPath('/static/images', '/{stageId}/public/images', {}, 'prod', 'hero');
 * // → '/static/images/hero/'
 */
function resolveOutputPath(bucketBasePrefix, stackBasePrefix, objectTags, stageId, originalFileName) {
  const tags = objectTags || {};
  let basePrefix;

  if (bucketBasePrefix !== null && bucketBasePrefix !== undefined && bucketBasePrefix !== '') {
    // Bucket tag value — replace @stageId placeholder
    basePrefix = bucketBasePrefix.replace(/@stageId/g, stageId || '');
  } else {
    // Fall back to stack parameter — replace {stageId} placeholder
    basePrefix = (stackBasePrefix || '').replace(/\{stageId\}/g, stageId || '');
  }

  const imageOutputPath = tags.ImageOutputPath || '';

  // Build path segments, filtering out empty strings to avoid double slashes
  const segments = [basePrefix, imageOutputPath, originalFileName]
    .filter(segment => segment !== '' && segment !== undefined && segment !== null);

  const joined = segments.join('/');

  // Collapse any accidental double (or more) slashes into single slashes,
  // but preserve a leading slash if present
  const cleaned = joined.replace(/\/{2,}/g, '/');

  // Ensure trailing slash
  return cleaned.endsWith('/') ? cleaned : cleaned + '/';
}

export { resolveOutputPath };
