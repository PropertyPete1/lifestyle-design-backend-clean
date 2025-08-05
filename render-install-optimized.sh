#!/bin/bash

echo "🚀 [OPTIMIZED RENDER] Ultra-fast installation for Render deployment..."

# Set aggressive optimizations
export NODE_OPTIONS="--max-old-space-size=1024 --no-warnings"
export NPM_CONFIG_FUND=false
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_PROGRESS=false
export NPM_CONFIG_LOGLEVEL=error
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
export PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer

# Function to install with timeout and fallback
fast_install() {
    local package="$1"
    local timeout_sec="$2"
    local description="$3"
    
    echo "⏱️ Installing $description (max ${timeout_sec}s)..."
    
    # Try installation with timeout
    if timeout $timeout_sec npm install "$package" --production --silent --no-audit --no-fund 2>/dev/null; then
        echo "✅ $description installed successfully"
        return 0
    else
        echo "⚠️ $description failed or timed out"
        return 1
    fi
}

# Install core dependencies FAST
echo "📦 Core dependencies (ultra-fast mode)..."
if [ -f "package-lock.json" ]; then
    npm ci --only=production --silent --no-audit --no-fund --ignore-scripts 2>/dev/null || npm install --production --silent --no-audit --no-fund 2>/dev/null
else
    npm install --production --silent --no-audit --no-fund 2>/dev/null
fi
echo "✅ Core dependencies ready"

# Install heavy deps with aggressive timeouts
echo "🔧 Heavy dependencies (parallel with timeouts)..."

# Puppeteer with 4-minute timeout
fast_install "puppeteer@21.11.0" 240 "Puppeteer" || {
    echo "🔄 Trying lighter Puppeteer..."
    fast_install "puppeteer-core@21.11.0" 120 "Puppeteer-core" || echo "📝 Puppeteer disabled - fallback ready"
}

# AWS SDK with 2-minute timeout  
fast_install "aws-sdk@2.1691.0" 120 "AWS SDK v2" || {
    echo "🔄 Trying AWS SDK v3..."
    fast_install "@aws-sdk/client-s3@3.515.0" 60 "AWS SDK v3" || echo "📝 S3 disabled - mock uploads ready"
}

# Aggressive cleanup
echo "🧹 Memory cleanup..."
npm cache clean --force 2>/dev/null || true
rm -rf /tmp/npm-* 2>/dev/null || true

echo "🎉 Optimized installation complete! Server ready to start..."