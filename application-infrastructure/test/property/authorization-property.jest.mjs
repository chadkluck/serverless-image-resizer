/**
 * Property-based tests for bucket authorization in handler.js
 *
 * Feature: 0-0-1-initial-project, Property 1: Bucket authorization rejects non-true values
 *
 * Validates: Requirements 2.4, 11.4
 *
 * For any string value of the AllowImageResizerEvents bucket tag that is NOT
 * exactly "true" (including missing, empty, "True", "TRUE", "yes", "1", or any
 * random string), the handler treats the event as an intentional skip (returns
 * success with no batchItemFailures) and does not write objects (putObject is
 * never called).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import fc from 'fast-check';

// ── Mock all handler dependencies using jest.unstable_mockModule ──

const mockGetObject = jest.fn();
const mockGetObjectTagging = jest.fn();
const mockGetBucketTagging = jest.fn();
const mockPutObject = jest.fn();

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/s3Client.js',
  () => ({
    getObject: mockGetObject,
    getObjectTagging: mockGetObjectTagging,
    getBucketTagging: mockGetBucketTagging,
    putObject: mockPutObject
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/imageProcessor.js',
  () => ({
    resizeImage: jest.fn()
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/metadataManager.js',
  () => ({
    generateMetadata: jest.fn(),
    mergeMetadata: jest.fn(),
    mergeWithNewImage: jest.fn(),
    extractExif: jest.fn()
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/bucketTagCache.js',
  () => ({
    getCachedTags: jest.fn().mockReturnValue(null),
    setCachedTags: jest.fn()
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/pathResolver.js',
  () => ({
    resolveOutputPath: jest.fn().mockReturnValue('some/output/path/')
  })
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/utils/logger.js',
  () => {
    const noop = jest.fn();
    return {
      default: {
        error: noop,
        warn: noop,
        info: noop,
        debug: noop,
        trace: noop,
        setContext: noop
      }
    };
  }
);

jest.unstable_mockModule(
  '../../src/lambda/functions/processor/config/settings.js',
  () => ({
    default: Object.freeze({
      sizes: { xxLarge: 3000, xLarge: 1920, large: 1000, medium: 800, small: 500, thumb: 250 },
      createWebpVersion: true,
      imageOutputBasePrefix: '/{stageId}/public/images',
      maxImageFileSize: 26214400,
      logLevel: 0,
      stageId: 'test',
      sourceBucket: 'source-bucket'
    })
  })
);

// Import handler after all mocks are registered
const { handler } = await import(
  '../../src/lambda/functions/processor/handler.js'
);

/**
 * Build a minimal SQS event wrapping an S3 notification.
 *
 * @param {string} messageId - SQS message ID
 * @returns {Object} SQS event with one record
 */
function buildSqsEvent(messageId) {
  return {
    Records: [
      {
        messageId,
        body: JSON.stringify({
          Records: [
            {
              eventSource: 'aws:s3',
              eventName: 'ObjectCreated:Put',
              s3: {
                bucket: { name: 'source-bucket' },
                object: {
                  key: 'uploads/test/photo.jpg',
                  size: 1024
                }
              }
            }
          ]
        })
      }
    ]
  };
}

/** Minimal Lambda context stub. */
const stubContext = {
  getRemainingTimeInMillis: () => 60000
};

describe('Property 1: Bucket authorization rejects non-true values', () => {
  // **Validates: Requirements 2.4, 11.4**

  beforeEach(() => {
    jest.clearAllMocks();

    // Object tags always include a valid ImageOutputBucket
    mockGetObjectTagging.mockResolvedValue({
      TagSet: [
        { Key: 'ImageOutputBucket', Value: 'output-bucket' },
        { Key: 'ImageOutputPath', Value: 'photos' }
      ]
    });
  });

  it('should return success with no batchItemFailures and never call putObject for any non-"true" AllowImageResizerEvents value', async () => {
    // Feature: 0-0-1-initial-project, Property 1: Bucket authorization rejects non-true values
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter(s => s !== 'true'),
        async (tagValue) => {
          jest.clearAllMocks();

          // Re-stub getObjectTagging after clearAllMocks
          mockGetObjectTagging.mockResolvedValue({
            TagSet: [
              { Key: 'ImageOutputBucket', Value: 'output-bucket' },
              { Key: 'ImageOutputPath', Value: 'photos' }
            ]
          });

          // Bucket tags return the generated non-"true" value
          mockGetBucketTagging.mockResolvedValue({
            TagSet: [
              { Key: 'AllowImageResizerEvents', Value: tagValue }
            ]
          });

          const event = buildSqsEvent(`msg-${Date.now()}`);
          const result = await handler(event, stubContext);

          // Handler returns success (no batchItemFailures) — intentional skip
          expect(result.batchItemFailures).toEqual([]);

          // putObject is never called — no objects written
          expect(mockPutObject).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should also reject specific commonly confused values', async () => {
    // Feature: 0-0-1-initial-project, Property 1: Bucket authorization rejects non-true values
    const confusingValues = ['', 'True', 'TRUE', 'yes', '1', 'false', 'FALSE', 'tRuE', ' true', 'true '];

    for (const tagValue of confusingValues) {
      jest.clearAllMocks();

      mockGetObjectTagging.mockResolvedValue({
        TagSet: [
          { Key: 'ImageOutputBucket', Value: 'output-bucket' },
          { Key: 'ImageOutputPath', Value: 'photos' }
        ]
      });

      mockGetBucketTagging.mockResolvedValue({
        TagSet: [
          { Key: 'AllowImageResizerEvents', Value: tagValue }
        ]
      });

      const event = buildSqsEvent(`msg-specific-${tagValue}`);
      const result = await handler(event, stubContext);

      expect(result.batchItemFailures).toEqual([]);
      expect(mockPutObject).not.toHaveBeenCalled();
    }
  });
});
