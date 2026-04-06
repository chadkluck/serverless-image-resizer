# Serverless Image Resizer

An event-driven image processing pipeline on AWS. Images uploaded to a source S3 bucket are automatically queued via SQS and processed by a Lambda function that resizes into multiple size tiers, generates WebP variants, extracts EXIF metadata, and writes outputs to dynamically determined destination buckets.

| | Build/Deploy | Application Stack |
|---|---|---|
| **Languages** | Python, Shell | Node.js |
| **Frameworks** | Atlantis | Atlantis, Sharp |
| **Features** | SSM Parameters, Jest Tests | S3, SQS, Lambda, Sharp Layer, CloudWatch Logs, CloudWatch Alarms |

> **Ready-to-Deploy-and-Run** with the [63Klabs Atlantis Templates and Scripts Platform for Serverless Deployments on AWS](https://github.com/63Klabs/atlantis)

## Features

- **Image resizing** into 6 size tiers (xxLarge, xLarge, large, medium, small, thumb) with aspect ratio preservation
- **WebP variant generation** alongside original format outputs (configurable)
- **EXIF metadata extraction** and `metadata.json` generation per image
- **JSON metadata upload and merge** for updating descriptions, captions, and credits without re-uploading images
- **Dynamic output bucket routing** via S3 object tags (`ImageOutputBucket`, `ImageOutputPath`)
- **Bucket authorization** via `AllowImageResizerEvents` tag on destination buckets
- **Source bucket lifecycle management** with configurable expiration and archive modes
- **Comprehensive test suite** with unit tests and property-based tests (fast-check)

## Quick Start

1. Read the [Deployment Guide](./DEPLOYMENT.md) for repository setup and pipeline configuration
2. Upload an image to the source bucket `uploads/` prefix with required object tags:

```bash
aws s3api put-object \
  --bucket SOURCE_BUCKET_NAME \
  --key uploads/my-photo.jpg \
  --body ./my-photo.jpg \
  --tagging "ImageOutputBucket=my-output-bucket&ImageOutputPath=posts/2026-01-15"
```

3. The pipeline processes the image automatically — resized variants and `metadata.json` appear in the output bucket

See [End-User Documentation](./docs/end-user/README.md) for full upload instructions and tag reference.

## Architecture

See [Architecture](./ARCHITECTURE.md)

## Deployment Guide

See [Deployment Guide](./DEPLOYMENT.md)

## Advanced Documentation

See [Docs Directory](./docs/README.md)

## AI Context

See [AGENTS.md](./AGENTS.md) for important context and guidelines for AI-generated code in this repository.

The agents file is also helpful (and perhaps essential) for HUMANS developing within the application's structured platform as well.

## Changelog

See [Change Log](./CHANGELOG.md)

## Contributors

- [63Klabs](https://github.com/63klabs)
- [Chad Kluck](https://github.com/chadkluck)
