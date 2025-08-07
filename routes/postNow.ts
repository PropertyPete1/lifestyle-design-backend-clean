import express from "express";
import { fetchRecentInstagramVideos, downloadInstagramVideo } from "../utils/instagramScraper";
import { getLast30ThumbnailHashes, logPostedHash } from "../utils/repostProtector";
import { uploadBufferToS3 } from "../utils/s3Uploader";
import { extractFirstFrameHash } from "../utils/fingerprint";
import { postToInstagram } from "../services/instagramPoster";
import { postToYouTube } from "../services/youtubePoster";
const SettingsModel = require("../src/models/settings");

const router = express.Router();

router.post("/api/postNow", async (req, res) => {
  try {
    console.log("📲 [POST NOW] Starting...");

    const settings = await SettingsModel.findOne({});
    const recentHashes = await getLast30ThumbnailHashes(); // 👈 pulls 30 most recent posts

    const candidates = await fetchRecentInstagramVideos(); // top 500 scraped videos

    for (const video of candidates) {
      const buffer = await downloadInstagramVideo(video.videoUrl);
      const visualHash = await extractFirstFrameHash(buffer);

      if (recentHashes.includes(visualHash)) {
        console.log(`⚠️ Skipping duplicate video hash: ${visualHash}`);
        continue;
      }

      // ✅ Upload to S3
      const s3Key = `postNow/instagram/${video.id}_${visualHash}.mp4`;
      const s3Url = await uploadBufferToS3(buffer, s3Key, "video/mp4");

      // ✅ Post to Instagram
      await postToInstagram({
        videoUrl: s3Url,
        caption: video.caption,
        thumbnailHash: visualHash,
        source: "postNow"
      });

      // ✅ Post to YouTube if enabled
      if (settings.autoPostToYouTube) {
        await postToYouTube({
          videoUrl: s3Url,
          caption: video.caption,
          thumbnailHash: visualHash,
          source: "postNow"
        });
      }

      // ✅ Log hash to prevent future repost
      await logPostedHash(visualHash);

      return res.status(200).json({
        status: "✅ Posted",
        platform: settings.autoPostToYouTube ? "Instagram + YouTube" : "Instagram",
        thumbnailHash: visualHash,
        s3Url
      });
    }

    return res.status(404).json({ error: "❌ No eligible video found. All top videos were reposted already." });

  } catch (err) {
    console.error("❌ [POST NOW ERROR]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;