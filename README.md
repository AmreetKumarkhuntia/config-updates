# config-updates

A small internal ops tool to **patch config objects in cloud buckets** and **invalidate the
CDN cache** (GCP load balancer / URL map, or AWS CloudFront distribution) so the new config is
served immediately instead of stale, cached bytes.

> Supports **GCP** (GCS + Cloud CDN) and **AWS** (S3 + CloudFront), selectable from a **stack**
> dropdown. Both sit behind a single `ConfigStore` interface (`src/lib/server/providers/`), so
> the UI and endpoints are provider-agnostic.

## What it does

1. Pick a **stack** (GCP / AWS), a **bucket** (from an allowlist), and enter an object **path**.
2. **Load current** — fetches and shows the current object content (or "will be created").
3. Paste the **new config**.
4. **Review changes** — shows a line diff; validates JSON for `.json` paths.
5. **Confirm & push** — backs up the previous version locally, uploads the new content, then
   invalidates the CDN cache on the selected **whitelisted** targets (GCP load balancers or
   AWS CloudFront distributions).

### Safety guarantees

- **Allowlists only.** The server refuses any bucket or invalidation target not in the selected
  stack's allowlist — `GCP_BUCKETS` / `GCP_URL_MAPS` for GCP, `AWS_BUCKETS` / `AWS_DISTRIBUTIONS`
  for AWS (HTTP 403). The UI selection is never trusted — every write/invalidate is re-checked
  server-side.
- **Backup before overwrite.** The previous content is written to `BACKUP_DIR` before upload.
- **Diff + explicit confirm** before anything is pushed.

## Stack

SvelteKit (Svelte 5) + Vite + TypeScript, `@sveltejs/adapter-node`, pnpm.
GCP access via `@google-cloud/storage` and `@google-cloud/compute` (`UrlMapsClient`).
AWS access via `@aws-sdk/client-s3` and `@aws-sdk/client-cloudfront`.

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in the values
pnpm dev               # http://localhost:5173
```

### Environment (`.env`)

| Var                              | Purpose                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`                 | GCP project that owns the buckets and load balancers. **Optional when a key file is used** (derived from the key JSON's `project_id`); **required when using ADC**. |
| `GCP_KEY_FILE`                   | Path to a service-account JSON key. Leave unset to use ADC.                                                                                                         |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard GCP key-file var; honored as a fallback to `GCP_KEY_FILE`. In a pod, mount the SA secret and set this — it is picked up automatically.                     |
| `GCP_BUCKETS`                    | Comma-separated bucket allowlist (the only buckets the tool can touch).                                                                                             |
| `GCP_URL_MAPS`                   | Comma-separated URL map allowlist for invalidation. Entry = `name` or `name\|display.domain`.                                                                       |
| `AWS_REGION`                     | Region for the S3 / CloudFront clients. Required to use the AWS stack.                                                                                              |
| `AWS_BUCKETS`                    | Comma-separated S3 bucket allowlist for the AWS stack.                                                                                                              |
| `AWS_DISTRIBUTIONS`              | Comma-separated CloudFront distribution allowlist. Entry = `distributionId` or `distributionId\|display.domain`.                                                    |
| `BACKUP_DIR`                     | Local directory for pre-overwrite backups (default `./backups`).                                                                                                    |
| `LOG_LEVEL`                      | Minimum log level: `debug` \| `info` \| `warn` \| `error` (default `info`). Set `NO_COLOR=1` to disable ANSI colors.                                                |

AWS credentials are read from the standard SDK env chain — export your temp creds
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`); the app never handles them.
A stack only appears in the dropdown if it has at least one bucket configured.

**Auth** resolves in this order:

1. **Service-account key file** — `GCP_KEY_FILE`, then `GOOGLE_APPLICATION_CREDENTIALS`. A pod
   that mounts the SA secret and sets the standard var works with no app-specific config, and
   `GCP_PROJECT_ID` can be omitted (read from the key JSON).
2. **Application Default Credentials (ADC)** — when no key file is set. For local development run
   `gcloud auth application-default login` (note: **not** plain `gcloud auth login`, which only
   authenticates the `gcloud` CLI). On GCP-hosted compute the attached service account is used.
   `GCP_PROJECT_ID` is required for this path.

### Required IAM (on the service account)

- GCS objects on the allowlisted buckets: `roles/storage.objectAdmin` (or get + create).
- CDN invalidation: `compute.urlMaps.invalidateCache` (e.g. `roles/compute.loadBalancerAdmin`).

For the **AWS** stack, the exported credentials need:

- S3 on the allowlisted buckets: `s3:GetObject`, `s3:PutObject` (and `s3:ListBucket` for the
  reachability check).
- CloudFront invalidation: `cloudfront:CreateInvalidation` on the allowlisted distributions.

## Logging

Server-side logs are colorized, leveled, and scoped (`(http)`, `(api:update)`, `(gcp)`, `(aws)`,
`(backup)`, `(config)`), written to stdout/stderr. Each request and every cloud operation is logged
with its concrete facts — stack, bucket, path, byte size, backup path, invalidation target, and
operation id — so you can see exactly **what was pushed and what each step did**.

- `LOG_LEVEL` (`debug|info|warn|error`, default `info`) sets the threshold. Full config **bodies**
  are only emitted at `debug`; `info` logs metadata, not content.
- Colors auto-disable when stdout is not a TTY (piped to a file, pod logs); `NO_COLOR=1` forces them
  off even on a TTY.

## API

- `GET /api/config?stack=&bucket=&path=` → `{ content, exists, contentType }`
- `POST /api/config/update` — body `{ stack, bucket, path, content, urlMaps[] }` → backup →
  upload → invalidate; returns `{ stack, backupPath, uploaded, contentType, invalidations[] }`.
  `stack` defaults to `gcp`; `urlMaps[]` holds GCP URL map names or AWS CloudFront distribution ids.

## Project layout

```
src/
  lib/
    types.ts                 shared UI/server types
    diff.ts                  LCS line diff (browser-safe)
    server/
      config.ts              env getters + allowlist guards
      backup.ts              local pre-overwrite backup
      logger.ts              server-only colorized leveled logger
      providers/
        types.ts             ConfigStore interface
        gcp.ts               GCS + UrlMapsClient implementation
        aws.ts               S3 + CloudFront implementation
        index.ts             getProvider(stack) factory
  hooks.server.ts            request access logs + centralized error logging
  routes/
    +page.svelte             the UI (stack + bucket selectors)
    +page.server.ts          exposes per-stack allowlists to the UI
    api/config/+server.ts            GET current config
    api/config/update/+server.ts     POST update + invalidate
```

## Scripts

- `pnpm dev` — dev server
- `pnpm build` / `pnpm preview` — production build (adapter-node) / preview
- `pnpm check` — `svelte-check` type checking
