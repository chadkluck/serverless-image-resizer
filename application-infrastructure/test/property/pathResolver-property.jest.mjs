/**
 * Property-based tests for utils/pathResolver.js
 *
 * Feature: 0-0-1-initial-project, Property 5: Output path resolution with placeholder substitution
 *
 * Validates: Requirements 2.6, 3.6, 7.1, 7.2, 7.3
 *
 * Uses fast-check to generate random combinations of bucket base prefix,
 * stack parameter base prefix, ImageOutputPath, stageId, and originalFileName.
 * Verifies placeholder substitution, trailing slash, and no double slashes.
 */

import { describe, it, expect } from '@jest/globals';
import fc from 'fast-check';
import { resolveOutputPath } from '../../src/lambda/functions/processor/utils/pathResolver.js';

/**
 * Arbitrary for a simple alphanumeric segment (no slashes, no empty).
 * Used for stageId, originalFileName, and path segments.
 */
const alphaSegment = fc.stringMatching(/^[a-zA-Z0-9]{1,12}$/);

/**
 * Arbitrary for a path-like string built from 1-3 alphanumeric segments
 * joined by `/`. May optionally start with `/`.
 */
const pathLike = fc
  .tuple(
    fc.boolean(),
    fc.array(alphaSegment, { minLength: 1, maxLength: 3 })
  )
  .map(([leadingSlash, segments]) =>
    (leadingSlash ? '/' : '') + segments.join('/')
  );

describe('Property 5: Output path resolution with placeholder substitution', () => {
  // **Validates: Requirements 2.6, 3.6, 7.1, 7.2, 7.3**

  it('should correctly resolve output paths for any combination of inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        // bucketBasePrefix: either null or a path-like string (with or without @stageId)
        fc.option(
          fc.oneof(
            pathLike,
            pathLike.map(p => p + '/@stageId'),
            pathLike.map(p => '@stageId/' + p)
          ),
          { nil: null }
        ),
        // stackBasePrefix: a path-like string (with or without {stageId})
        fc.oneof(
          pathLike,
          pathLike.map(p => p + '/{stageId}'),
          pathLike.map(p => '{stageId}/' + p)
        ),
        // ImageOutputPath: present or absent
        fc.option(alphaSegment, { nil: undefined }),
        // stageId: present or absent
        fc.option(alphaSegment, { nil: undefined }),
        // originalFileName: always present, alphanumeric
        alphaSegment,
        async (bucketBasePrefix, stackBasePrefix, imageOutputPath, stageId, originalFileName) => {
          const objectTags = {};
          if (imageOutputPath !== undefined) {
            objectTags.ImageOutputPath = imageOutputPath;
          }

          const result = resolveOutputPath(
            bucketBasePrefix,
            stackBasePrefix,
            objectTags,
            stageId || '',
            originalFileName
          );

          // --- Verify: @stageId in bucket tag values is replaced ---
          if (bucketBasePrefix !== null && bucketBasePrefix !== '') {
            expect(result).not.toContain('@stageId');
          }

          // --- Verify: {stageId} in stack parameter values is replaced ---
          if (bucketBasePrefix === null || bucketBasePrefix === '') {
            expect(result).not.toContain('{stageId}');
          }

          // --- Verify: stageId tag is ignored when no placeholder exists ---
          if (bucketBasePrefix !== null && bucketBasePrefix !== '' && !bucketBasePrefix.includes('@stageId')) {
            // The bucket prefix has no placeholder — the result should start
            // with the bucket prefix (minus any leading slash, since leading
            // slashes are stripped for S3 key safety).
            const expectedStart = bucketBasePrefix.startsWith('/')
              ? bucketBasePrefix.slice(1)
              : bucketBasePrefix;
            expect(result.startsWith(expectedStart)).toBe(true);
          }

          // --- Verify: Path ends with `/` ---
          expect(result.endsWith('/')).toBe(true);

          // --- Verify: No leading slash (S3 keys should not start with /) ---
          expect(result.startsWith('/')).toBe(false);

          // --- Verify: No double slashes ---
          expect(result).not.toContain('//');

          // --- Verify: ImageOutputPath is empty string when tag is absent ---
          if (imageOutputPath === undefined) {
            // When ImageOutputPath is absent, the path should go directly from
            // base prefix to originalFileName without an extra segment.
            // We verify no double slashes already covers this, but also check
            // that the result contains the originalFileName segment.
            expect(result).toContain(originalFileName);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
