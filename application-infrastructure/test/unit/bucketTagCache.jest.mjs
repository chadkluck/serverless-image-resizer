/**
 * Unit tests for utils/bucketTagCache.js
 *
 * Tests the in-memory cache for S3 bucket tag lookups used to reduce
 * repeated GetBucketTagging API calls across warm Lambda invocations.
 *
 * Validates: Requirements 2.8
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { getCachedTags, setCachedTags } from '../../src/lambda/functions/processor/utils/bucketTagCache.js';

describe('bucketTagCache', () => {

  describe('getCachedTags', () => {
    it('should return null for a bucket that has not been cached', () => {
      const result = getCachedTags(`uncached-bucket-${Date.now()}`);
      expect(result).toBeNull();
    });
  });

  describe('setCachedTags and getCachedTags', () => {
    it('should store tags and retrieve them for the same bucket', () => {
      const bucketName = `test-bucket-set-get-${Date.now()}`;
      const tags = {
        AllowImageResizerEvents: 'true',
        'imageResizer:ImageOutputBasePrefix': '/prod/public/images'
      };

      setCachedTags(bucketName, tags);
      const result = getCachedTags(bucketName);

      expect(result).toEqual(tags);
    });
  });

  describe('independent bucket caching', () => {
    it('should cache multiple buckets independently', () => {
      const ts = Date.now();
      const bucketA = `bucket-a-${ts}`;
      const bucketB = `bucket-b-${ts}`;

      const tagsA = { AllowImageResizerEvents: 'true', env: 'prod' };
      const tagsB = { AllowImageResizerEvents: 'false', env: 'test' };

      setCachedTags(bucketA, tagsA);
      setCachedTags(bucketB, tagsB);

      expect(getCachedTags(bucketA)).toEqual(tagsA);
      expect(getCachedTags(bucketB)).toEqual(tagsB);
    });
  });

  describe('overwriting cached tags', () => {
    it('should overwrite previously cached tags for the same bucket', () => {
      const bucketName = `overwrite-bucket-${Date.now()}`;
      const originalTags = { AllowImageResizerEvents: 'false' };
      const updatedTags = { AllowImageResizerEvents: 'true', extra: 'value' };

      setCachedTags(bucketName, originalTags);
      expect(getCachedTags(bucketName)).toEqual(originalTags);

      setCachedTags(bucketName, updatedTags);
      expect(getCachedTags(bucketName)).toEqual(updatedTags);
    });
  });
});
