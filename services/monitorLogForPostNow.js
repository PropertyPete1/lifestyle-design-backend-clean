// 📁 File: backend-v2/services/monitorLogForPostNow.js

// 🧠 GOAL: Monitor Render logs in real-time and verify that the Post Now system is working correctly end-to-end.

// ✅ DO:
// - Confirm all critical steps are logged properly
// - Check for duplicate filtering (hash + caption)
// - Confirm successful S3 upload
// - Confirm a video was POSTED
// - Flag any missing or failed steps for review

// --------------------------------------------
// ✅ KEY PHRASES TO WATCH FOR IN LOGS:
const logChecklist = [
  "✅ [STEP 1] Scraped",                       // Scraper ran
  "🗄️ [STEP 2] Fetching last 30 posts",        // Real IG posts fetched
  "✅ [STEP 2] Found",                         // Posts returned
  "📸 [HASH CHECK]",                           // Visual deduplication active
  "📝 [CAPTION CHECK]",                        // Caption fallback enabled
  "✅ [STEP 3] Selected unique video",         // Passed deduplication
  "☁️ [STEP 4] Uploading to S3",               // Upload trigger
  "✅ [STEP 4] S3 upload successful",          // S3 upload success
  "✏️ [STEP 5] Generating smart caption",     // Smart caption trigger
  "✅ [STEP 6] Post to Instagram",             // IG post trigger
  "✅ [POST NOW] Completed unique post",       // End-of-flow success
];

// ❌ CRITICAL ERRORS TO CATCH:
const errorFlags = [
  "❌ No unique video found",
  "⛔ Skipping duplicate video",
  "❌ S3 Upload Error",
  "❌ [AI CAPTION]",
  "❌ Instagram post failed",
  "Only found 3 recent posts",
  "Cannot overwrite",
  "Internal server error"
];

// ✅ MONITOR FUNCTION:
function monitorRenderLog(logLine) {
  let foundSuccess = false;
  let foundError = false;

  for (const successCheck of logChecklist) {
    if (logLine.includes(successCheck)) {
      console.log(`✅ MONITOR: Passed check → ${successCheck}`);
      foundSuccess = true;
    }
  }

  for (const errorCheck of errorFlags) {
    if (logLine.includes(errorCheck)) {
      console.error(`❌ MONITOR: ERROR detected → ${errorCheck}`);
      foundError = true;
      // Optional: trigger webhook/alert here
    }
  }

  // Log any unhandled lines that might be important
  if (!foundSuccess && !foundError && logLine.trim().length > 0) {
    console.log(`📋 LOG: ${logLine}`);
  }
}

module.exports = {
  monitorRenderLog,
  logChecklist,
  errorFlags
};