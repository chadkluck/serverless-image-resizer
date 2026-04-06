# Architecture

## Overview

Serverless Image Resizer — an event-driven image processing pipeline on AWS. Images uploaded to a source S3 bucket are queued via SQS and processed by a Lambda function using Sharp (arm64 layer) to resize into multiple size tiers, create WebP variants, extract EXIF metadata, and write outputs to dynamically determined destination buckets based on object and bucket tags.

## Application Stack

```mermaid
flowchart TD
    Client([External Process]) -->|"PUT object with tags"| SB["S3: Source Bucket<br/>(uploads/ prefix)"]
    SB -->|"S3 Event Notification<br/>(s3:ObjectCreated:*)"| SQS["SQS: Processing Queue"]
    SQS -->|"Event Source Mapping<br/>(BatchSize: 1)"| Lambda["Lambda: Processor<br/>(arm64, 2048MB, 60s)"]
    SQS -.->|"Failed messages<br/>(maxReceiveCount: 3)"| DLQ["SQS: Dead Letter Queue"]
    Lambda -->|"GetObject +<br/>GetObjectTagging"| SB
    Lambda -->|"GetBucketTagging<br/>(cached)"| OB["S3: Output Bucket(s)<br/>(external, tagged)"]
    Lambda -->|"PutObject<br/>(resized images + metadata)"| OB
    Lambda -->|"Logs"| CW["CloudWatch Logs"]
    SharpLayer["Lambda Layer:<br/>Sharp (arm64)"] -.->|"Provides sharp"| Lambda
```

## Deployment Pipeline

```mermaid
flowchart LR
    Repo["Source<br/>Repository"] --> CodeBuild["AWS<br/>CodeBuild"]
    CodeBuild -->|"npm install (processor)<br/>npm install (Sharp layer)<br/>Jest tests<br/>SAM package"| Artifacts["S3 Artifacts<br/>Bucket"]
    Artifacts --> CFN["CloudFormation<br/>Deploy"]
    CFN -->|"Create/Update Stack"| Stack["Application<br/>Stack"]
    CFN -->|"PROD: Gradual<br/>DEV/TEST: AllAtOnce"| CodeDeploy["CodeDeploy<br/>Traffic Shifting"]
```

## Directory Structure

```
├── application-infrastructure/         # AWS SAM application stack
│   ├── build-scripts/                  # Python scripts used during CodeBuild
│   │   ├── generate-put-ssm.py
│   │   ├── update_template_configuration.py
│   │   └── update_template_timestamp.py
│   ├── src/
│   │   └── lambda/
│   │       ├── functions/
│   │       │   └── processor/              # Lambda function source code (Node.js)
│   │       │       ├── handler.js           # SQS event handler entry point
│   │       │       ├── package.json         # Lambda function dependencies
│   │       │       ├── config/
│   │       │       │   └── settings.js      # Centralized configuration from env vars
│   │       │       └── utils/
│   │       │           ├── s3Client.js          # S3 operations wrapper
│   │       │           ├── imageProcessor.js    # Sharp resize + WebP conversion
│   │       │           ├── metadataManager.js   # metadata.json generation and merge
│   │       │           ├── bucketTagCache.js    # In-memory bucket tag cache
│   │       │           ├── pathResolver.js      # Output path resolution
│   │       │           └── logger.js            # Structured logging
│   │       └── layers/
│   │           └── sharp-arm64/
│   │               └── nodejs/
│   │                   └── package.json     # Sharp dependency (arm64/linux)
│   ├── test/
│   │   ├── jest.config.mjs                  # Jest configuration (ESM)
│   │   ├── __mocks__/
│   │   │   └── sharp.mjs                   # Sharp mock for unit tests
│   │   ├── unit/                            # Unit tests (*.jest.mjs)
│   │   └── property/                        # Property-based tests (fast-check)
│   ├── buildspec.yml                        # AWS CodeBuild build specification
│   ├── template.yml                         # AWS SAM/CloudFormation template
│   ├── template-configuration.json          # Stack parameter overrides
│   └── package.json                         # Dev dependencies (Jest, fast-check)
├── docs/                                    # Documentation
│   ├── admin-ops/                           # For Admin, Operations
│   ├── developer/                           # For Developer maintaining application
│   └── end-user/                            # For consumer of this application's output
├── scripts/                                 # Utility scripts (not part of deployment)
│   └── generate-sidecar-metadata.py
├── AGENTS.md                                # AI and developer guidelines
├── ARCHITECTURE.md
├── CHANGELOG.md
├── DEPLOYMENT.md
└── README.md
```

## Key Design Decisions

- **S3 → SQS → Lambda pipeline** replaces the previous API Gateway + Lambda architecture. SQS provides retry, DLQ, and backpressure natively.
- **Single Lambda function** handles all processing (resize, WebP, metadata). No batching/consolidation benefit for independent image processing.
- **Sharp as Lambda Layer (arm64)** separates the native binary from application code. Built during CodeBuild with `--arch=arm64 --platform=linux`.
- **Dynamic output bucket routing** via object tags (`ImageOutputBucket`, `ImageOutputPath`) decouples the resizer from any specific destination.
- **Bucket tag authorization** (`AllowImageResizerEvents=true`) acts as an opt-in gate for output buckets. Runtime verification since IAM cannot condition on bucket tags.
- **In-memory bucket tag cache** persists across warm Lambda invocations to reduce `GetBucketTagging` API calls.
- **Gradual deployments** enabled only in PROD (via CodeDeploy traffic shifting); DEV/TEST deploy all-at-once.
- **CloudWatch Alarms** and SNS notifications created only in PROD to reduce cost.
- **No upscaling** — if the original is smaller than a size tier, save at original dimensions and skip larger tiers.
- **Permissions Boundary** support is optional, controlled via a stack parameter.
