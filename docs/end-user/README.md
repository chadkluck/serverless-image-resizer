# Image Resizer Integration Guide

Guide for client developers uploading images and JSON metadata to the serverless image resizer.

## Overview

The image resizer processes files uploaded to a source S3 bucket. It resizes images into multiple size tiers, optionally creates WebP variants, extracts EXIF metadata, and writes outputs to a destination bucket you control. Routing and authorization are driven entirely by S3 object tags and bucket tags.

## Uploading files

### Object tags (x-amz-tagging header)

Every upload to the source bucket must include object tags via the `x-amz-tagging` HTTP header. Tags are URL-encoded, ampersand-delimited key-value pairs.

| Tag Key | Required | Description |
|:--------|:---------|:------------|
| `ImageOutputBucket` | Yes | Name of the destination S3 bucket |
| `ImageOutputPath` | No | Path segment after the base prefix (e.g., `posts/2026-05-09`) |
| `stageId` | Conditional | Required when the output base prefix contains a `@stageId` placeholder |

Header format:

```
x-amz-tagging: ImageOutputBucket=my-output-bucket&ImageOutputPath=posts/2026-05-09&stageId=prod
```

> **Note**: If `ImageOutputBucket` is missing, the upload is rejected. If `ImageOutputPath` is omitted, the resizer uses an empty string for that path segment.

### Upload an image (AWS CLI)

```bash
aws s3api put-object \
  --bucket my-source-bucket \
  --key uploads/batch1/photo.jpg \
  --body ./photo.jpg \
  --content-type image/jpeg \
  --tagging "ImageOutputBucket=my-output-bucket&ImageOutputPath=posts/2026-05-09&stageId=prod"
```

### Upload a JSON metadata file (AWS CLI)

Upload a `.json` file with the same tags to update descriptive fields on an existing image's `metadata.json`:

```bash
aws s3api put-object \
  --bucket my-source-bucket \
  --key uploads/batch1/photo.json \
  --body ./photo-update.json \
  --content-type application/json \
  --tagging "ImageOutputBucket=my-output-bucket&ImageOutputPath=posts/2026-05-09&stageId=prod"
```

The JSON file name does not need to match the original image name. The `ImageOutputPath` and tags determine which `metadata.json` is updated.

## Destination bucket setup

### Required bucket tags

The destination bucket must be tagged to authorize and configure the resizer.

| Tag Key | Required | Value | Description |
|:--------|:---------|:------|:------------|
| `AllowImageResizerEvents` | Yes | `true` | Must be exactly `true` (case-sensitive). Any other value causes the resizer to skip the upload. |
| `imageResizer:ImageOutputBasePrefix` | No | e.g., `/web/@stageId/public/img` | Base prefix for output objects. Use `@stageId` as a placeholder replaced at runtime by the `stageId` object tag. Falls back to the stack parameter `ImageOutputBasePrefix` (default `/{stageId}/public/images`) when absent. |

> **Important**: S3 tag values do not allow curly braces. Use `@stageId` (not `{stageId}`) in bucket tag values.

### Tagging a bucket (AWS CLI)

```bash
aws s3api put-bucket-tagging \
  --bucket my-output-bucket \
  --tagging 'TagSet=[{Key=AllowImageResizerEvents,Value=true},{Key=imageResizer:ImageOutputBasePrefix,Value=/web/@stageId/public/img}]'
```

## Supported image formats

The resizer processes the following formats:

- `.jpg` / `.jpeg`
- `.png`
- `.gif`

Additional formats supported by Sharp may also work without extra configuration.

## Size tiers

Each image is resized proportionally based on its long side into up to six tiers:

| Tier | Long side (px) |
|:-----|---------------:|
| xxLarge | 3000 |
| xLarge | 1920 |
| large | 1000 |
| medium | 800 |
| small | 500 |
| thumb | 250 |

If the original image's long side is smaller than a tier threshold, the image is saved at its original dimensions for that tier and all larger tiers are skipped. Images are never upscaled.

When WebP conversion is enabled (the default), a `.webp` variant is created alongside each resized image in the same directory.

## Output path structure

For an image uploaded to `uploads/batch1/photo.jpg` with tags `ImageOutputBucket=my-bucket`, `ImageOutputPath=posts/2026-05-09`, `stageId=prod`, and a bucket tag `imageResizer:ImageOutputBasePrefix=/web/@stageId/public/img`:

```
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/xxLarge.jpg
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/xxLarge.webp
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/xLarge.jpg
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/xLarge.webp
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/large.jpg
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/large.webp
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/medium.jpg
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/medium.webp
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/small.jpg
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/small.webp
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/thumb.jpg
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/thumb.webp
s3://my-bucket/web/prod/public/img/posts/2026-05-09/photo/metadata.json
```

## metadata.json schema

A `metadata.json` file is generated for every processed image.

```json
{
  "type": "jpg",
  "lastModified": "2026-05-09T12:00:00Z",
  "created": "2026-05-09T12:00:00Z",
  "exif": {},
  "locationName": "",
  "locationCoord": { "lat": "", "long": "" },
  "defaultDescription": "",
  "defaultLongDescription": "",
  "defaultAltText": "",
  "defaultCaption": "",
  "credit": "",
  "copyright": "",
  "dateTaken": "",
  "hasWebp": true,
  "sizes": {
    "xxLarge": [3000, 2000],
    "xLarge": [1920, 1280],
    "large": [1000, 667],
    "medium": [800, 533],
    "small": [500, 333],
    "thumb": [250, 167]
  }
}
```

Field rules:

- No field is ever `null`. Empty values use `""`, `{}`, or `[]`.
- `sizes` always lists all six tiers. Skipped tiers use `[]`.
- `type` is the original file extension without the dot (e.g., `jpg`, `png`, `gif`).
- `credit` is auto-populated from the EXIF `Artist` tag when empty.
- `hasWebp` is `true` when WebP variants were generated, `false` otherwise.
- `exif` contains a raw dump of all EXIF data extracted from the image.

## Updating metadata with JSON uploads

Upload a `.json` file to the source bucket with the same object tags to update descriptive fields without re-uploading the image.

### Merge behavior

- Fields in the uploaded JSON overwrite the corresponding fields in the existing `metadata.json`.
- Null values in the uploaded JSON are converted to empty values (`""`, `{}`, `[]`).
- The `sizes`, `exif`, and `hasWebp` fields are preserved unless explicitly included in the uploaded JSON.

### Example JSON update

```json
{
  "defaultDescription": "Sunset over the mountains",
  "defaultAltText": "Orange and purple sunset behind mountain range",
  "credit": "Jane Doe",
  "copyright": "2026 Jane Doe"
}
```

### Image re-upload behavior

When a new image is uploaded to the same output path, the resizer replaces EXIF data but preserves non-empty descriptive fields (`defaultDescription`, `defaultLongDescription`, `defaultAltText`, `defaultCaption`, `credit`, `copyright`) that were previously set via JSON upload.

## Related documentation

- [Admin and operations guide](../admin-ops/README.md)
- [Developer guide](../developer/README.md)
