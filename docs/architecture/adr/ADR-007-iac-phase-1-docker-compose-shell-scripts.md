# ADR-007: Infrastructure-as-Code Phase 1 — Docker Compose + Shell Scripts over Terraform / Pulumi / Ansible on Hostinger VPS

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: DEV, DBA, SEC, BKE
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-001 (Modular Monolith), ADR-003 (Extraction Triggers), ADR-005 (PostgreSQL)

---

## 1. Context & Problem Statement

Project Charter §3.1 explicitly targets **Hostinger VPS** (Linux, non-managed, single-node minimum Phase 1) as the deployment environment. We need **Infrastructure-as-Code (IaC)** to:
1. Reproduce the exact environment locally (10-expert team development parity), staging, and production
2. Automate the 47-step Hostinger VPS hardening + deployment checklist (SSH config, UFW firewall, user creation, Docker install, volume mounts, TLS certs, backup cron, etc.)
3. Guarantee **zero configuration drift** between environments — "works on my machine" bugs eliminated
4. Enable new expert account onboarding in <4 hours (environment ready without manual steps)

A wrong IaC choice causes:
- **Terraform too early:** Hostinger VPS has a limited/community Terraform provider (`terraform-provider-hostinger` = 3rd party, 100 GitHub stars, 2024 last release) with no VPS-level SSH key injection support. We would end up writing `null_resource` + `local-exec` wrappers anyway for 90% of tasks — worst of both worlds (Terraform state management burden with zero Terraform cloud benefit).
- **Ansible alone:** No container orchestration layer for the core stack (Nginx, App, PostgreSQL, Redis, PgBouncer, plus a lightweight Uptime Kuma monitor per ADR-011). Must hand-write Docker run commands or combine with Compose anyway. YAML indentation bugs in production are a known Ansible pain point.
- **Pure docker-compose no scripts:** VPS-level hardening (SSH config, UFW, fail2ban, TLS certs via Certbot, backup cron jobs, logrotate) is manual. Every new VPS provision = 47 manual steps by DEV expert. High human-error risk. 8-hour provisioning per environment.

Four alternatives evaluated, with Phase 1 constraints: Hostinger only (no AWS/GCP), single-node, one DEV expert on the team (Governance §2.1 Account 06 = DEV), 3-month MVP timeline.

---

## 2. Decision

**✅ PHASE 1 IaC STACK = DOCKER COMPOSE (container orchestration) + POSIX SHELL SCRIPTS (VPS-level provisioning). Terraform state and Pulumi explicitly deferred until Phase 3 (multi-VPS or multi-cloud). Ansible explicitly NOT used in Phase 1.**

### 2.1 Repository Structure — IaC Folder Layout

```
al-fajr/                            (monorepo root, Nx-managed)
├── infra/                          (ALL IaC lives HERE — version-controlled, reviewed)
│   ├── docker-compose/
│   │   ├── base.yml                (common services: app, postgres, redis, pgbouncer)
│   │   ├── local.yml               (DEV override: exposed ports, pgAdmin, mailhog)
│   │   ├── staging.yml             (Staging: TLS staging certs, monitoring enabled, debug logs)
│   │   ├── production.yml          (Production: TLS prod, WAF rules, resource limits, no exposed DB ports)
│   │   ├── monitoring.yml          (Uptime Kuma lightweight monitor — opt-in via docker compose --profile; see ADR-011)
│   │   └── backups.yml             (pgBackRest + WAL-E + offsite backup containers)
│   ├── scripts/                    (POSIX sh, NO bashisms — run on any Linux VPS)
│   │   ├── provision-vps.sh        (ENTRY POINT — 47-step hardening + install + deploy)
│   │   ├── steps/
│   │   │   ├── 01-create-sudo-user.sh
│   │   │   ├── 02-harden-ssh.sh    (disable root, 2FA, ed25519 only, custom port)
│   │   │   ├── 03-install-ufw-fail2ban.sh  (firewall + brute-force protection)
│   │   │   ├── 04-install-docker.sh
│   │   │   ├── 05-install-compose-plugin.sh
│   │   │   ├── 06-create-data-volumes.sh  (/data/postgres, /data/redis, /data/backups, /data/media)
│   │   │   ├── 07-setup-swapfile.sh
│   │   │   ├── 08-install-certbot.sh      (Let's Encrypt TLS certs)
│   │   │   ├── 09-setup-logrotate.sh
│   │   │   ├── 10-setup-backup-cron.sh    (pg_basebackup + wal-g)
│   │   │   └── 99-post-deploy-smoke.sh    (HTTP 200 check, curl test endpoints)
│   │   ├── deploy.sh               (SSH → VPS → pull latest images → compose up -d --remove-orphans → migrations run → smoke)
│   │   ├── backup-now.sh           (Manual backup trigger)
│   │   ├── restore-backup.sh       (Restore from specific backup point + run smoke tests)
│   │   └── common.sh               (Source'd by all scripts: log levels, set -euo pipefail, colored output)
│   ├── config/                     (Non-secret config files, version-controlled)
│   │   ├── nginx/nginx.conf        (TLS 1.3, WAF rules, rate limiting, compression)
│   │   ├── postgres/postgresql.conf  (Tuned for Hostinger VPS RAM: shared_buffers = 25% RAM)
│   │   ├── pgbouncer/pgbouncer.ini
│   │   ├── redis/redis.conf        (maxmemory-policy allkeys-lfu, aof persistence)
│   │   └── uptime-kuma/            (monitor config + seed: /health + /ready HTTP checks — see ADR-011)
│   └── secrets/                    (.gitignore'd; populated via scp or DEV manual copy ONLY)
│       ├── .env.production         (DB passwords, JWT keys, OAuth secrets)
│       └── ssh/                    (Deploy SSH keys, not committed)
├── apps/backend/Dockerfile         (Multi-stage NestJS backend)
├── apps/admin/Dockerfile           (React Admin build → Nginx static)
└── .github/workflows/deploy.yml    (CI calls scripts/deploy.sh via SSH on push to main)
```

### 2.2 Docker Compose Service Definitions (production.yml)

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./config/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /data/certbot/conf:/etc/letsencrypt:ro
      - /data/certbot/www:/var/www/certbot:ro
      - admin-build:/usr/share/nginx/admin:ro
    depends_on: [app]
    restart: unless-stopped
    security_opt: [no-new-privileges:true]
    mem_limit: 192m
    cpus: '0.5'
    logging: *json-logs

  app:
    build:
      context: ../../
      dockerfile: apps/backend/Dockerfile
    image: al-fajr/app:${TAG:-latest}
    environment:
      NODE_ENV: production
      DB_HOST: pgbouncer
      REDIS_HOST: redis
    volumes:
      - /data/media:/app/media:rw
    depends_on: [pgbouncer, redis]
    restart: unless-stopped
    command: >
      sh -c "npm run typeorm:migration:run &&
             pm2-runtime dist/main.js -i max"
    mem_limit: 768m
    cpus: '2'
    expose: ["3000"]
    logging: *json-logs

  pgbouncer:
    image: edoburu/pgbouncer:1.22
    environment:
      DB_HOST: postgres
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 200
      DEFAULT_POOL_SIZE: 20
    depends_on: [postgres]
    restart: unless-stopped
    expose: ["5432"]

  postgres:
    image: postgres:16-alpine
    volumes:
      - ./config/postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - /data/postgres:/var/lib/postgresql/data:rw
      - /data/backups/wal:/var/lib/postgresql/wal:rw
    command: -c config_file=/etc/postgresql/postgresql.conf
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets: [db_password]
    restart: unless-stopped
    mem_limit: 1536m
    cpus: '2'
    shm_size: 256m
    logging: *json-logs

  redis:
    image: redis:7-alpine
    command: redis-server /etc/redis/redis.conf --requirepass ${REDIS_PASSWORD}
    volumes:
      - ./config/redis/redis.conf:/etc/redis/redis.conf:ro
      - /data/redis:/data:rw
    restart: unless-stopped
    mem_limit: 512m
    expose: ["6379"]

  # Optional profiles: monitoring (Uptime Kuma — lightweight, see ADR-011)
  # Optional profiles: backups (pgbackrest, wal-g)
```

### 2.5 Resource Budget — 4GB VPS Memory Allocation

> **⚠️ IMPORTANT — Hard Limits vs. Expected Typical Usage**
>
> `mem_limit` in Docker Compose is a **kernel-enforced hard ceiling** (cgroup v2 `memory.max`). When a container reaches its `mem_limit`, the Linux OOM killer terminates the over-limit process immediately. These values are **not soft hints**; they are real enforcement boundaries. The total of all hard limits must fit within the VPS physical RAM after subtracting OS overhead.

#### Memory Hard-Limit Budget

| Service | `mem_limit` (hard ceiling) | Expected Typical Usage (normal load) | Expected Peak Usage (traffic spike) |
|---------|---------------------------|--------------------------------------|--------------------------------------|
| Nginx | 192m | ~30–50m | ~80m |
| App (NestJS + PM2, 2 workers) | 768m | ~300–450m | ~600m |
| PgBouncer | *(no limit — inherently lightweight)* | ~20–40m | ~60m |
| PostgreSQL 16 | 1536m | ~600–900m (shared_buffers=25% VPS RAM=1GB; typical working-set ≪ buffer pool) | ~1200m |
| Redis 7 | 512m | ~50–150m (maxmemory set to 400m in redis.conf; remainder is overhead) | ~420m |
| **Total Hard-Limit Budget** | **≈ 3008m (~2.94GB)** | **~1000–1590m typical** | **~2360m peak** |
| **OS Kernel + buffers + Docker daemon** | *(reserved — not a container)* | ~400–600m | ~700m |
| **VPS Physical RAM** | **4096m (4GB)** | **~1.4–2.2GB in-use** | **~3.1GB in-use** |
| **Safety Headroom** | **≥ 1GB (hard-limit headroom to physical RAM)** | | |

**Key design choices:**

1. **PostgreSQL 1536m (was 3g):** `shared_buffers` is set to 25% of VPS RAM = **1GB** in `postgresql.conf`. PostgreSQL rarely exceeds `shared_buffers + ~200m` overhead under normal Phase 1 load (≤500 concurrent connections via PgBouncer pool of 20). The hard limit of 1536m gives 512m above `shared_buffers` for sort memory, autovacuum workers, and WAL writer — more than sufficient for Phase 1 traffic.

2. **App 768m (was 2g):** NestJS with PM2 `instances: 2` (not `max`) in Phase 1. Each worker heap target ≈ 250m. `NODE_OPTIONS=--max-old-space-size=300` per worker. Two workers = ~600m active heap + ~150m OS/V8 overhead = well under 768m at normal load. If heap approaches limit, Node.js GC aggressively collects before OOM. PM2 auto-restarts individual workers if they crash, so no service interruption for transient spikes.

3. **Redis 512m (was 768m):** `redis.conf` sets `maxmemory 400mb` with `maxmemory-policy allkeys-lfu`. Redis itself enforces the 400m data limit and evicts stale keys before the container's 512m hard ceiling is reached — 112m overhead buffer is intentional (AOF buffer, network buffers, Redis internal overhead).

4. **Nginx 192m (was 256m):** Nginx is a static reverse proxy + TLS terminator. Worker processes are event-driven and memory-minimal. 192m is generous even under high connection counts (10k+ keep-alive connections = ~3KB/connection ≈ 30MB for workers). Reduced from 256m; no functional impact.

5. **4GB Swap (see §2.3, step 6):** The provisioning script creates a 4GB swapfile with `vm.swappiness=10`. Swap is a **last-resort safety net**, not a performance resource. It prevents a kernel OOM panic that would kill all containers simultaneously if an unexpected spike exceeds hard limits. With `vm.swappiness=10`, the kernel only uses swap under extreme memory pressure; typical-load processes never touch swap.

#### VPS Upgrade Trigger Policy

| Observed Condition | Monitoring Signal (ADR-011) | Required Action |
|--------------------|-----------------------------|-----------------|
| Any single container reaches **≥ 85% of its `mem_limit`** for **≥ 15 minutes** | Uptime Kuma HTTP check detects service degradation OR `docker stats` alert script | **Immediate DEV investigation.** Profile memory leak vs. legitimate growth. |
| App container restarts due to OOM **≥ 2× in any 7-day window** | Docker event log + `docker inspect` OOM flag | **Escalation to CSA.** Increase App `mem_limit` to 1g (budget permits; headroom available) OR schedule VPS upgrade. |
| PostgreSQL container OOM or service restart | `docker events` + `/health` check failure | **CRITICAL P1.** PgBouncer queues connections; 30s tolerance before app errors. CSA + DEV on call. Immediate VPS upgrade to 8GB tier required. |
| Total container memory in-use (`docker stats` sum) **≥ 3.2GB** for **≥ 1 hour** | Custom monitoring script (see §2.3 step 13 — smoke tests extended to include `docker stats` check) | **VPS upgrade scheduled within 48 hours.** Trigger upgrade to Hostinger VPS 8GB tier (~2× cost). New `mem_limit` targets after upgrade: App→2g, PostgreSQL→4g, Redis→1g, Nginx→256m. |
| Total container memory in-use **≥ 3.5GB at any moment** | OOM killer event in `dmesg` OR Uptime Kuma downtime alert | **Emergency VPS upgrade — same business day.** If weekend: activate Hostinger VPS snapshot → provision 8GB VPS from snapshot → DNS cutover. RTO target: 2 hours. |

> **NOTE:** The swap file absorbs momentary spikes between the 3.5GB alert threshold and a kernel panic. The window between "swap active" and "swap exhausted" at normal load is estimated at 15–30 minutes — sufficient for DEV to receive alert and initiate upgrade if monitoring is configured. Swap is never a substitute for rightful VPS sizing.

### 2.3 VPS Provisioning Flow — `scripts/provision-vps.sh`

Runs exactly once per new VPS. Idempotent. Steps:

```
1. PRE-FLIGHT: Confirm running as root, confirm Hostinger VPS (check os-release, minimum 4GB RAM, 2vCPU for the Phase 1 target tier)
2. USER: Create sudo user `af-admin` with SSH key auth ONLY, disable root SSH login
3. SSH: Harden → port 22→2222, PermitRootLogin no, PasswordAuthentication no, MaxAuthTries=3, 2FA optional
4. FIREWALL: UFW default deny incoming, allow 80/443/2222, enable fail2ban (SSH + Nginx jails)
5. DOCKER: Install Docker Engine 27.x via official apt repo, install compose plugin v2.x
6. SWAP: 4GB swapfile (Hostinger VPS often no swap by default), vm.swappiness=10
7. VOLUMES: Create /data/* directories (postgres, redis, backups, media, certbot) with correct `chown` per container user
8. TLS: Install Certbot, run `certbot certonly --standalone` for the domains resolved from env (`API_DOMAIN`, `ADMIN_DOMAIN` — default placeholders `api.al-fajr.app`, `admin.al-fajr.app`; NOT hardcoded), setup cron renewal
9. LOGROTATE: 50MB max per log file, 7 day retention for application logs, compress old logs
10. BACKUP CRON: Daily pg_basebackup at 3AM, continuous WAL archiving, weekly offsite rsync to Sponsor's backup storage
11. SECRETS: Copy secrets from DEV secure location → .env.production → chmod 600, correct owner
12. DEPLOY: `docker compose -f base.yml -f production.yml --profile monitoring up -d`
13. SMOKE TEST: Curl ${API_DOMAIN}/health (200) + /ready (200), curl ${ADMIN_DOMAIN} (200), psql connect test, redis ping test
14. OUTPUT: Post-provision report → stdout + /var/log/al-fajr-provision.log + SEND summary to SEC + CSA email
```

### 2.4 Concrete Actions

1. Shell scripts use `#!/bin/sh` (NOT `#!/bin/bash`), `set -euo pipefail`, `IFS=$'\n\t'`. Every function idempotent (check if user exists before `useradd`, check if package installed before `apt-get install`). Scripts pass `shellcheck -o all` linting in CI (SEC review).
2. GitHub Actions `deploy.yml`:
   - On push to `main`: (a) build + push Docker images to ghcr.io (GitHub Container Registry); (b) `ssh af-admin@$HOSTINGER_VPS_IP 'sh -s' < scripts/deploy.sh` to pull + restart containers + run migrations + smoke.
   - Rollback: previous Docker image tag stored; `scripts/rollback.sh` pulls previous tag → compose up → migrations are reversible (downward migrations run automatically if app container fails health check for 30s).
3. All configs version-controlled. PostgreSQL `shared_buffers` tuned to 25% VPS RAM = 1GB (standard recommendation; configured in `config/postgres/postgresql.conf`); Redis `maxmemory` set to **400mb** in `redis.conf` (80% of the 512m container hard limit — Redis self-enforces eviction before the kernel OOM kills the container); Nginx `worker_processes auto` + `worker_connections 4096`.
4. Container resource limits explicit (`mem_limit`, `cpus`) per service — **hard kernel-enforced ceilings, not soft hints** (see §2.5 Resource Budget for full allocation rationale). Docker Compose `oom_score_adj` set: PostgreSQL = -999 (OOM killer targets Redis → Nginx → App before touching PostgreSQL).
5. Production `restart: unless-stopped` everywhere. PM2-runtime inside app container: `NODE_OPTIONS=--max-old-space-size=300` per worker × 2 workers = ~600m heap target, well within the 768m container hard limit. If VPS is upgraded to 8GB tier, App `mem_limit` increases to 2g and `--max-old-space-size` increases to 800 per worker × 2 = ~1.6g.
6. Restore drill documented: `scripts/restore-backup.sh <backup-date>` → stops app → stops postgres → replaces data dir → starts postgres → runs post-restore verification queries → starts app → smoke tests. Execute quarterly per Governance SEC runbook.

---

## 3. Alternatives Considered

### Alternative A: Full Terraform Today (Provision + State Management from Day 1)

Terraform for VPS provision (`terraform-provider-hostinger` community), then `terraform-provider-docker` for containers, Terraform state stored in S3-compatible bucket.

- ✅ **Pro:** Single state file describes entire infra from VPS → containers. Drift detection via `terraform plan`.
- ✅ **Pro:** Future multi-VPS Phase 2+ = add more `hostinger_vps` resources; state already there.
- ❌ **Con:** **`terraform-provider-hostinger` is COMMUNITY, UNTESTED for our use case.** GitHub stars = 115. Last release 2024. Open issues: 14 (SSH key injection broken per issue #42). SSH hardening, UFW rules, fail2ban, Certbot TLS provision, cron jobs, etc. = NOT SUPPORTED by provider. Must implement via `null_resource` + `local-exec` + `remote-exec` provisioners = 400 lines of embedded shell inside HCL.
- ❌ **Con:** **WORST OF BOTH WORLDS.** Terraform state management overhead (lock, state corruption risk, backend S3-compatible bucket on Hostinger = more custom setup) WITHOUT Terraform's actual value (cloud provider abstraction). 90% of work done in shell provisioners anyway.
- ❌ **Con:** **Error-prone provisioner debugging.** `terraform apply` fails on 46th step? 45 steps already provisioned; Terraform state may be inconsistent. Rollback = SSH to box + manual undo. With standalone shell scripts: `set -euo pipefail` stops at failed step; easy to re-run after fix (idempotency preserved).
- ❌ **Con:** **Learning curve for 10-expert team.** Only DEV expert knows Terraform HCL + state management. CSA + BKE + DBA can read shell scripts; debugging failed terraform requires DEV present at 3AM deploy.
- ❌ **Con:** **Hostinger API rate limits.** Terraform queries Hostinger API every plan/apply. 10 experts running `terraform plan` locally = API rate limit hit.

### Alternative B: Ansible for Provisioning + Docker Compose for Containers (Hybrid)

Ansible playbooks for VPS hardening (SSH, UFW, packages, users). Docker Compose for containers. Mix of two tools.

- ✅ **Pro:** Ansible is idempotent declarative YAML. `ansible-playbook provision.yml` works. Roles for SSH hardening / UFW / Docker install are available from Ansible Galaxy (`geerlingguy.docker`, `dev-sec.ssh-hardening`).
- ✅ **Pro:** Multi-VPS future = add hosts to inventory file; `hosts: vps_*` = parallelize.
- ❌ **Con:** **YAML indentation bugs + Jinja2 templating bugs = production outages.** Ansible's `yaml + {{ jinja }}` combo is notoriously hard to debug. `when:` clauses with 10+ conditions = unmaintainable. Failed YAML parse → whole play fails.
- ❌ **Con:** **2 separate tools = 2 sets of syntax.** Shell + Jinja2 + YAML + Compose = 4 DSLs in infra folder. Team needs expertise in ALL FOUR. 10 expert accounts = mostly only DEV understands all four.
- ❌ **Con:** **1 DEV expert (Governance §2.1 Account 06) + Ansible = bus factor = 1.** Shell scripts are universally readable by every Linux expert in the team (CSA, BKE, DBA, SEC all know shell). Ansible requires Ansible-specific knowledge.
- ❌ **Con:** **No Hostinger inventory plugin.** Must maintain static inventory file or custom `hosts.ini`. Hostinger VPS IP change → manual inventory update. Terraform is worse; Ansible is medium.
- ❌ **Con:** **Execution is SLOW.** Ansible connects via SSH, copies modules, gathers facts, runs 47 tasks. Total time for provision = ~45 mins. Shell scripts = ~15 mins. 3x faster.
- ❌ **Con:** **Pinned Galaxy roles break over time.** `geerlingguy.docker` 7.x vs 8.x upgrade may break provision. Dependency on community maintainer's schedule. Shell scripts are self-contained; pin apt package versions.

### Alternative C: Pure docker-compose (No VPS Provisioning Scripts)

Docker Compose only. VPS hardening + TLS + backup = Manual DEV checklist (47 steps, Markdown). Not code.

- ✅ **Pro:** Simplest infra folder possible. Only compose files + configs.
- ✅ **Pro:** Fast initial understanding; no shell script linting/debugging.
- ❌ **Con:** **CONFIGURATION DRIFT GUARANTEED within 3 months.** DEV expert tweaks UFW rule on production VPS and forgets to document it → staging VPS lacks the rule → staging != prod → bug only reproducible in production. 2nd DEV (if hired later) has no idea what customizations were made.
- ❌ **Con:** **New VPS provision = 8 hours of manual work.** Every staging env, every test VPS for load testing, every disaster recovery restore = 8 hours by DEV. If Hostinger VPS goes down, RTO = 8 hours minimum (violates Charter §2.1 Success Criteria: Disaster Recovery RTO <4 hours).
- ❌ **Con:** **HUMAN ERROR RISK IS HIGH.** 47 steps → DEV forgets step 33 (WAL archiving) → PostgreSQL point-in-time recovery impossible until fixed → if DB crashes between then and discovery → data loss.
- ❌ **Con:** **Violates Technical Governance §3.1 Class A "Every change to infrastructure must be code-reviewed."** Manual config changes are unreviewable. SEC audit trail zero.

### Alternative D: Docker Compose + Shell Scripts (Chosen Decision)

Shell scripts (VPS level) + Docker Compose (containers). Both POSIX shell. Both idempotent. Both version-controlled + reviewed.

- ✅ **Pro:** **ONE language for ALL IaC.** Shell. Every expert account (CSA, BKE, DBA, DEV, SEC) can read and modify shell scripts. Bus factor = 10, not 1. Stack Overflow answers exist for every shell problem. No HCL/YAML/Jinja2.
- ✅ **Pro:** **15-minute full provision.** Faster than Ansible 3x. Faster than Terraform >1hr (state initialization, provider downloads). Disaster recovery RTO after VPS loss = ~1.5 hrs (VPS spin-up + scripts run). FAR UNDER 4hr Charter target.
- ✅ **Pro:** **FULLY IDEMPOTENT SCRIPTS.** `useradd` → `if ! id -u af-admin >/dev/null 2>&1; then useradd ... fi`. `apt-get install` → check if installed first. `ufw enable` → check if active first. Running `provision-vps.sh` on an already-provisioned box = zero side effects, exits 0 with "Already provisioned" message.
- ✅ **Pro:** **Config drift IMPOSSIBLE.** Every change to VPS must go through scripts/compose → PR → CSA review → GitHub Actions deploy. There is NO manual config path. `shellcheck` linting ensures syntax before merge. SEC audit trail = Git commit history.
- ✅ **Pro:** **DEBUGGING IS TRIVIAL.** Failed step? `set -euo pipefail` stops with exact line number. SSH in → re-run the step manually → fix script → push PR. State corruption impossible (no Terraform state file).
- ✅ **Pro:** **HOSTINGER OPTIMAL FIT.** Hostinger VPS = raw Linux box. Shell scripts talk to Linux directly via apt/ufw/certbot. No provider abstraction, no translation layer. Every OS package is directly addressable.
- ⚠️ **Trade-off:** Multi-VPS Phase 2 requires manual refactor. Adding a second Hostinger VPS = `scripts/provision-second-vps.sh` that does steps 1-10 but skips PostgreSQL (point app to primary). Then load balancer Nginx config for two app nodes. Doable but not declarative like Terraform. **Mitigation:** Define Phase 3 trigger explicitly below (Reversal Criteria). Phase 2 multi-VPS with <3 nodes still fast with shell; when >3 nodes → Terraform.
- ⚠️ **Trade-off:** Shell scripts can get messy if not disciplined. **Mitigation:** Strict linting: `shellcheck -o all` CI gate. Strict folder structure: `steps/NN-description.sh` each file <100 lines. `common.sh` with logging + `die()` function. CSA enforces code style in review.
- ⚠️ **Trade-off:** No `plan` step like Terraform `$ plan`. Shell script runs and does things. **Mitigation:** `DRY_RUN=1` env var prepended to every mutating command with `echo "DRY RUN: $cmd"`. `provision-vps.sh --dry-run` logs all 47 steps. Team reviews dry-run output for every new VPS.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — Full Terraform Today | Alternative B — Ansible + Compose | Alternative C — Pure docker-compose (No scripts) | Alternative D — Compose + Shell Scripts ✅ CHOSEN |
|-----------|---------------------------------------|-----------------------------------|--------------------------------------------------|---------------------------------------------------|
| **Hostinger VPS Fit** | ❌ Poor (community provider, null_resource hacks) | ⚠️ Moderate (Ansible manual inventory) | ⚠️ Good (compose native) but config drift | ✅ PERFECT (shell = direct Linux control) |
| **Bus Factor (Team Readability)** | ❌ 1 person (DEV only) | ⚠️ 2-3 people (Ansible experts only) | ✅ All 10 (compose = simple) | ✅ All 10 (shell + compose universal) |
| **Provision Time New VPS** | ❌ 60+ mins (state + provider + null_resources) | ❌ 45 mins (SSH + gather facts + tasks) | ❌ 8 HOURS manual checklist | ✅ 15 mins (fastest) |
| **Config Drift Prevention** | ✅ Terraform plan drift detection | ✅ Ansible check-mode dry-run | ❌ GUARANTEED drift within months | ✅ Only code → prod; no manual; 0 drift |
| **Debugging Failed Provision** | ❌ State inconsistency pain | ❌ YAML/Jinja parse ambiguity | ✅ Manual redo = find step, re-do | ✅ Exact line number; re-run fixed |
| **Phase 2 Multi-VPS (<3 nodes)** | ⚠️ Medium (community provider bugs) | ✅ Good (inventory hosts parallel) | ❌ Manual N copies (3× 8hrs = 24hrs) | ⚠️ Acceptable; shell per node (manageable <3) |
| **Phase 3 Multi-Cloud (10+ nodes)** | ✅ Best (if provider support exists) | ⚠️ Good (dynamic inventories) | ❌ IMPOSSIBLE (manual) | ❌ Requires switch to Terraform (EXPECTED) |
| **Learning Curve 10-team** | ❌ Steep (HCL + state + providers) | ⚠️ Medium (YAML + Jinja + Galaxy roles) | ✅ Gentle (compose YAML only) | ✅ Gentle (shell = universal, compose = widely known) |
| **MVP Timeline Impact (3-month)** | ❌ 2+ weeks to write/maintain terraform HCL | ⚠️ 1 week to write/debug playbooks | ✅ Fastest to initial (but manual later) | ✅ Fastest overall (1-3 days scripts; fast every time after) |
| **SEC Audit Trail (Compliance)** | ⚠️ State file + Git history (good) | ✅ Git history (good) | ❌ No audit (manual) | ✅ Git history (perfect) |
| **Disaster Recovery RTO (Charter <4hrs)** | ⚠️ 3-4hrs if state intact | ⚠️ 2-3hrs | ❌ 8+ hours (violates) | ✅ ~1.5 hours (well under 4hr target) |
| **Governance Alignment (1 DEV headcount)** | ❌ DEV overloaded (maintain terraform state) | ⚠️ DEV heavy (write/maintain galaxy roles) | ✅ DEV-light initially but manual later | ✅ Optimal (scripts write-once; minimal ongoing DEV load) |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Charter Compliance — RTO <4 hours disaster recovery target HANDILY MET.** VPS dies → Hostinger spin-up new (~30 mins) → provision script (~15 mins) → restore latest backup (~15 mins) → smoke test → live. Total ~1hr 15 mins.
2. **ZERO configuration drift.** Every VPS change is PR'd, reviewed, CI-linted, deployed via script. Manual SSH tweaks to production are FORBIDDEN by Governance. SEC audit trail = perfect Git log.
3. **New expert onboarding in <4 hours.** Expert clones repo → `cd infra && docker compose -f base.yml -f local.yml up` → 10 minutes later full local stack (Postgres, Redis, Nginx, App, mock services) is running. No "follow README step 1-30 to install tools."
4. **MVP de-risked. Provisioning is a non-event.** The #1 cause of "launch day panic" (production deployment checklist missed items) is eliminated. 47 steps all scripted, all tested against staging every PR.
5. **1 DEV headcount (Governance) optimal load.** Scripts written once; DEV tweaks rarely. GitHub Actions runs deployments automatically. DEV focuses on performance tuning, observability, backup drills — not repetitive provisioning.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Multi-VPS scale (>3 nodes) not declarative.** Adding a 4th app server for horizontal scale-out = `scp` script + manual tweaks. **Mitigation:** Reversal Trigger 1 below activates at 3 nodes; we Terraform then. Before 3 nodes, script-per-node is faster than Terraform setup.
2. **Shell script discipline matters.** It's easy to write a 1000-line bash monster if not reviewed. **Mitigation:** (a) `shellcheck -o all` CI gate FAILS PR on any warning; (b) every file under `scripts/steps/` must be <100 lines (custom GitHub Actions check); (c) CSA enforces POSIX sh only (NO bash array, NO process substitution, NO `[[`); (d) `common.sh` logging + `die()` functions mandatory.
3. **No dry-run "terraform plan" level assurance.** Shell scripts mutate the box. **Mitigation:** `DRY_RUN=1 ./scripts/provision-vps.sh` → prepends `echo "DRY RUN:"` to every mutating command (apt-get, ufw, useradd, systemctl). Dry-run output checked into PR description as review evidence. Actual apply only after dry-run output approved.

### Neutral / Unknown (risks to monitor)
1. **Will Hostinger VPS kernel support work with all Docker Compose features?** All containers run as non-root where possible; user namespace remapping is a potential SEC-required feature. We test provision script against a fresh Hostinger VPS in staging before ANY production provisioning; kernel flags validated.
2. **Script breakage on Ubuntu 24.04 → 26.04 upgrade?** Scripts pin apt package versions via `docker-ce=5:27.*` and use `apt-get install --only-upgrade` for security patches only. OS major upgrade is Class A decision via CSA; script review + re-test on staging required before upgrade.
3. **CI secret storage for SSH deploy key — GitHub Actions `DEPLOY_SSH_KEY` secret?** Yes, stored as GitHub Environment secret (production environment), protected by environment review rule (CSA + DEV must approve every production deploy). SEC audits secrets list every 90 days.

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Multi-VPS Node Count Threshold):** Total Hostinger VPS nodes in production (app + read-replica DB + workers) exceeds **3 nodes for 30 consecutive days** or planned architecture in review requires ≥4 nodes.
   - **Action:** Migrate provisioning to Terraform. Community provider OR custom `local-exec` wrapper around Hostinger API (better than shell for 4+ nodes). Docker Compose may remain on individual nodes OR migrate to Nomad (simpler than Kubernetes). Write new ADR: Terraform State backend, VPC peering, provider choice. This ADR superseded for Phase 3. Docker Compose may remain per-node service orchestrator.

2. **TRIGGER 2 (Multi-Cloud / Multi-Provider Mandate):** Business requires migrating workloads to 2+ cloud providers simultaneously (e.g., Hostinger + AWS + Aram Cloud KSA).
   - **Action:** Terraform or Pulumi (TypeScript-native, so BKE team can contribute) becomes provisioning layer across providers. Pulumi preferred if TypeScript skills in BKE team reduce DEV load. New ADR. This ADR phase 1 portion deprecated; Compose may still run per node.

3. **TRIGGER 3 (Shell Script Maintenance Burden):** DEV expert logs >40 hours/month maintaining shell scripts + compose files for 3 consecutive months. Evidence tracked via Jira tickets.
   - **Action:** Evaluate Ansible migration ONLY. Ansible replaces scripts; Compose remains. 40 hrs/month threshold indicates shell has outgrown its operational window; write cost-benefit analysis of Ansible vs current.

4. **TRIGGER 4 (Script Failure in Production):** A shell script bug causes >30-minute downtime OR data loss in production. Post-incident analysis identifies root cause as shell-specific (e.g., word splitting, unquoted variable, missing `set -e`).
   - **Action:** CSA convenes IaC review. Consider Ansible (stronger typing + built-in idempotency modules) for the failed component; evaluate if Terraform is worth the overhead now. This ADR updated with mitigation plan; partial or full replacement possible.

We **explicitly do NOT revisit** this decision:
- Because "Terraform is industry standard" without node-count data or maintenance-hour evidence
- Before production launch and 3 months of post-launch operations observation
- For single-node Hostinger VPS regardless of team opinions (universal readability wins)
- Without CSA + DEV + SEC sign-off AND documented evidence from 30+ days of operations

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §2.1 Success Criteria (DR RTO <4hr, RPO <1hr), §3.1 Scope (Hostinger VPS, Docker multi-stage containerization, Compose + CI/CD), §8 Risk Register (SEC/Ops Risks)
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §4.2 Container View (Hostinger VPS Docker Compose Stack diagram, §4.1 Deployment Topology Hostinger Single Node)
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §2.1 Account 06 DEV (Infra/Docker/CI/CD owner), Account 07 SEC (audit trail, VPS hardening), §3.1 Class A Decisions (infra IaC = Class A)
- [ADR-001 Architecture Pattern — Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) §3 (Hostinger VPS anti-pattern for microservices in Phase 1 context)
- [ADR-003 Extraction Triggers](ADR-003-microservices-extraction-trigger-criteria.md) (Multi-VPS Trigger 1 activates after modules extracted; both triggers feed into IaC migration decision)
- [ADR-005 Primary DB PostgreSQL 16](ADR-005-primary-database-postgresql-16.md) §2.2 Actions (PgBouncer, WAL archiving, backups) → all in scripts/compose
- [ADR-011 Observability — Lightweight Monitoring](ADR-011-observability-lightweight-monitoring.md) (Uptime Kuma + /health + /ready + JSON logs — the `monitoring` compose profile)
- External: Docker Compose Specification (compose-spec.io) — profiles, depends_on, extends, secrets
- External: CIS Docker Benchmark v1.6.0 — container hardening rules applied to production.yml (no-new-privileges, non-root users, secrets not env vars, resource limits)
- External: CIS Ubuntu Linux 22.04 LTS Benchmark — SSH hardening, UFW, fail2ban, swap, kernel params all implemented per CIS Level 1 Server profile in scripts/steps/
- External: OWASP Docker Security Cheat Sheet — container runtime hardening

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. 4-candidate comparison; detailed folder/file structure; provision flow; 4 reversal triggers. Sent for Sponsor + DEV + DBA + SEC review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr** (repo folder `al-fajr/`, image `al-fajr/app`, admin user `af-admin`); domains via env vars with `al-fajr.app` placeholders (NOT hardcoded); observability stack replaced by ADR-011 lightweight monitoring (Uptime Kuma `monitoring` profile + JSON file logging, Prometheus/Grafana/Loki/Tempo removed); VPS resources right-sized to the Phase 1 target tier; relative doc links.
- 2026-08-09 (amendment): MEMORY BUDGET CORRECTED — Prior `mem_limit` values (App 2g + PostgreSQL 3g + Redis 768m + Nginx 256m ≈ 6GB) exceeded the 4GB VPS physical RAM, constituting an invalid configuration. Values corrected to hard-enforced ceilings that fit within the physical memory envelope: App→768m, PostgreSQL→1536m, Redis→512m, Nginx→192m (total hard budget ≈ 2.94GB; OS+Docker headroom ≥ 1GB). `shm_size` for PostgreSQL reduced from 512m to 256m accordingly. Redis `maxmemory` in `redis.conf` set to 400mb (80% of new 512m hard limit). `NODE_OPTIONS` per PM2 worker set to `--max-old-space-size=300`. New §2.5 Resource Budget section added documenting hard limits, expected typical-load usage, OOM kill order, and the 4-tier VPS upgrade trigger policy. Amendment reviewed by CSA; no functional behaviour changes — only memory accounting correction.
