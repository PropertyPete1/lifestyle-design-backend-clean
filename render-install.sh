#!/bin/bash
# Render.com installation script for heavy dependencies

echo "🚀 [RENDER INSTALL] Starting Render-specific dependency installation..."

# Set environment variables for Puppeteer
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
export PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer

# Increase memory limit for npm
export NODE_OPTIONS="--max-old-space-size=1024"

echo "📦 [RENDER INSTALL] Installing core dependencies..."
npm install --production --no-audit --no-fund

echo "🔍 [RENDER INSTALL] Installing Puppeteer with retry..."
npm install puppeteer@21.11.0 --no-optional --production || {
    echo "⚠️ [RENDER INSTALL] Puppeteer failed, trying alternative..."
    npm install puppeteer-core@21.11.0 --production || echo "Puppeteer completely failed, visual scraping will be disabled"
}

echo "☁️ [RENDER INSTALL] Installing AWS SDK with retry..."
npm install aws-sdk@2.1691.0 --production || {
    echo "⚠️ [RENDER INSTALL] AWS SDK v2 failed, trying v3..."
    npm install @aws-sdk/client-s3@3.515.0 --production || echo "AWS SDK completely failed, S3 uploads will be mocked"
}

echo "✅ [RENDER INSTALL] Installation complete - checking what's available..."

# Check what's actually installed
if [ -d "node_modules/puppeteer" ]; then
    echo "✅ Puppeteer installed successfully"
else
    echo "❌ Puppeteer not available"
fi

if [ -d "node_modules/aws-sdk" ] || [ -d "node_modules/@aws-sdk/client-s3" ]; then
    echo "✅ AWS SDK installed successfully"
else
    echo "❌ AWS SDK not available"
fi

echo "🎉 [RENDER INSTALL] Ready to start server..."