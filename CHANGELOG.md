# Changelog

All notable changes to this project will be documented in this file.

## v0.0.1 - unreleased

### Added
- **Event-Driven Image Processing Pipeline** [Spec: 0-0-1-initial-project](./.kiro/specs/0-0-1-initial-project/)
  - S3 source bucket with SQS processing queue and dead letter queue
  - Lambda processor function (arm64, Node.js) with Sharp layer for image resizing
  - Image resizing into 6 size tiers (xxLarge, xLarge, large, medium, small, thumb)
  - WebP variant generation alongside original format outputs
  - EXIF metadata extraction and `metadata.json` generation per image
  - JSON metadata upload and merge for updating descriptive fields without re-uploading images
  - Dynamic output bucket routing via S3 object tags (`ImageOutputBucket`, `ImageOutputPath`, `stageId`)
  - Bucket authorization via `AllowImageResizerEvents` tag on destination buckets
  - Source bucket lifecycle management with configurable expiration and archive modes
  - Comprehensive test suite (unit + property-based tests using Jest and fast-check)
  - End-user, admin-ops, and developer documentation

### Removed
- API Gateway resources (`WebApi`, API Gateway log groups, Lambda permissions)

### Changed
- Lambda function replaced (`AppFunction` → `ProcessorFunction`) for SQS-driven image processing
- Architecture changed from API Gateway + Lambda to S3 + SQS + Lambda event-driven pipeline
