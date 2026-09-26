#!/bin/bash
# Optional, one time: make the church's own code-signing certificate for Cool Services releases.
# With it, macOS keeps "Always Allow" for Cool Services' Keychain item across updates.
#
#   bash scripts/make-signing-cert.sh
#
# Then add the two printed values as GitHub secrets (repo → Settings → Secrets and variables →
# Actions): MAC_CERT_P12 and MAC_CERT_PASSWORD. Keep cool-services-signing.p12 somewhere safe and
# out of the repository; if it's lost, make a new one (macOS asks about the Keychain once more).
set -euo pipefail
OPENSSL=/usr/bin/openssl
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
PASS="$($OPENSSL rand -hex 16)"
cat >"$DIR/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Cool Services Code Signing
O = Cool Services
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF
$OPENSSL req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -config "$DIR/cert.cnf" 2>/dev/null
$OPENSSL pkcs12 -export -inkey "$DIR/key.pem" -in "$DIR/cert.pem" -name "Cool Services Code Signing" -out cool-services-signing.p12 -passout "pass:$PASS"
echo
echo "✓ Made cool-services-signing.p12 (valid 10 years). Don't commit it."
echo
echo "Add these two GitHub secrets (repo → Settings → Secrets and variables → Actions → New repository secret):"
echo
echo "  MAC_CERT_PASSWORD = $PASS"
echo "  MAC_CERT_P12      = (copied to your clipboard now)"
base64 -i cool-services-signing.p12 | tr -d '\n' | pbcopy
echo
echo "Paste the clipboard as the value of MAC_CERT_P12."
