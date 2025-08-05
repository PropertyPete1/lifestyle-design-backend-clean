#!/bin/bash

echo "🚨 EMERGENCY RENDER BUILD - Minimal dependencies only"

# Ultra-lightweight build for when heavy deps fail
export NODE_OPTIONS="--max-old-space-size=512"
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_PROGRESS=false
export NPM_CONFIG_LOGLEVEL=error

# Install only core dependencies
echo "📦 Installing minimal core dependencies..."
npm install --production --silent --no-audit --no-fund \
  cors dotenv express mongodb mongoose multer node-fetch

echo "⚠️ EMERGENCY MODE: Heavy dependencies skipped"
echo "   - Puppeteer: DISABLED (fallback to Graph API)"
echo "   - AWS SDK: DISABLED (mock S3 uploads)"
echo "   - Visual scraping: DISABLED"
echo "   - S3 uploads: SIMULATED"

echo "✅ Emergency build complete - basic functionality ready"