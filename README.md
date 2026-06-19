# config-updates

A small internal ops tool to **patch config objects in GCS buckets** and **invalidate the
GCP Cloud CDN cache** on the load balancer (URL map) so the new config is served immediately
instead of stale, cached bytes.

> Scope is **GCP only** for now. The storage/CDN logic sits behind a `ConfigStore` interface
> (`src/lib/server/providers/`), so an AWS (S3 + CloudFront) provider can be added later
> without touching the UI or endpoints.

## What it does

1. Pick a **bucket** (from an allowlist) and enter an object **path**.
2. **Load current** — fetches and shows the current object content (or "will be created").
3. Paste the **new config**.
4. **Review changes** — shows a line diff; validates JSON for `.json` paths.
5. **Confirm & push** — backs up the previous version locally, uploads the new content, then
   invalidates the CDN cache on the selected **whitelisted** load balancers.

### Safety guarantees

- **Allowlists only.** The server refuses any bucket not in `GCP_BUCKETS` and any URL map not
  in `GCP_URL_MAPS` (HTTP 403). The UI selection is never trusted — every write/invalidate is
  re-checked server-side.
- **Backup before overwrite.** The previous content is written to `BACKUP_DIR` before upload.
- **Diff + explicit confirm** before anything is pushed.

## Stack

SvelteKit (Svelte 5) + Vite + TypeScript, `@sveltejs/adapter-node`, pnpm.
GCP access via `@google-cloud/storage` and `@google-cloud/compute` (`UrlMapsClient`).

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
| `BACKUP_DIR`                     | Local directory for pre-overwrite backups (default `./backups`).                                                                                                    |

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

## API

- `GET /api/config?bucket=&path=` → `{ content, exists, contentType }`
- `POST /api/config/update` — body `{ bucket, path, content, urlMaps[] }` → backup → upload →
  invalidate; returns `{ backupPath, uploaded, contentType, invalidations[] }`.

## Project layout

```
src/
  lib/
    types.ts                 shared UI/server types
    diff.ts                  LCS line diff (browser-safe)
    server/
      config.ts              env getters + allowlist guards
      backup.ts              local pre-overwrite backup
      providers/
        types.ts             ConfigStore interface
        gcp.ts               GCS + UrlMapsClient implementation
        index.ts             getProvider() factory
  routes/
    +page.svelte             the UI
    +page.server.ts          exposes allowlists to the UI
    api/config/+server.ts            GET current config
    api/config/update/+server.ts     POST update + invalidate
```

## Scripts

- `pnpm dev` — dev server
- `pnpm build` / `pnpm preview` — production build (adapter-node) / preview
- `pnpm check` — `svelte-check` type checking
