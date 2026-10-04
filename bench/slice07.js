'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Slice 0.7 tasks: long briefs that require reading several files before a
 * script can be written. Pre-registered in BENCH-DESIGN.md (commit 8d4f230).
 *
 * All content is synthetic and generated deterministically from a fixed seed,
 * so no benchmark material is involved and every cell sees identical files.
 * The target sizes come from Right Fit's measured situation before Kimi's first
 * create: brief ~1.8k characters, ~9 exploration turns, ~21k characters.
 */

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

function writeAll(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text, 'utf8');
  }
}

function deliverable(dir, rel) {
  const f = path.join(dir, rel);
  if (!fs.existsSync(f)) return { ok: false, detail: `${rel} does not exist` };
  const g = fs.readFileSync(f, 'utf8');
  return g.length > 400 && /def /.test(g) ? { ok: true } : { ok: false, detail: `${rel} too small or has no function (${g.length} chars)` };
}

// --- T-sales -------------------------------------------------------------------
function salesFiles() {
  const r = rng(7101);
  const aliases = { north: ['North', 'NORTH', 'n.', 'Nord'], south: ['South', 'S.', 'Sued'], east: ['East', 'E', 'Ost'], west: ['West', 'W.', 'Westen'], central: ['Central', 'Ctr', 'Mitte'] };
  const allAlias = Object.values(aliases).flat();
  const skus = ['SKU-1001', 'SKU-1002', 'SKU-2040', 'SKU-3300', 'SKU-3301', 'SKU-4999'];
  const files = {};
  for (const q of ['q1', 'q2', 'q3']) {
    const rows = ['order_id,date,region,sku,qty,unit_price,currency'];
    for (let i = 0; i < 70; i++) {
      const m = { q1: 1, q2: 4, q3: 7 }[q] + Math.floor(r() * 3);
      const bad = r() < 0.06;
      rows.push([`${q.toUpperCase()}-${String(1000 + i)}`, `2026-${String(m).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`, pick(r, allAlias), pick(r, skus), bad ? pick(r, ['', 'n/a', '-3']) : String(1 + Math.floor(r() * 40)), (5 + r() * 95).toFixed(2), pick(r, ['EUR', 'EUR', 'EUR', 'USD'])].join(','));
    }
    files[`data/sales_2026_${q}.csv`] = rows.join('\n') + '\n';
  }
  files['data/regions.md'] = '# Region names\n\nThe field teams type region names by hand, so the raw files contain several spellings for each region. Normalise every spelling to the canonical lowercase key on the left.\n\n' +
    Object.entries(aliases).map(([k, v]) => `- \`${k}\`: ${v.map((x) => `\`${x}\``).join(', ')}`).join('\n') + '\n\nAny spelling not listed here is an error and the row must be counted under `unknown_region` in the report, not silently dropped.\n';
  files['data/fx.md'] = '# Currency conversion\n\nAll totals are reported in EUR. Rows priced in USD are converted at a fixed rate of 0.92 EUR per USD for the whole of 2026. Do not fetch live rates.\n';
  files['spec/report_format.md'] = '# Report format\n\nThe script prints a single JSON object to stdout with these keys:\n\n- `generated_for`: the string `"2026-Q1..Q3"`\n- `totals_by_region`: object mapping each canonical region key to its revenue in EUR, rounded to 2 decimals\n- `totals_by_quarter`: object with keys `q1`, `q2`, `q3`\n- `top_skus`: list of the three SKUs with the highest EUR revenue, each as `{"sku": ..., "revenue": ...}`, highest first\n- `rejected_rows`: integer count of rows skipped because `qty` is missing, non-numeric or negative\n- `unknown_region`: integer count of rows whose region spelling is not in `data/regions.md`\n\nRevenue for a row is `qty * unit_price`, converted to EUR where needed.\n';
  files['README.md'] = '# Regional sales reporting\n\nThis workspace holds raw quarterly exports from the order system (one CSV per quarter in `data/`), notes on how to interpret them, and the agreed report format in `spec/`. Previous reports were assembled by hand in a spreadsheet; this project replaces that with a script.\n';
  return files;
}

// --- T-logs ------------------------------------------------------------------
function logFiles() {
  const r = rng(7202);
  const svcs = ['auth', 'billing', 'search', 'gateway'];
  const msgs = { INFO: ['request ok', 'cache hit', 'user login', 'token refreshed'], WARN: ['slow upstream', 'retrying request', 'cache miss storm'], ERROR: ['upstream timeout', 'db connection reset', 'payment declined by processor'] };
  const files = {};
  for (let k = 1; k <= 3; k++) {
    const lines = [];
    for (let i = 0; i < 55; i++) {
      const lvl = r() < 0.7 ? 'INFO' : r() < 0.6 ? 'WARN' : 'ERROR';
      const ts = `2026-09-${String(10 + k).padStart(2, '0')}T${String(Math.floor(r() * 24)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}Z`;
      lines.push(`${ts} ${lvl.padEnd(5)} svc=${pick(r, svcs)} req=${Math.floor(r() * 1e6).toString(16)} latency_ms=${Math.floor(5 + r() * (lvl === 'INFO' ? 200 : 3000))} msg="${pick(r, msgs[lvl])}"`);
    }
    files[`logs/app-${k}.log`] = lines.join('\n') + '\n';
  }
  files['docs/log_format.md'] = '# Log line format\n\nEach line is `<ISO-8601 UTC timestamp> <LEVEL padded to 5> key=value ...`. Keys always present: `svc`, `req`, `latency_ms`, `msg`. `msg` is double-quoted and may contain spaces. Levels are INFO, WARN, ERROR.\n\nLines that do not match this format must be counted as `unparsed` and otherwise ignored.\n';
  files['docs/alerting.md'] = '# Alerting rules\n\n- A service is **degraded** if more than 10% of its lines are ERROR, or its p95 latency exceeds 2000 ms.\n- A service is **critical** if it is degraded on two or more of the three days.\n- p95 is computed per service per day with the nearest-rank method.\n\nThe on-call rotation reads the summary each morning, so the output must be stable: sort services alphabetically.\n';
  files['docs/output.md'] = '# Summary output\n\n`parse_logs.py` takes the log directory as its only argument and prints JSON:\n\n```\n{"days": {"<date>": {"<svc>": {"lines": n, "error_rate": x, "p95_ms": n, "degraded": bool}}},\n "critical": ["<svc>", ...], "unparsed": n}\n```\n\nRates are rounded to 3 decimals.\n';
  files['README.md'] = '# Ops log summariser\n\nThree days of application logs from the staging cluster are in `logs/`. The rules for what counts as degraded or critical, and the exact output shape, are in `docs/`. Write the summariser as a standalone script with no third-party dependencies.\n';
  return files;
}

// --- T-migrate -----------------------------------------------------------------
function configFiles() {
  const r = rng(7303);
  const files = {};
  for (const svc of ['auth', 'billing', 'search', 'gateway', 'notifier', 'reports', 'scheduler', 'storage']) {
    const lines = [`# ${svc} service, config format v1`, 'version: 1', `name: ${svc}`, 'listen:', `  host: 0.0.0.0`, `  port: ${8000 + Math.floor(r() * 900)}`, 'timeouts:', `  read_s: ${1 + Math.floor(r() * 30)}`, `  write_s: ${1 + Math.floor(r() * 30)}`, 'database:', `  url: postgres://${svc}:CHANGEME@db.internal:5432/${svc}`, `  pool: ${2 + Math.floor(r() * 20)}`, 'features:'];
    for (const f of ['dark_mode', 'beta_search', 'audit_log', 'rate_limit']) if (r() < 0.6) lines.push(`  - ${f}`);
    lines.push('logging:', `  level: ${pick(r, ['debug', 'info', 'warn'])}`, `  json: ${pick(r, ['true', 'false'])}`);
    if (r() < 0.5) lines.push('rate_limit:', `  rps: ${10 + Math.floor(r() * 500)}`, `  burst: ${5 + Math.floor(r() * 50)}`);
    lines.push('tls:', `  enabled: ${pick(r, ['true', 'false'])}`, `  cert_file: /etc/${svc}/tls.crt`, `  key_file: /etc/${svc}/tls.key`, `  min_version: ${pick(r, ['1.2', '1.3'])}`);
    lines.push('metrics:', `  enabled: true`, `  path: /metrics`, `  port: ${9100 + Math.floor(r() * 50)}`, 'upstreams:');
    for (const u of ['auth', 'billing', 'search', 'gateway', 'notifier'].filter((x) => x !== svc && r() < 0.6)) {
      lines.push(`  - name: ${u}`, `    url: http://${u}.internal:${8000 + Math.floor(r() * 900)}`, `    timeout_s: ${1 + Math.floor(r() * 10)}`, `    retries: ${Math.floor(r() * 4)}`);
    }
    lines.push('cache:', `  backend: ${pick(r, ['memory', 'redis'])}`, `  ttl_s: ${30 + Math.floor(r() * 3600)}`, `  max_entries: ${1000 * (1 + Math.floor(r() * 50))}`);
    files[`configs/${svc}.yaml`] = lines.join('\n') + '\n';
  }
  files['docs/schema_v2.md'] = '# Config format v2\n\nv2 groups settings by concern and removes secrets from files.\n\n- `version` becomes `2`.\n- `listen.host` and `listen.port` move to `server.bind` as a single string `"host:port"`.\n- `timeouts.read_s` / `write_s` move to `server.timeouts` and are expressed in milliseconds (`read_ms`, `write_ms`).\n- `database.url` is replaced by `database.dsn_env`, the name of an environment variable `<NAME>_DSN` (uppercase service name). The password must never appear in the output.\n- `features` (a list) becomes `features` (a mapping of feature name to `true`).\n- `rate_limit`, if present, moves under `server.rate_limit` unchanged.\n- `logging` is unchanged.\n- `tls` moves to `server.tls`. `cert_file` and `key_file` are renamed `cert_path` and `key_path`. `min_version` becomes a string prefixed with `TLS`, for example `"TLS1.3"`. If `enabled` is false, the whole `server.tls` block is omitted.\n- `metrics` moves to `observability.metrics` unchanged, except that `port` must differ from the server port: if they collide, report an error for that file.\n- `upstreams` (a list) becomes `upstreams` (a mapping from name to an object with `url`, `timeout_ms` and `retries`). Timeouts convert to milliseconds as above. Duplicate upstream names are an error.\n- `cache` is unchanged, except that `ttl_s` becomes `ttl_ms`.\n- Unknown top-level keys are an error: the script must report them and exit non-zero without writing anything.\n\n## Worked example\n\nA v1 file with `listen: {host: 0.0.0.0, port: 8080}`, `timeouts: {read_s: 5, write_s: 10}` and `database.url: postgres://svc:pw@db:5432/svc` becomes `server: {bind: "0.0.0.0:8080", timeouts: {read_ms: 5000, write_ms: 10000}}` and `database: {dsn_env: SVC_DSN, pool: ...}`. The string "pw" appears nowhere in the output.\n\n## Ordering\n\nTop-level keys in the output appear in this order: version, name, server, database, features, upstreams, cache, logging, observability. Within mappings, keys are sorted alphabetically. This keeps the generated files diffable across services.\n';
  files['docs/v1_reference.md'] = '# Config format v1 (reference)\n\nThis describes the v1 format as it exists in the repository today, including the quirks the migration has to handle.\n\n## Top-level keys\n\n- version: always 1 in v1 files.\n- name: the service name; must match the file name without extension.\n- listen: host and port the HTTP server binds to.\n- timeouts: read_s and write_s, integers in seconds. Some older services used floats; none remain in this repository, but the migration should accept "5" and "5.0" alike.\n- database: url (a full DSN including credentials, which is the reason v2 exists) and pool (connection pool size).\n- features: a list of enabled feature flags. A flag that is absent is disabled.\n- logging: level (debug, info, warn) and json (true or false).\n- rate_limit: optional; rps and burst.\n- tls: enabled, cert_file, key_file and min_version.\n- metrics: enabled, path and port of the Prometheus endpoint.\n- upstreams: a list of services this one calls, each with name, url, timeout_s and retries.\n- cache: backend (memory or redis), ttl_s and max_entries.\n\n## Known quirks\n\n1. Comments start with # and may appear on any line, including at the end of a value line.\n2. Booleans are written as true or false in lowercase; yes and no do not occur.\n3. Indentation is always two spaces. Lists use "- " at the parent indentation plus two.\n4. Strings are unquoted unless they contain a colon followed by a space.\n5. A few teams put an empty line between sections; empty lines carry no meaning.\n\n## Ownership\n\nEach service team owns its file. The platform team owns the migration script and the v2 schema. Questions about a specific value go to the owning team; questions about the format go to platform.\n';
  files['docs/rollout.md'] = '# Rollout\n\nThe migration script reads every `*.yaml` in `configs/`, writes the v2 result next to it as `<name>.v2.yaml`, and prints one line per file: `migrated <name>` or `error <name>: <reason>`. Original files are never modified. The YAML in this repository is simple enough that a full YAML library is not required, but using PyYAML is acceptable if it is imported lazily.\n';
  files['README.md'] = '# Config migration\n\nFive services still use the v1 config format in `configs/`. `docs/schema_v2.md` defines the target format and `docs/rollout.md` the expected behaviour of the migration script.\n';
  return files;
}

// --- T-client ------------------------------------------------------------------
function apiFiles() {
  const endpoints = [
    ['GET', '/v2/projects', 'List projects. Query: `page` (int, default 1), `per_page` (int, max 100). Response: `{"items": [...], "next_page": int|null}`.'],
    ['POST', '/v2/projects', 'Create a project. Body: `{"name": str, "visibility": "private"|"internal"}`. Returns 201 with the project.'],
    ['GET', '/v2/projects/{id}/runs', 'List runs for a project, newest first. Same pagination as projects.'],
    ['POST', '/v2/projects/{id}/runs', 'Start a run. Body: `{"ref": str, "params": object}`. Returns 202 with `{"run_id": str, "status": "queued"}`.'],
    ['GET', '/v2/runs/{run_id}', 'Get a run. `status` is one of `queued`, `running`, `succeeded`, `failed`, `cancelled`.'],
    ['POST', '/v2/runs/{run_id}/cancel', 'Cancel a run. Returns 409 if the run already finished.'],
  ];
  const files = {};
  files['docs/api.md'] = '# Pipelines API v2\n\nBase URL: `https://pipelines.example.internal`. All requests and responses are JSON. Errors use `{"error": {"code": str, "message": str}}`.\n\n' + endpoints.map(([m, p, d]) => `## ${m} ${p}\n\n${d}\n\nExample request:\n\n    ${m} ${p.replace('{id}', 'p_17').replace('{run_id}', 'r_9f3a')} HTTP/1.1\n    Host: pipelines.example.internal\n    Authorization: Bearer <token>\n    Accept: application/json\n\nStatus codes: the success status stated above; 400 invalid_request, 401 unauthenticated, 403 forbidden, 404 not_found, 429 rate_limited, 500 internal, 503 unavailable. See docs/errors.md for the expected caller action for each code. Responses carry an X-Request-Id header that should be included in any error raised to the caller, because support cannot trace a failure without it.\n`).join('\n') + '\n## Rate limits\n\nEach token may make 20 requests per second. A 429 response carries `Retry-After` in seconds; clients must wait that long and retry, at most 3 times.\n';
  files['docs/auth.md'] = '# Authentication\n\nSend `Authorization: Bearer <token>`. Tokens are read from the environment variable `PIPELINES_TOKEN`; the client must fail fast with a clear message if it is unset. Tokens expire after 12 hours and a 401 means the token must be refreshed by the caller, not retried.\n';
  files['examples/list_projects.json'] = JSON.stringify({ items: [{ id: 'p_17', name: 'ingest', visibility: 'internal' }, { id: 'p_23', name: 'reports', visibility: 'private' }], next_page: 2 }, null, 2) + '\n';
  files['examples/start_run.json'] = JSON.stringify({ run_id: 'r_9f3a', status: 'queued' }, null, 2) + '\n';
  files['examples/error_409.json'] = JSON.stringify({ error: { code: 'run_finished', message: 'Run r_9f3a already finished' } }, null, 2) + '\n';
  files['docs/requirements.md'] = '# Client requirements\n\n- Standard library only (`urllib.request`, `json`).\n- One class `PipelinesClient` with methods `list_projects()` (follows pagination and returns all items), `create_project(name, visibility)`, `start_run(project_id, ref, params)`, `get_run(run_id)`, `cancel_run(run_id)` and `wait_for_run(run_id, timeout_s)`, which polls every 2 seconds until a terminal status.\n- Raise `PipelinesError(code, message)` for API errors, using the error body.\n- Respect the rate-limit rules in `docs/api.md`.\n';
  files['docs/errors.md'] = '# Error codes\n\nEvery error response has the shape {"error": {"code": str, "message": str}}. The codes in use are listed below with the HTTP status they come with and what a caller is expected to do.\n\n| code | status | meaning | caller action |\n|---|---|---|---|\n| invalid_request | 400 | the body or query failed validation | fix the request; never retry unchanged |\n| unauthenticated | 401 | the token is missing, malformed or expired | refresh the token; do not retry with the same token |\n| forbidden | 403 | the token is valid but lacks access to this project | do not retry |\n| not_found | 404 | the project or run does not exist | do not retry |\n| run_finished | 409 | cancel was called on a run in a terminal state | treat as success if the goal was to stop the run |\n| name_taken | 409 | a project with this name already exists | choose another name |\n| rate_limited | 429 | too many requests for this token | wait Retry-After seconds, then retry, at most 3 times |\n| internal | 500 | an unexpected server error | retry once after 2 seconds, then give up |\n| unavailable | 503 | the service is being deployed | retry with backoff, at most 3 times |\n\nThe message field is meant for humans and may change; programs must branch on code, never on message.\n';
  files['docs/usage.md'] = '# How callers use the client today\n\nThese are the three call patterns the client must make easy. They are taken from the scripts the client is replacing.\n\n## 1. Nightly report\n\nThe reporting job lists every project, then for each project lists the runs of the last 24 hours and counts them by status. It runs at 02:00 and touches every project, so it is the job most likely to hit the rate limit. In the old script, a 429 crashed the job halfway and the report silently covered only some projects. With the client, list_projects must return every project across pages, and a 429 must be absorbed by waiting, never surfaced as a partial result.\n\n## 2. Release pipeline\n\nThe release script starts a run on the release project with ref set to the release branch and params containing env and shards, then calls wait_for_run with a timeout of 45 minutes. If the run fails, the script prints the failure step from the run body and exits non-zero. If the timeout expires, it cancels the run and exits non-zero. A cancel that returns run_finished must not be treated as an error, because the run may have finished between the last poll and the cancel.\n\n## 3. Ad-hoc scripts\n\nEngineers create throwaway projects for experiments with create_project, then delete them by hand in the UI. They frequently run into name_taken. The error raised by the client must carry the code so that a script can retry with a suffixed name without parsing the message.\n\n## Non-goals\n\nThe client does not need to support project deletion, run logs or artifact download; those endpoints are being redesigned. It does not need async support.\n';
  files['docs/changelog.md'] = '# API changelog\n\n## v2.3 (2026-08)\n\n- POST /v2/projects/{id}/runs now returns 202 instead of 201. Clients that checked for 201 must accept 202.\n- GET /v2/runs/{run_id} gained the cancelled status. Clients must treat it as terminal.\n\n## v2.2 (2026-06)\n\n- Pagination moved from an offset parameter to page and per_page. The response field next_page is null on the last page; clients must stop when it is null, not when a page comes back short.\n- per_page above 100 is now rejected with invalid_request instead of being silently capped.\n\n## v2.1 (2026-03)\n\n- Errors now always use the error envelope. Before this, some 404s returned an empty body.\n- Retry-After is now sent on every 429.\n\n## v2.0 (2026-01)\n\n- First version of the v2 API. v1 endpoints under /api/ are deprecated and return 410 since 2026-07.\n';
  files['examples/get_run_running.json'] = JSON.stringify({ run_id: 'r_9f3a', project_id: 'p_17', ref: 'main', status: 'running', started_at: '2026-09-30T08:14:02Z', finished_at: null, params: { env: 'staging', shards: 4 } }, null, 2) + '\n';
  files['examples/get_run_failed.json'] = JSON.stringify({ run_id: 'r_77c1', project_id: 'p_23', ref: 'release/2.4', status: 'failed', started_at: '2026-09-29T21:00:11Z', finished_at: '2026-09-29T21:07:45Z', params: { env: 'prod', shards: 8 }, failure: { step: 'integration-tests', reason: 'exit code 1' } }, null, 2) + '\n';
  files['examples/error_429.json'] = JSON.stringify({ error: { code: 'rate_limited', message: 'Rate limit of 20 requests per second exceeded; see Retry-After' } }, null, 2) + '\n';
  files['README.md'] = '# Pipelines client\n\nWe need a small Python client for the internal Pipelines API so that scripts stop hand-rolling HTTP calls. The API reference, authentication rules, client requirements and example responses are under `docs/` and `examples/`.\n';
  return files;
}

const BRIEF_CONTEXT = {
  X1: "\n\nSome background on why this matters. Last quarter two analysts produced two different EUR totals for the same region because one of them treated `Nord` as a separate region and the other converted USD at the day rate. Finance has asked for a single script that anyone can re-run and that encodes every rule explicitly, so that a disagreement can be traced to a line of code rather than to whoever happened to build the spreadsheet. The script will later be scheduled to run after each export, so it must not prompt for input or depend on the current directory.",
  X2: "\n\nSome background. Until now the on-call engineer opened each log file, grepped for ERROR and eyeballed latency, which meant a slow but error-free service was routinely missed, and different engineers disagreed about what counted as degraded. The alerting rules in the docs were agreed with the service owners last month and are now the single definition. The script will run from a cron job on a machine with only a system Python, so it must not need a virtual environment, and it must exit zero even when the logs contain garbage lines.",
  X3: "\n\nSome background. The v1 format grew organically and each team added keys in slightly different places, which is why v2 regroups everything by concern. The platform team will run the migration once per service during a change window, review the generated files, and only then delete the v1 files themselves. A previous attempt at this migration leaked a production password into a pull request through an error message, which is why the secrets rule is non-negotiable. Treat the documentation as the contract: if the docs and your intuition disagree, follow the docs.",
  X4: "\n\nSome background. The API sits behind a shared gateway, and when one script ignores Retry-After the whole team gets throttled. Two incidents last month came from scripts that retried a 401 in a tight loop and from a report that silently included only the first page of projects. The client will be vendored into several repositories, so keep it to a single file with a small, documented public surface, and make its errors informative enough that a caller can decide what to do without reading the client source. Type hints and docstrings on the public methods are expected, since the client will be read far more often than it is changed.",
};

const BRIEF_TAIL = '\n\nRead the files in the workspace before you start: the details you need (field names, spellings, rules and output shape) are in them, not in this message. Write the complete script in one file. You do not need to run it.';

const TASKS = [
  {
    id: 'X1', label: 'sales aggregation script',
    files: salesFiles,
    out: 'solution/aggregate.py',
    prompt: 'You are taking over the quarterly regional sales report. Until now an analyst built it by hand from the raw exports in /workspace/data, and the numbers have drifted between quarters because region names, bad rows and currencies were handled differently each time.\n\nYour job is to write /workspace/solution/aggregate.py, a script that reads all three quarterly CSV exports in /workspace/data and prints the report described in /workspace/spec/report_format.md. The rules for normalising region names are in /workspace/data/regions.md and the currency rule is in /workspace/data/fx.md. Rows with a missing, non-numeric or negative quantity must be skipped and counted, never guessed. Unknown region spellings must be counted, not dropped.\n\nThe finance team will diff this report against last year\'s, so the output must be deterministic: sort keys, round as specified, and do not depend on the order of files on disk. Use only the Python standard library.' + BRIEF_TAIL,
  },
  {
    id: 'X2', label: 'log summariser script',
    files: logFiles,
    out: 'tools/parse_logs.py',
    prompt: 'The on-call team wants a morning summary of the staging cluster instead of scrolling raw logs. Three days of application logs are in /workspace/logs, one file per day.\n\nWrite /workspace/tools/parse_logs.py. It takes the log directory as its single command-line argument and prints the JSON summary specified in /workspace/docs/output.md. The line format, including which lines must be counted as unparsed, is in /workspace/docs/log_format.md, and the definitions of a degraded and a critical service are in /workspace/docs/alerting.md, including how p95 must be computed.\n\nThe summary is read by people at 7am, so it must be stable and correct rather than clever: sort services alphabetically, round rates as specified, and make sure a malformed line can never crash the script. Standard library only; the staging hosts cannot install packages.' + BRIEF_TAIL,
  },
  {
    id: 'X3', label: 'config migration script',
    files: configFiles,
    out: 'migrate.py',
    prompt: 'We are moving five services from config format v1 to v2. The v1 files are in /workspace/configs, the target format is defined in /workspace/docs/schema_v2.md, and the expected behaviour of the migration tool (where outputs go, what it prints, what it must never touch) is in /workspace/docs/rollout.md.\n\nWrite /workspace/migrate.py. Two things matter more than anything else. First, secrets: the v1 files contain database passwords inside URLs, and none of them may appear in any output, including error messages. Second, safety: an unknown top-level key must stop the migration of that file with a clear error and a non-zero exit, rather than being dropped. Everything else follows the schema document exactly, including the unit conversion for timeouts and the new shape of the features section.' + BRIEF_TAIL,
  },
  {
    id: 'X4', label: 'API client module',
    files: apiFiles,
    out: 'client.py',
    prompt: 'Several teams call the internal Pipelines API with ad-hoc HTTP code, and they all get pagination, rate limits and errors slightly wrong. Write a small shared client at /workspace/client.py.\n\nThe endpoints and their request and response shapes are in /workspace/docs/api.md, authentication in /workspace/docs/auth.md, and the required public interface in /workspace/docs/requirements.md. Example responses are in /workspace/examples. Pay particular attention to the rate-limit rule (retry after the advertised delay, at most three times), to the difference between a 401 (do not retry) and a 429 (retry), and to pagination in list_projects, which must return every item rather than the first page.' + BRIEF_TAIL,
  },
].map((t) => ({
  id: t.id, label: t.label, prompt: t.prompt.replace(BRIEF_TAIL, BRIEF_CONTEXT[t.id] + BRIEF_TAIL), out: t.out, files: t.files,
  setup(dir) { writeAll(dir, t.files()); fs.mkdirSync(path.join(dir, path.dirname(t.out)), { recursive: true }); },
  verify(dir) { return deliverable(dir, t.out); },
}));

module.exports = { TASKS, rng };
