#!/usr/bin/env bash
# scripts/gen-jwt-keys.sh
#
# Generates an RSA-4096 key pair for JWT RS256 signing.
# Output:
#   secrets/jwt_private_key.pem  — kept on disk, never committed
#   secrets/jwt_public_key.pem   — kept on disk, never committed
#
# Also prints the inline env-var format for environments without file mounts
# (CI with secrets manager, Railway, Render, etc.).
#
# Prerequisites: openssl (available on macOS, Linux, WSL)
# Usage: bash scripts/gen-jwt-keys.sh

set -euo pipefail

SECRETS_DIR="$(dirname "$0")/../secrets"
mkdir -p "$SECRETS_DIR"

PRIVATE_KEY="$SECRETS_DIR/jwt_private_key.pem"
PUBLIC_KEY="$SECRETS_DIR/jwt_public_key.pem"

echo "🔑 Generating RSA-4096 key pair for JWT RS256..."

# Generate private key (RSA 4096-bit, PKCS#8 format)
openssl genrsa -out "$PRIVATE_KEY" 4096 2>/dev/null
chmod 600 "$PRIVATE_KEY"

# Extract public key
openssl rsa -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY" 2>/dev/null
chmod 644 "$PUBLIC_KEY"

echo ""
echo "✅ Keys generated:"
echo "   Private: $PRIVATE_KEY"
echo "   Public:  $PUBLIC_KEY"
echo ""
echo "── Inline format (for CI / cloud environments without file mounts) ──"
echo ""
echo "JWT_PRIVATE_KEY=$(cat "$PRIVATE_KEY" | tr '\n' '\\n' | sed 's/\\n$//')"
echo ""
echo "JWT_PUBLIC_KEY=$(cat "$PUBLIC_KEY" | tr '\n' '\\n' | sed 's/\\n$//')"
echo ""
echo "⚠️  Keep jwt_private_key.pem SECRET. Never commit it."
echo "   The secrets/ directory is in .gitignore."
