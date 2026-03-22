#!/usr/bin/env bash
#
# Reusable secret validation script for GitHub Actions workflows
# Usage: source .github/scripts/validate-secrets.sh && validate_supabase_secrets
#

set -euo pipefail

# Colors for output (if terminal supports it)
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  NC='\033[0m' # No Color
else
  RED=''
  GREEN=''
  YELLOW=''
  NC=''
fi

# Validate SUPABASE_PROJECT_ID format
validate_supabase_project_id() {
  local project_id="${1:-}"
  
  if [ -z "$project_id" ]; then
    echo "::error title=Missing Secret::SUPABASE_PROJECT_ID secret is not configured in the repository."
    echo ""
    echo "❌ SUPABASE_PROJECT_ID is missing"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Go to: Settings → Secrets and variables → Actions"
    echo "  2. Click 'New repository secret'"
    echo "  3. Name: SUPABASE_PROJECT_ID"
    echo "  4. Value: Your 20-character project ref (e.g., nvbicjjtnobnnscmypeq)"
    echo "  5. Get it from: Supabase Dashboard → Project Settings → General → Reference ID"
    echo ""
    return 1
  fi
  
  # Check if it contains URL patterns
  if echo "$project_id" | grep -qiE 'https?://|supabase\.co|\.co/|://'; then
    echo "::error title=Invalid Secret Format::SUPABASE_PROJECT_ID must be the project ref only, not a URL."
    echo ""
    echo "❌ SUPABASE_PROJECT_ID has invalid format"
    echo ""
    echo "Current value appears to be a URL or contains URL parts."
    echo ""
    echo "✅ Expected format:"
    echo "  nvbicjjtnobnnscmypeq"
    echo ""
    echo "❌ Invalid examples:"
    echo "  https://nvbicjjtnobnnscmypeq.supabase.co"
    echo "  nvbicjjtnobnnscmypeq.supabase.co"
    echo "  https://nvbicjjtnobnnscmypeq"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Go to: Settings → Secrets and variables → Actions"
    echo "  2. Edit SUPABASE_PROJECT_ID"
    echo "  3. Extract only the project ref from your URL:"
    echo "     URL: https://[PROJECT_REF].supabase.co"
    echo "     Use: [PROJECT_REF] (the 20-character part)"
    echo "  4. Or get it from: Supabase Dashboard → Project Settings → General → Reference ID"
    echo ""
    return 1
  fi
  
  # Check if it matches the expected format (20 lowercase alphanumeric chars)
  if ! echo "$project_id" | grep -qE '^[a-z0-9]{20}$'; then
    local length="${#project_id}"
    echo "::error title=Invalid Secret Format::SUPABASE_PROJECT_ID has invalid format. Expected 20 lowercase alphanumeric characters."
    echo ""
    echo "❌ SUPABASE_PROJECT_ID has invalid format"
    echo ""
    echo "Expected: 20 lowercase alphanumeric characters"
    echo "Got:      ${length} characters"
    echo ""
    if [ "$length" -gt 20 ]; then
      echo "⚠️  Your value is too long. It might contain extra characters or be a URL."
    elif [ "$length" -lt 20 ]; then
      echo "⚠️  Your value is too short. Make sure you copied the complete Reference ID."
    fi
    echo ""
    echo "✅ Valid example:"
    echo "  nvbicjjtnobnnscmypeq"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Go to: Supabase Dashboard → Project Settings → General"
    echo "  2. Copy the 'Reference ID' (exactly 20 characters)"
    echo "  3. Go to: GitHub → Settings → Secrets and variables → Actions"
    echo "  4. Edit SUPABASE_PROJECT_ID with the correct value"
    echo ""
    return 1
  fi
  
  echo "✅ SUPABASE_PROJECT_ID is valid (${project_id})"
  return 0
}

# Validate SUPABASE_ACCESS_TOKEN format
validate_supabase_access_token() {
  local token="${1:-}"
  
  if [ -z "$token" ]; then
    echo "::error title=Missing Secret::SUPABASE_ACCESS_TOKEN secret is not configured in the repository."
    echo ""
    echo "❌ SUPABASE_ACCESS_TOKEN is missing"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Go to: https://supabase.com/dashboard/account/tokens"
    echo "  2. Click 'Generate new token'"
    echo "  3. Name it: 'GitHub Actions - APP-Chiva-Fit'"
    echo "  4. Copy the token (starts with 'sbp_')"
    echo "  5. Go to: GitHub → Settings → Secrets and variables → Actions"
    echo "  6. Add secret: SUPABASE_ACCESS_TOKEN"
    echo ""
    return 1
  fi
  
  # Check if it starts with sbp_
  if ! echo "$token" | grep -qE '^sbp_'; then
    echo "::warning title=Unexpected Token Format::SUPABASE_ACCESS_TOKEN should start with 'sbp_'"
    echo ""
    echo "⚠️  SUPABASE_ACCESS_TOKEN has unexpected format"
    echo ""
    echo "Expected: Token starting with 'sbp_'"
    echo "Got:      Token starting with '${token:0:4}...'"
    echo ""
    echo "This might still work, but verify it's a valid Supabase access token."
    echo ""
  fi
  
  # Check minimum length
  if [ "${#token}" -lt 40 ]; then
    echo "::error title=Invalid Token::SUPABASE_ACCESS_TOKEN appears too short to be valid."
    echo ""
    echo "❌ SUPABASE_ACCESS_TOKEN is too short"
    echo ""
    echo "Expected: At least 40 characters"
    echo "Got:      ${#token} characters"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Generate a new token at: https://supabase.com/dashboard/account/tokens"
    echo "  2. Update the secret in: GitHub → Settings → Secrets and variables → Actions"
    echo ""
    return 1
  fi
  
  echo "✅ SUPABASE_ACCESS_TOKEN format looks valid"
  return 0
}

# Validate CRON_SECRET
validate_cron_secret() {
  local secret="${1:-}"
  local min_length="${2:-20}"
  
  if [ -z "$secret" ]; then
    echo "::error title=Missing Secret::CRON_SECRET is not configured in the repository."
    echo ""
    echo "❌ CRON_SECRET is missing"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Generate a strong secret:"
    echo "     openssl rand -base64 32"
    echo "  2. Go to: GitHub → Settings → Secrets and variables → Actions"
    echo "  3. Add secret: CRON_SECRET"
    echo "  4. IMPORTANT: Add the SAME value to Supabase Edge Functions secrets"
    echo "     Supabase Dashboard → Edge Functions → Secrets → CRON_SECRET"
    echo ""
    return 1
  fi
  
  if [ "${#secret}" -lt "$min_length" ]; then
    echo "::error title=Weak Secret::CRON_SECRET is too short. Use at least ${min_length} characters."
    echo ""
    echo "❌ CRON_SECRET is too short"
    echo ""
    echo "Expected: At least ${min_length} characters"
    echo "Got:      ${#secret} characters"
    echo ""
    echo "📋 How to fix:"
    echo "  1. Generate a strong secret:"
    echo "     openssl rand -base64 32"
    echo "  2. Update in: GitHub → Settings → Secrets and variables → Actions"
    echo "  3. Update in: Supabase Dashboard → Edge Functions → Secrets"
    echo ""
    return 1
  fi
  
  echo "✅ CRON_SECRET is valid (length: ${#secret})"
  return 0
}

# Main validation function for all Supabase secrets
validate_supabase_secrets() {
  local exit_code=0
  
  echo "🔍 Validating Supabase secrets..."
  echo ""
  
  # Validate SUPABASE_PROJECT_ID
  if ! validate_supabase_project_id "${SUPABASE_PROJECT_ID:-}"; then
    exit_code=1
  fi
  echo ""
  
  # Validate SUPABASE_ACCESS_TOKEN (if provided)
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    if ! validate_supabase_access_token "${SUPABASE_ACCESS_TOKEN:-}"; then
      exit_code=1
    fi
    echo ""
  fi
  
  # Validate CRON_SECRET (if provided)
  if [ -n "${CRON_SECRET:-}" ]; then
    if ! validate_cron_secret "${CRON_SECRET:-}" 20; then
      exit_code=1
    fi
    echo ""
  fi
  
  if [ $exit_code -eq 0 ]; then
    echo "✅ All secrets validated successfully!"
  else
    echo "❌ Secret validation failed. Please fix the issues above."
    echo ""
    echo "📚 For more help, see:"
    echo "  - .github/SETUP_SECRETS.md"
    echo "  - .github/TROUBLESHOOTING.md"
  fi
  
  return $exit_code
}

# If script is executed directly (not sourced), run validation
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  validate_supabase_secrets
fi
