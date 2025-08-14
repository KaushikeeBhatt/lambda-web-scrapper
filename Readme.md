# Lambda Web Scraper Scheduler (EC2 Launcher)

Run a web scraper only when you need it. This AWS Lambda function safely spins up a tiny EC2 instance, bootstraps your scraper from S3, and tags it for auto‑shutdown to keep costs near-zero.

## Why this exists

- Pay only when scraping. No always-on servers.
- Idempotent launches: if a scraper instance is already running, it won’t start another.
- One file deployment: `lambda-scheduler.js` using AWS SDK v3 for EC2.

## Features

- Checks for an existing EC2 instance with tag `Name=design-hackathon-scraper` in state `running|pending` and skips duplication.
- Boots an Amazon Linux 2 instance with a cloud‑init/UserData script that:
	- Installs Node.js, npm, Git, and the native libs often needed for headless browsing.
	- Pulls your scraper bundle from S3 (`design-hackathon-scraper.zip`).
	- Sets up a simple `systemd` service to run `server.js` with production env.
- Fully configurable via environment variables.
- Uses AWS SDK for JavaScript v3 (`@aws-sdk/client-ec2`).

## How it works

1. Lambda handler runs and queries EC2 for instances tagged `design-hackathon-scraper` that are running or pending.
2. If none found, it launches a `t2.micro` with the provided key pair, security group, and instance profile.
3. The instance UserData downloads your scraper from S3, installs deps, and starts via `systemd`.
4. Logs are available in CloudWatch (Lambda) and on the instance via `journalctl`.

### Architecture (at a glance)

```text
┌──────────┐      invoke       ┌──────────┐      RunInstances + UserData      ┌──────────────┐
│  Trigger │ ────────────────▶ │  Lambda  │ ────────────────────────────────▶ │   EC2 (AL2)  │
└──────────┘  (cron/API/etc.)  └──────────┘                                   └──────┬───────┘
																	│
																downloads
																	│
																┌─────▼─────┐
																│    S3     │
																│  bundle   │
																└───────────┘
```

## Repository layout

- `lambda-scheduler.js` — Lambda handler that launches EC2 with proper tags and UserData.
- `lambda-trust-policy.json` — Sample Lambda trust policy for the role assuming Lambda.
- `package.json` — Node package manifest (add deps before deploying).
- `output.json`, `response.json` — Local logs/diagnostics.

## Prerequisites

- AWS account with permissions to: `ec2:DescribeInstances`, `ec2:RunInstances`, `iam:PassRole` (for the instance profile), and S3 read of your scraper zip.
- An S3 bucket containing `design-hackathon-scraper.zip` at its root (the zip should contain `server.js` and whatever your scraper needs).
- A security group ID that allows outbound internet (and optional SSH inbound if you plan to debug).
- An EC2 key pair name (optional if you won’t SSH, but required by current defaults).
- An instance profile/role attached to EC2 that at least grants `s3:GetObject` for your bucket.

## Configuration

Set these environment variables on the Lambda function:

- `AWS_REGION` — AWS region (defaults to `ap-south-1`).
- `S3_BUCKET` — Bucket name that holds `design-hackathon-scraper.zip` (required).
- `KEY_PAIR_NAME` — EC2 KeyPair name for SSH access (required by current code).
- `SECURITY_GROUP_ID` — Security group ID to attach (required).
- `IAM_INSTANCE_PROFILE` — Name of the instance profile to attach to EC2 (required).

AMI default in code: `ami-03f4878755434977f` (Amazon Linux 2 in `ap-south-1`). If you run in another region, update the AMI.

## Install dependencies (local)

The Lambda uses AWS SDK v3 but it’s not bundled by Lambda runtimes—you must package dependencies with the function.

Optional (for local packaging):

```bash
# from repo root
npm init -y                                  # if you haven’t
npm install @aws-sdk/client-ec2 --save
```

Make sure `package.json` includes `@aws-sdk/client-ec2` before you zip and upload the Lambda.

## Deploy

You can deploy via the AWS Console or CLI. Below is a concise CLI path.

Optional:

```bash
# zip the Lambda (include node_modules if present)
zip -r lambda-scheduler.zip lambda-scheduler.js node_modules package.json package-lock.json

# create the function (example for Node.js 20.x)
aws lambda create-function \
	--function-name design-hackathon-scheduler \
	--runtime nodejs20.x \
	--role arn:aws:iam::<ACCOUNT_ID>:role/<LAMBDA_EXEC_ROLE> \
	--handler lambda-scheduler.handler \
	--zip-file fileb://lambda-scheduler.zip \
	--region ap-south-1

# set environment variables
aws lambda update-function-configuration \
	--function-name design-hackathon-scheduler \
	--environment "Variables={AWS_REGION=ap-south-1,S3_BUCKET=<bucket>,KEY_PAIR_NAME=<keypair>,SECURITY_GROUP_ID=<sg-xxxx>,IAM_INSTANCE_PROFILE=<instance-profile-name>}"

# update code later
aws lambda update-function-code \
	--function-name design-hackathon-scheduler \
	--zip-file fileb://lambda-scheduler.zip
```

If you prefer IaC, wire this into Terraform/SAM/CDK and export the same env vars.

## Invoke

Invoke manually, via API Gateway, EventBridge (cron), or any upstream trigger.

Optional:

```bash
aws lambda invoke \
	--function-name design-hackathon-scheduler \
	--payload '{}' \
	--cli-binary-format raw-in-base64-out \
	out.json && cat out.json
```

Expected response when an instance is already running:

```json
{ "message": "Scraper instance already running" }
```

On a new launch you’ll get an `instanceId`.

## Troubleshooting

- Module not found errors (e.g., `Cannot find module '@aws-sdk/client-ec2'`):
	- Ensure you ran `npm install @aws-sdk/client-ec2` and packaged `node_modules` with the Lambda zip, or use a Lambda Layer that provides the dependency.
- Instance stuck in `pending`:
	- Check quotas, subnet/SG config, or AMI availability in your region.
- UserData didn’t run:
	- SSH to the instance and inspect `/var/log/cloud-init-output.log` and `journalctl -u design-hackathon-scraper`.
- S3 access denied:
	- Verify the EC2 instance role has `s3:GetObject` on your bucket/prefix and that Lambda’s role can `iam:PassRole` for that instance profile.

## Security notes

- Do not commit private keys. This repo’s `.gitignore` includes `*.pem` to avoid accidental commits.
- Prefer EC2 Instance Connect or SSM Session Manager over SSH keys when possible.
- Scope the instance profile to least-privilege for your S3 bucket only.
- Consider adding an explicit shutdown timer in your scraper if it’s meant to be ephemeral.

## Cost tips

- Use `t2.micro`/`t3.micro` and only run when needed.
- Keep the scraper light. Headless browsers are heavy—install only what you need.
- Auto-stop/terminate when the job completes.

## Roadmap ideas

- Parameterize AMI and instance type via env vars.
- Optional EBS size/env var for heavy scrapes.
- Replace SSH keys with SSM Session Manager by default.
- Ship logs to CloudWatch Logs automatically from the instance.

---

If you found this useful, star the repo and share it. Questions or ideas? Open an issue.

