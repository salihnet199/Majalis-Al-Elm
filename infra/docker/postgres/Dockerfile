# Pinned digest — DO NOT change without running a full build test in dev first.
# Digest verified: 2026-08-18 | PostgreSQL 16.15 | Alpine 3.24 | LLVM 21
# See: docs/architecture/adr/ADR-015-pg-uuidv7-build-strategy-docker-alpine.md
# To upgrade: docker pull postgres:16-alpine → get new digest → test build in dev
FROM postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

# Install pg_uuidv7 extension (DB-001 — required for uuid_generate_v7())
# See: https://github.com/fboulnois/pg_uuidv7
#
# Compatibility fix (Alpine LLVM version mismatch):
#   postgres:16-alpine was compiled against LLVM 21, but Alpine package repos
#   have advanced to LLVM 22. The PGXS build system hardcodes the LLVM version
#   from pg_config, so `make` needs `clang-21` and `make install` needs
#   `/usr/lib/llvm21/bin/llvm-lto`. We create dynamic symlinks for both,
#   resolving whatever clang/llvm-lto is actually installed.
RUN apk add --no-cache --virtual .build-deps \
      git make gcc musl-dev postgresql-dev \
    && CLANG_BIN=$(find /usr/bin -name 'clang-[0-9]*' 2>/dev/null | sort -V | tail -1) \
    && ln -sf "$CLANG_BIN" /usr/local/bin/clang-21 \
    && LLVM_LTO=$(find /usr/lib -name 'llvm-lto' 2>/dev/null | grep -v '/llvm21/' | head -1) \
    && mkdir -p /usr/lib/llvm21/bin \
    && ln -sf "$LLVM_LTO" /usr/lib/llvm21/bin/llvm-lto \
    && git clone --depth 1 https://github.com/fboulnois/pg_uuidv7.git /tmp/pg_uuidv7 \
    && cd /tmp/pg_uuidv7 \
    && make \
    && make install \
    && cd / \
    && rm -rf /tmp/pg_uuidv7 \
    && apk del .build-deps
