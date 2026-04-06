# Image Resizer Operations Guide

Guide for system operators and cloud engineers managing the serverless image resizer.

## Overview

The image resizer is an event-driven pipeline: S3 uploads trigger SQS messages consumed by a Lambda function. This guide covers monitoring, troubleshooting, and lifecycle management for the stack's resources.

Resource names follow the pattern `<Prefix>-<ProjectId>-<StageId>-<Resource>`. Replace placeholders in the examples below with your actual values.

## Error log monitoring

### Log group

The Processor Lambda writes structured JSON logs to CloudWatch at:

```
/aws/lambda/<Prefix>-<ProjectId>-<StageId>-Processor
```

Each log entry contains these fields:

| Field | Description |
|:------|:------------|
| `timestamp` | ISO 8601 timestamp |
| `level` | `ERROR`, `WARN`, `INFO`, `DEBUG`, or `TRACE` |
| `action` | Processing step (e.g., `tagValidation`, `authorization`, `resize`, `fileSizeCheck`) |
| `message` | Human-readable description |
| `requestId` | SQS message ID for the record |
| `sourceKey` | S3 object key being processed |
| `outputBucket` | Target output bucket name |
| `data` | Additional structured context (varies by action) |

### Log levels

| Level | Value | When used |
|:------|------:|:----------|
| ERROR | 0 | Failures that prevent processing. Always logged. |
| WARN | 1 | Intentional skips, authorization failures. |
| INFO | 2 | Processing decisions, sizes generated/skipped. |
| DEBUG | 3 | Detailed flow, tag values, path resolution steps. |
| TRACE | 5 | Full request/response details (excluding AWS SDK responses). |

Production deploys default to `LOG_LEVEL=0` (errors only). Non-production defaults to `LOG_LEVEL=5` (all levels).

### CloudWatch Insights queries

Find all errors in the last 24 hours:

```
fields @timestamp, action, message, sourceKey, outputBucket, data
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

Find missing `ImageOutputBucket` tag errors:

```
fields @timestamp, sourceKey, data.key, data.bucket
| filter level = "ERROR" and action = "tagValidation"
| sort @timestamp desc
```

Find unauthorized bucket access attempts:

```
fields @timestamp, sourceKey, outputBucket, data.AllowImageResizerEvents
| filter level = "WARN" and action = "authorization"
| sort @timestamp desc
```

Find file size rejections:

```
fields @timestamp, sourceKey, data.fileSize, data.maxImageFileSize
| filter level = "ERROR" and action = "fileSizeCheck"
| sort @timestamp desc
```

Find batch processing failures:

```
fields @timestamp, data.total, data.failed
| filter level = "WARN" and action = "batchResult"
| sort @timestamp desc
```

### CloudWatch log filter patterns

Create metric filters on the log group to track error rates. These patterns match the structured JSON output.

Errors (all):

```
{ $.level = "ERROR" }
```

Tag validation failures:

```
{ $.level = "ERROR" && $.action = "tagValidation" }
```

Authorization skips:

```
{ $.level = "WARN" && $.action = "authorization" }
```

File size rejections:

```
{ $.level = "ERROR" && $.action = "fileSizeCheck" }
```

Processing exceptions:

```
{ $.level = "ERROR" && $.action = "processing" && $.message = "Error processing record" }
```

## Dead letter queue inspection

Messages that fail processing after 3 attempts are moved to the DLQ. The DLQ retains messages for 14 days.

### Queue names

| Queue | Name pattern |
|:------|:-------------|
| Processing queue | `<Prefix>-<ProjectId>-<StageId>-ProcessingQueue` |
| Dead letter queue | `<Prefix>-<ProjectId>-<StageId>-Dlq` |

### Check DLQ depth

```bash
aws sqs get-queue-attributes \
  --queue-url "https://sqs.<region>.amazonaws.com/<account-id>/<Prefix>-<ProjectId>-<StageId>-Dlq" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

### Receive and inspect DLQ messages

Peek at messages without removing them (visibility timeout keeps them hidden temporarily):

```bash
aws sqs receive-message \
  --queue-url "https://sqs.<region>.amazonaws.com/<account-id>/<Prefix>-<ProjectId>-<StageId>-Dlq" \
  --max-number-of-messages 5 \
  --visibility-timeout 30 \
  --message-attribute-names All
```

Each message body contains the original S3 event notification. Parse it to identify the failed upload:

```bash
# Receive one message and extract the S3 key
aws sqs receive-message \
  --queue-url "https://sqs.<region>.amazonaws.com/<account-id>/<Prefix>-<ProjectId>-<StageId>-Dlq" \
  --max-number-of-messages 1 \
  --visibility-timeout 60 \
  --query 'Messages[0].Body' \
  --output text | python3 -c "
import sys, json
body = json.loads(sys.stdin.read())
for record in body.get('Records', []):
    bucket = record['s3']['bucket']['name']
    key = record['s3']['object']['key']
    print(f'Bucket: {bucket}')
    print(f'Key:    {key}')
"
```

### Purge the DLQ

After investigating, clear all messages:

```bash
aws sqs purge-queue \
  --queue-url "https://sqs.<region>.amazonaws.com/<account-id>/<Prefix>-<ProjectId>-<StageId>-Dlq"
```

> **Warning**: Purging is irreversible. Ensure you have investigated or re-driven messages before purging.

### Redrive messages from DLQ

To reprocess failed messages, start a redrive from the DLQ back to the processing queue using the AWS Console (SQS > DLQ > Start DLQ redrive) or the CLI:

```bash
# Get the DLQ ARN
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url "https://sqs.<region>.amazonaws.com/<account-id>/<Prefix>-<ProjectId>-<StageId>-Dlq" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

# Start redrive
aws sqs start-message-move-task \
  --source-arn "$DLQ_ARN" \
  --destination-arn "arn:aws:sqs:<region>:<account-id>:<Prefix>-<ProjectId>-<StageId>-ProcessingQueue"
```

## Source bucket lifecycle management

The source bucket applies lifecycle rules to the `uploads/` prefix based on the retention parameter.

### Retention modes

| Mode | Condition | Behavior |
|:-----|:----------|:---------|
| Expiration | Retention > 0 days | Objects under `uploads/` are deleted after the configured number of days |
| Archive | Retention = 0 days | Versioning is enabled, current objects transition to Glacier Deep Archive after 30 days, non-current versions expire after 30 days |

### Default retention values

| Environment | Parameter | Default |
|:------------|:----------|--------:|
| PROD | `SourceBucketRetentionInDaysForPROD` | 5 days |
| DEV/TEST | `SourceBucketRetentionInDaysForDEVTEST` | 1 day |

### Check current lifecycle rules

```bash
aws s3api get-bucket-lifecycle-configuration \
  --bucket "<Prefix>-<ProjectId>-<StageId>-<AccountId>-<Region>-an"
```

### Check versioning status

Versioning is enabled only in archive mode (retention = 0):

```bash
aws s3api get-bucket-versioning \
  --bucket "<Prefix>-<ProjectId>-<StageId>-<AccountId>-<Region>-an"
```

### Changing retention

Update the stack parameter `SourceBucketRetentionInDaysForPROD` or `SourceBucketRetentionInDaysForDEVTEST` through the deployment pipeline. Do not modify lifecycle rules directly on the bucket.

> **Note**: Switching from expiration mode to archive mode (setting retention to 0) enables versioning and changes the lifecycle rule from expiration to Glacier Deep Archive transition. This change is applied through CloudFormation and should be tested in a non-production stage first.

## CloudWatch metrics and alarms

### Lambda metrics

The Processor Lambda publishes standard CloudWatch metrics under the `AWS/Lambda` namespace with dimension `FunctionName = <Prefix>-<ProjectId>-<StageId>-Processor`.

Key metrics to monitor:

| Metric | Description | Concern threshold |
|:-------|:------------|:------------------|
| `Errors` | Invocations that resulted in a function error | > 0 per 15 min |
| `Duration` | Execution time in milliseconds | Approaching 60000 (timeout) |
| `Throttles` | Invocations throttled by concurrency limits | > 0 |
| `ConcurrentExecutions` | Number of concurrent function instances | Approaching account limit |

### SQS metrics

The processing queue and DLQ publish metrics under the `AWS/SQS` namespace.

| Metric | Queue | Description |
|:-------|:------|:------------|
| `ApproximateNumberOfMessagesVisible` | ProcessingQueue | Messages waiting to be processed |
| `ApproximateAgeOfOldestMessage` | ProcessingQueue | Age of the oldest unprocessed message |
| `ApproximateNumberOfMessagesVisible` | Dlq | Messages that failed processing |
| `NumberOfMessagesSent` | Dlq | Rate of new failures |

### Preconfigured alarm

The stack creates a CloudWatch alarm in PROD environments:

| Alarm | Condition | Period | Action |
|:------|:----------|:-------|:-------|
| `AppFunctionErrorsAlarm` | Lambda `Errors` sum > 1 | 900 seconds (15 min) | SNS email notification to `AlarmNotificationEmail` parameter |

The alarm uses `TreatMissingData: notBreaching`, so periods with no invocations do not trigger the alarm.

### Recommended additional alarms

These alarms are not created by the stack but are recommended for production monitoring. Create them via CloudFormation, the AWS Console, or the CLI.

DLQ depth alarm (messages accumulating in the dead letter queue):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "<Prefix>-<ProjectId>-<StageId>-DlqDepth" \
  --namespace "AWS/SQS" \
  --metric-name "ApproximateNumberOfMessagesVisible" \
  --dimensions "Name=QueueName,Value=<Prefix>-<ProjectId>-<StageId>-Dlq" \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "<sns-topic-arn>"
```

Processing queue age alarm (messages waiting too long):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "<Prefix>-<ProjectId>-<StageId>-QueueAge" \
  --namespace "AWS/SQS" \
  --metric-name "ApproximateAgeOfOldestMessage" \
  --dimensions "Name=QueueName,Value=<Prefix>-<ProjectId>-<StageId>-ProcessingQueue" \
  --statistic Maximum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 600 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "<sns-topic-arn>"
```

Lambda duration alarm (approaching timeout):

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "<Prefix>-<ProjectId>-<StageId>-ProcessorDuration" \
  --namespace "AWS/Lambda" \
  --metric-name "Duration" \
  --dimensions "Name=FunctionName,Value=<Prefix>-<ProjectId>-<StageId>-Processor" \
  --statistic Maximum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 50000 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "<sns-topic-arn>"
```

## Related documentation

- [End-user integration guide](../end-user/README.md)
- [Developer guide](../developer/README.md)
