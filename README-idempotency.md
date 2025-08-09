Exactly-once posting (Instagram + YouTube)

Idempotency key
- Format: `${platform}:${YYYYMMDDHHmm}:${sha1(videoHash).slice(0,8)}`
- Minute uses UTC of scheduledAt (or now for Post Now)
- Unique index on `Posts.idempotencyKey` ensures hard-stop on duplicates

Short lock
- Mongo collection `PostingLocks` with TTL on `expiresAt`
- Acquire before provider call; release on completion
- Key: `post:${idempotencyKey}`

Flow
1) Acquire lock; if exists → deduped
2) Upsert `Posts` status=posting
3) Single provider call (no internal retries)
4) Mark posted with `externalPostId`
5) Increment `DailyCounters` for that platform

Daily limit
- Enforced via `getRemainingSlots()` and counters incremented only on success

Debug
- GET `/api/posting/debug` returns today’s counters and last 5 Posts per platform

