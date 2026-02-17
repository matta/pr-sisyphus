# Patch Pilot: Serverless Deployment & Architecture

## Overview
Patch Pilot is designed to run in modern serverless and containerized environments. It is built as a GitHub App using Probot, but with specific adaptations to ensure compatibility with stateless, on-demand execution models.

## Deployment Target
The primary target runtime is **Node.js 24 (Current)** or **Node.js 20 (Active LTS)**. 
- The project is configured to require `node >= 24` in `package.json`.
- CI/CD workflows run on Node.js 24.
- This creates alignment with edge-native environments (like Cloudflare Workers via compatibility flags) and modern FaaS providers (AWS Lambda, Vercel).

## Architectural Changes for Serverless

### 1. Scheduler Endpoint
Original Probot apps often rely on long-running `setInterval` loops for background tasks. This is incompatible with serverless functions which spin down when idle. 

**Solution:**
We expose a dedicated HTTP endpoint for triggering background reconciliation sweeps:
- **URL:** `GET /patch-pilot/scheduler` (or `PATCH`)
- **Mechanism:** This endpoint iterates through all verified installations and repositories, performing the merge logic on demand.
- **Trigger:** This endpoint functions as a webhook target for an external scheduler (e.g., Cloud Scheduler, GitHub Actions cron workflow, cron-job.org).

### 2. Stateless Execution
The application logic is designed to be stateless:
- **Event-Driven:** It reacts to GitHub webhooks (`pull_request.labeled`, `check_run.completed`, etc.) immediately.
- **On-Demand Reconciliation:** The sweeper logic does not maintain in-memory state between runs. It fetches the current state of locks and PRs from the GitHub API every time it runs.

## recommended Environment Variables
When deploying, ensure the standard Probot environment variables are set:
- `APP_ID`
- `PRIVATE_KEY` (or `PRIVATE_KEY_PATH`)
- `WEBHOOK_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## Future Considerations
- **Cloudflare Workers:** While the current codebase runs on Node.js, deploying to Cloudflare Workers requires the `@probot/adapter-cloudflare-workers` adapter. The codebase is already structured to support this transition by avoiding direct dependencies on Node.js-specific APIs where possible.
