<script lang="ts">
  import type { PageData } from "./$types";
  import { lineDiff, type DiffLine } from "$lib/diff";
  import type { CurrentConfigResponse, UpdateResult } from "$lib/types";

  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally
  let stack = $state(data.stacks[0]?.id ?? "gcp");
  const current = $derived(
    data.stacks.find((s) => s.id === stack) ?? data.stacks[0],
  );

  // svelte-ignore state_referenced_locally
  let bucket = $state(data.stacks[0]?.buckets[0] ?? "");
  let path = $state("");

  let currentContent = $state<string | null>(null);
  let currentExists = $state(false);
  let currentLoaded = $state(false);

  let newContent = $state("");
  // svelte-ignore state_referenced_locally
  let selectedUrlMaps = $state<string[]>(
    data.stacks[0]?.urlMaps.map((m) => m.name) ?? [],
  );

  function changeStack() {
    bucket = current?.buckets[0] ?? "";
    selectedUrlMaps = current?.urlMaps.map((m) => m.name) ?? [];
    resetTarget();
  }

  let loadingCurrent = $state(false);
  let downloading = $state(false);
  let backupMsg = $state("");
  let reviewing = $state(false);
  let submitting = $state(false);
  let errorMsg = $state("");
  let result = $state<UpdateResult | null>(null);

  const diff = $derived<DiffLine[]>(
    reviewing ? lineDiff(currentContent ?? "", newContent) : [],
  );
  const addCount = $derived(diff.filter((d) => d.type === "add").length);
  const delCount = $derived(diff.filter((d) => d.type === "del").length);
  const isJsonPath = $derived(path.trim().toLowerCase().endsWith(".json"));
  const jsonError = $derived.by(() => {
    if (!isJsonPath || !newContent.trim()) return "";
    try {
      JSON.parse(newContent);
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  });
  const hasChanges = $derived((currentContent ?? "") !== newContent);

  function resetTarget() {
    currentLoaded = false;
    reviewing = false;
    result = null;
    errorMsg = "";
  }

  async function loadCurrent() {
    resetTarget();
    if (!bucket || !path.trim()) {
      errorMsg = "Select a bucket and enter a path first.";
      return;
    }
    loadingCurrent = true;
    try {
      const res = await fetch(
        `/api/config?stack=${encodeURIComponent(stack)}&bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path.trim())}`,
      );
      if (!res.ok) {
        errorMsg =
          (await res.text()) ||
          `Failed to load current config (${res.status}).`;
        return;
      }
      const body: CurrentConfigResponse = await res.json();
      currentContent = body.content;
      currentExists = body.exists;
      currentLoaded = true;
      // Prefill the editor with the current content for convenient editing.
      if (!newContent && body.content) newContent = body.content;
    } catch (e) {
      errorMsg =
        e instanceof Error ? e.message : "Network error while loading config.";
    } finally {
      loadingCurrent = false;
    }
  }

  async function downloadBackup() {
    errorMsg = "";
    backupMsg = "";
    if (!bucket || !path.trim()) {
      errorMsg = "Select a bucket and enter a path first.";
      return;
    }
    downloading = true;
    try {
      const res = await fetch("/api/config/backup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stack, bucket, path: path.trim() }),
      });
      const text = await res.text();
      if (!res.ok) {
        errorMsg = text || `Download failed (${res.status}).`;
        return;
      }
      const body = JSON.parse(text) as { backupPath: string; bytes: number };
      backupMsg = `Saved ${body.bytes} bytes to ${body.backupPath}`;
    } catch (e) {
      errorMsg =
        e instanceof Error ? e.message : "Network error during download.";
    } finally {
      downloading = false;
    }
  }

  function review() {
    errorMsg = "";
    if (!currentLoaded) {
      errorMsg = "Load the current config before reviewing changes.";
      return;
    }
    if (jsonError) {
      errorMsg = `Cannot review — the new config is not valid JSON: ${jsonError}`;
      return;
    }
    if (!hasChanges) {
      errorMsg = "No changes between current and new config.";
      return;
    }
    reviewing = true;
  }

  async function confirmPush() {
    errorMsg = "";
    result = null;
    submitting = true;
    try {
      const res = await fetch("/api/config/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stack,
          bucket,
          path: path.trim(),
          content: newContent,
          urlMaps: selectedUrlMaps,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        errorMsg = text || `Update failed (${res.status}).`;
        return;
      }
      result = JSON.parse(text) as UpdateResult;
      reviewing = false;
      // The bucket now holds the new content.
      currentContent = newContent;
      currentExists = true;
    } catch (e) {
      errorMsg =
        e instanceof Error ? e.message : "Network error during update.";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Config Updates — {current?.label ?? "Cloud"}</title>
</svelte:head>

<main>
  <header>
    <h1>Config Updates</h1>
    <p class="sub">
      Patch a config object in a cloud bucket, then invalidate the CDN cache on
      the chosen targets. <span class="badge">{current?.label ?? "—"}</span>
    </p>
  </header>

  {#if data.stacks.length === 0}
    <div class="notice warn">
      No stacks are configured. Set <code>GCP_BUCKETS</code> and/or
      <code>AWS_BUCKETS</code> in your <code>.env</code>.
    </div>
  {/if}

  <section class="card">
    <div class="row">
      <label class="field">
        <span class="label">Stack</span>
        <select bind:value={stack} onchange={changeStack}>
          {#each data.stacks as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span class="label">Bucket</span>
        <select bind:value={bucket} onchange={resetTarget}>
          {#each current?.buckets ?? [] as b (b)}
            <option value={b}>{b}</option>
          {/each}
        </select>
      </label>

      <label class="field grow">
        <span class="label">Path</span>
        <input
          type="text"
          bind:value={path}
          oninput={resetTarget}
          placeholder="config/app-config.json"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
        />
      </label>

      <button class="btn" onclick={loadCurrent} disabled={loadingCurrent}>
        {loadingCurrent ? "Loading…" : "Load current"}
      </button>

      <button
        class="btn"
        onclick={downloadBackup}
        disabled={downloading || !bucket || !path.trim()}
        title="Save the current object to the local backup folder (works for any file, including binary)"
      >
        {downloading ? "Downloading…" : "Download to backup"}
      </button>
    </div>

    {#if backupMsg}
      <div class="notice ok">
        <span class="tag ok">backed up</span>
        <code>{backupMsg}</code>
      </div>
    {/if}
  </section>

  <section class="card">
    <div class="two-col">
      <div class="col">
        <div class="col-head">
          <span class="label">Current config</span>
          {#if currentLoaded}
            <span class="tag {currentExists ? 'ok' : 'new'}">
              {currentExists ? "exists" : "does not exist — will be created"}
            </span>
          {/if}
        </div>
        <pre class="viewer">{#if !currentLoaded}<span class="muted"
              >Load a path to see its current content.</span
            >{:else if currentContent === null}<span class="muted"
              >(empty / new object)</span
            >{:else}{currentContent}{/if}</pre>
      </div>

      <div class="col">
        <div class="col-head">
          <span class="label">New config</span>
          {#if isJsonPath}
            {#if jsonError}
              <span class="tag err">invalid JSON</span>
            {:else if newContent.trim()}
              <span class="tag ok">valid JSON</span>
            {/if}
          {/if}
        </div>
        <textarea
          class="editor"
          bind:value={newContent}
          placeholder="Paste the new config here…"
          spellcheck="false"></textarea>
        {#if jsonError}
          <p class="hint err">{jsonError}</p>
        {/if}
      </div>
    </div>
  </section>

  <section class="card">
    <span class="label"
      >Invalidate cache on (whitelisted {current?.targetLabel ??
        "targets"})</span
    >
    {#if (current?.urlMaps.length ?? 0) === 0}
      <p class="hint">
        No {current?.targetLabel ?? "targets"} configured. Set
        <code>{stack === "aws" ? "AWS_DISTRIBUTIONS" : "GCP_URL_MAPS"}</code> to enable
        cache invalidation.
      </p>
    {:else}
      <div class="lb-list">
        {#each current?.urlMaps ?? [] as m (m.name)}
          <label class="check">
            <input
              type="checkbox"
              bind:group={selectedUrlMaps}
              value={m.name}
            />
            <span class="lb-name">{m.name}</span>
            {#if m.domain}<span class="lb-domain">{m.domain}</span>{/if}
          </label>
        {/each}
      </div>
    {/if}
  </section>

  <section class="actions">
    <button
      class="btn primary"
      onclick={review}
      disabled={!currentLoaded || submitting}
    >
      Review changes
    </button>
  </section>

  {#if errorMsg}
    <div class="notice err">{errorMsg}</div>
  {/if}

  {#if reviewing}
    <section class="card">
      <div class="col-head">
        <span class="label">Diff</span>
        <span class="diff-stat"
          ><span class="add">+{addCount}</span>
          <span class="del">−{delCount}</span></span
        >
      </div>
      <div class="diff">
        {#each diff as line, i (i)}
          <div class="dl {line.type}">
            <span class="gutter"
              >{line.type === "add"
                ? "+"
                : line.type === "del"
                  ? "−"
                  : " "}</span
            ><span class="dl-text">{line.text}</span>
          </div>
        {/each}
      </div>

      <div class="confirm-bar">
        <div class="confirm-text">
          Push to <code>{bucket}/{path.trim()}</code>
          {#if selectedUrlMaps.length > 0}
            and invalidate <strong>{selectedUrlMaps.length}</strong>
            {stack === "aws"
              ? "distribution"
              : "load balancer"}{selectedUrlMaps.length > 1 ? "s" : ""}.
          {:else}
            <em>(no cache invalidation selected)</em>.
          {/if}
          The previous version will be backed up locally first.
        </div>
        <div class="confirm-btns">
          <button
            class="btn"
            onclick={() => (reviewing = false)}
            disabled={submitting}>Cancel</button
          >
          <button
            class="btn danger"
            onclick={confirmPush}
            disabled={submitting}
          >
            {submitting ? "Pushing…" : "Confirm & push"}
          </button>
        </div>
      </div>
    </section>
  {/if}

  {#if result}
    <section class="card result">
      <h2>Done</h2>
      <ul>
        <li>
          <strong>Uploaded</strong> to
          <code>{result.bucket}/{result.path}</code>
          <span class="muted">({result.contentType})</span>
        </li>
        <li>
          <strong>Backup:</strong>
          {#if result.backupPath}
            <code>{result.backupPath}</code>
          {:else}
            <span class="muted">{result.backupSkippedReason ?? "none"}</span>
          {/if}
        </li>
        <li>
          <strong>Invalidations:</strong>
          {#if result.invalidations.length === 0}
            <span class="muted">none requested</span>
          {:else}
            <ul class="inv-list">
              {#each result.invalidations as inv (inv.urlMap)}
                <li>
                  <span class="tag {inv.ok ? 'ok' : 'err'}"
                    >{inv.ok ? "ok" : "failed"}</span
                  >
                  <code>{inv.urlMap}</code>
                  {#if inv.ok && inv.operationId}<span class="muted"
                      >op {inv.operationId}</span
                    >{/if}
                  {#if !inv.ok && inv.error}<span class="hint err"
                      >{inv.error}</span
                    >{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      </ul>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0f1115;
    color: #e6e8ee;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      Helvetica,
      Arial,
      sans-serif;
  }
  :global(*) {
    box-sizing: border-box;
  }

  main {
    max-width: 980px;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
  }

  header h1 {
    margin: 0;
    font-size: 1.6rem;
    letter-spacing: -0.01em;
  }
  .sub {
    margin: 0.35rem 0 1.5rem;
    color: #9aa3b2;
    font-size: 0.92rem;
  }
  .badge {
    display: inline-block;
    background: #1d4ed8;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    vertical-align: middle;
    letter-spacing: 0.03em;
  }

  .card {
    background: #161922;
    border: 1px solid #232734;
    border-radius: 12px;
    padding: 1.1rem 1.2rem;
    margin-bottom: 1rem;
  }

  .row {
    display: flex;
    gap: 0.85rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .field.grow {
    flex: 1 1 320px;
  }
  .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #8a93a4;
    font-weight: 600;
  }

  select,
  input[type="text"],
  textarea {
    background: #0f1218;
    border: 1px solid #2a2f3d;
    color: #e6e8ee;
    border-radius: 8px;
    padding: 0.55rem 0.65rem;
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.12s ease;
  }
  select:focus,
  input[type="text"]:focus,
  textarea:focus {
    border-color: #3b82f6;
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  @media (max-width: 760px) {
    .two-col {
      grid-template-columns: 1fr;
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .viewer,
  .editor,
  .diff {
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.82rem;
    line-height: 1.5;
    border-radius: 8px;
    border: 1px solid #2a2f3d;
    background: #0b0e13;
    min-height: 240px;
    max-height: 440px;
    overflow: auto;
    margin: 0;
  }
  .viewer,
  .editor {
    height: 360px;
    min-height: 0;
    max-height: none;
    width: 100%;
  }
  .viewer {
    padding: 0.7rem 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .editor {
    padding: 0.7rem 0.8rem;
    resize: vertical;
  }

  .muted {
    color: #6b7280;
  }

  .tag {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.08rem 0.4rem;
    border-radius: 5px;
    letter-spacing: 0.02em;
  }
  .tag.ok {
    background: #064e3b;
    color: #6ee7b7;
  }
  .tag.new {
    background: #422006;
    color: #fbbf24;
  }
  .tag.err {
    background: #4c0519;
    color: #fda4af;
  }

  .hint {
    margin: 0.25rem 0 0;
    font-size: 0.78rem;
    color: #8a93a4;
  }
  .hint.err {
    color: #fda4af;
  }

  .lb-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.7rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: #0f1218;
    border: 1px solid #2a2f3d;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    cursor: pointer;
  }
  .lb-name {
    font-family: ui-monospace, monospace;
    font-size: 0.82rem;
  }
  .lb-domain {
    color: #6b7280;
    font-size: 0.76rem;
  }

  .actions {
    margin: 0.4rem 0 1rem;
  }

  .btn {
    background: #232a38;
    color: #e6e8ee;
    border: 1px solid #313a4d;
    border-radius: 8px;
    padding: 0.55rem 1rem;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.12s ease,
      opacity 0.12s ease;
  }
  .btn:hover:not(:disabled) {
    background: #2b3346;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: #2563eb;
    border-color: #2563eb;
  }
  .btn.primary:hover:not(:disabled) {
    background: #1d4ed8;
  }
  .btn.danger {
    background: #b91c1c;
    border-color: #b91c1c;
  }
  .btn.danger:hover:not(:disabled) {
    background: #991b1b;
  }

  .notice {
    border-radius: 8px;
    padding: 0.7rem 0.9rem;
    font-size: 0.86rem;
    margin-bottom: 1rem;
  }
  .notice.err {
    background: #2a0d14;
    border: 1px solid #7f1d1d;
    color: #fecaca;
  }
  .notice.warn {
    background: #2a1e07;
    border: 1px solid #92400e;
    color: #fde68a;
  }
  .notice.ok {
    background: #052e23;
    border: 1px solid #065f46;
    color: #a7f3d0;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.85rem;
    margin-bottom: 0;
    flex-wrap: wrap;
  }
  .notice.ok code {
    word-break: break-all;
  }

  .diff {
    padding: 0.4rem 0;
  }
  .dl {
    display: flex;
    padding: 0 0.6rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .dl .gutter {
    width: 1.2rem;
    flex: none;
    color: #6b7280;
    user-select: none;
  }
  .dl.add {
    background: rgba(16, 185, 129, 0.12);
  }
  .dl.add .gutter,
  .diff-stat .add {
    color: #34d399;
  }
  .dl.del {
    background: rgba(239, 68, 68, 0.12);
  }
  .dl.del .gutter,
  .diff-stat .del {
    color: #f87171;
  }
  .diff-stat {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .confirm-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #232734;
    flex-wrap: wrap;
  }
  .confirm-text {
    font-size: 0.86rem;
    color: #c2c8d4;
  }
  .confirm-btns {
    display: flex;
    gap: 0.6rem;
  }

  code {
    font-family: ui-monospace, monospace;
    font-size: 0.85em;
    background: #0b0e13;
    border: 1px solid #232734;
    border-radius: 5px;
    padding: 0.05rem 0.35rem;
  }

  .result h2 {
    margin: 0 0 0.6rem;
    font-size: 1.05rem;
  }
  .result ul {
    margin: 0;
    padding-left: 1.1rem;
    line-height: 1.7;
    font-size: 0.88rem;
  }
  .inv-list {
    margin: 0.3rem 0 0;
  }
</style>
