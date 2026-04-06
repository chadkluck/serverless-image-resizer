/**
 * Unit tests for utils/pathResolver.js
 *
 * Tests output path resolution with placeholder substitution, bucket tag
 * priority over stack parameters, and handling of missing segments.
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */

import { describe, it, expect } from '@jest/globals';
import { resolveOutputPath } from '../../src/lambda/functions/processor/utils/pathResolver.js';

describe('pathResolver – resolveOutputPath', () => {

  describe('@stageId replacement in bucket tag prefix', () => {
    it('should replace @stageId with the provided stageId', () => {
      const result = resolveOutputPath(
        '/web/@stageId/public/img',
        '/{stageId}/public/images',
        { ImageOutputPath: 'posts/2026-05-09' },
        'prod',
        'myImage'
      );
      expect(result).toBe('web/prod/public/img/posts/2026-05-09/myImage/');
    });

    it('should replace multiple @stageId occurrences', () => {
      const result = resolveOutputPath(
        '/@stageId/assets/@stageId',
        '/{stageId}/fallback',
        {},
        'test',
        'hero'
      );
      expect(result).toBe('test/assets/test/hero/');
    });
  });

  describe('{stageId} replacement in stack parameter prefix', () => {
    it('should replace {stageId} when bucket tag prefix is null', () => {
      const result = resolveOutputPath(
        null,
        '/{stageId}/public/images',
        {},
        'test',
        'photo'
      );
      expect(result).toBe('test/public/images/photo/');
    });

    it('should replace {stageId} when bucket tag prefix is empty string', () => {
      const result = resolveOutputPath(
        '',
        '/{stageId}/public/images',
        { ImageOutputPath: 'gallery' },
        'beta',
        'sunset'
      );
      expect(result).toBe('beta/public/images/gallery/sunset/');
    });

    it('should replace {stageId} when bucket tag prefix is undefined', () => {
      const result = resolveOutputPath(
        undefined,
        '/{stageId}/cdn',
        {},
        'staging',
        'banner'
      );
      expect(result).toBe('staging/cdn/banner/');
    });
  });

  describe('missing ImageOutputPath (no double slashes)', () => {
    it('should produce a clean path when ImageOutputPath is absent', () => {
      const result = resolveOutputPath(
        '/static/images',
        '/{stageId}/fallback',
        {},
        'prod',
        'logo'
      );
      expect(result).toBe('static/images/logo/');
      expect(result).not.toMatch(/\/\//);
    });

    it('should produce a clean path when ImageOutputPath is empty string', () => {
      const result = resolveOutputPath(
        '/static/images',
        '/{stageId}/fallback',
        { ImageOutputPath: '' },
        'prod',
        'logo'
      );
      expect(result).toBe('static/images/logo/');
      expect(result).not.toMatch(/\/\//);
    });

    it('should produce a clean path when objectTags is null', () => {
      const result = resolveOutputPath(
        '/media',
        '/{stageId}/fallback',
        null,
        'prod',
        'avatar'
      );
      expect(result).toBe('media/avatar/');
    });
  });

  describe('no placeholder ignores stageId', () => {
    it('should ignore stageId when bucket tag prefix has no placeholder', () => {
      const result = resolveOutputPath(
        '/static/images',
        '/{stageId}/public/images',
        {},
        'prod',
        'hero'
      );
      expect(result).toBe('static/images/hero/');
    });

    it('should ignore stageId when stack parameter has no placeholder and bucket tag is null', () => {
      const result = resolveOutputPath(
        null,
        '/fixed/path',
        {},
        'prod',
        'icon'
      );
      expect(result).toBe('fixed/path/icon/');
    });
  });

  describe('bucket tag prefix takes priority over stack parameter', () => {
    it('should use bucket tag prefix when both are provided', () => {
      const result = resolveOutputPath(
        '/bucket-tag-path/@stageId',
        '/{stageId}/stack-param-path',
        { ImageOutputPath: 'content' },
        'prod',
        'file'
      );
      expect(result).toBe('bucket-tag-path/prod/content/file/');
    });

    it('should use bucket tag prefix even without placeholders', () => {
      const result = resolveOutputPath(
        '/custom/output',
        '/{stageId}/default/output',
        {},
        'test',
        'img'
      );
      expect(result).toBe('custom/output/img/');
    });
  });

  describe('fallback to stack parameter when bucket tag prefix is null/empty', () => {
    it('should fall back to stack parameter when bucket tag is null', () => {
      const result = resolveOutputPath(
        null,
        '/{stageId}/public/images',
        { ImageOutputPath: 'articles' },
        'prod',
        'cover'
      );
      expect(result).toBe('prod/public/images/articles/cover/');
    });

    it('should fall back to stack parameter when bucket tag is empty', () => {
      const result = resolveOutputPath(
        '',
        '/{stageId}/public/images',
        {},
        'dev',
        'thumb'
      );
      expect(result).toBe('dev/public/images/thumb/');
    });

    it('should fall back to stack parameter when bucket tag is undefined', () => {
      const result = resolveOutputPath(
        undefined,
        '/static/assets',
        { ImageOutputPath: 'photos' },
        'prod',
        'landscape'
      );
      expect(result).toBe('static/assets/photos/landscape/');
    });
  });
});
