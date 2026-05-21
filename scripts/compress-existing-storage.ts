/* eslint-disable no-console */
/**
 * compress-existing-storage
 * ---------------------------------------------------------------------------
 * One-shot migration: walk every object in the `deposit-photos` bucket,
 * resize + re-encode to WebP when it saves space, and overwrite the same
 * storage path so the URLs already stored in `deposits.photo_url`,
 * `confirm_photo_url`, customer_photo_url, etc. keep working.
 *
 * Usage:
 *   # Set credentials (read from .env.local automatically):
 *   #   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
 *   #   SUPABASE_SERVICE_ROLE_KEY=<service_role JWT>
 *
 *   npx tsx scripts/compress-existing-storage.ts --dry-run   # report only
 *   npx tsx scripts/compress-existing-storage.ts --apply     # write changes
 *
 *   # Optional flags:
 *   #   --bucket=<name>        default: deposit-photos
 *   #   --concurrency=<n>      default: 6
 *   #   --max-dim=<px>         default: 1920
 *   #   --quality=<0-100>      default: 78
 *   #   --min-bytes=<n>        skip files already smaller than this (default 200000)
 *
 * Notes:
 *   - Idempotent: rerunning skips files already small enough.
 *   - Original files are overwritten in place. There is no automatic backup.
 *     If you want one, snapshot the bucket from the Supabase dashboard first.
 *   - Service role key bypasses RLS — keep it out of git, rotate after use.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

// dotenv/config reads .env by default. Layer .env.local on top.
if (existsSync('.env.local')) loadEnv({ path: '.env.local', override: true });

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  apply: boolean;
  dryRun: boolean;
  bucket: string;
  concurrency: number;
  maxDim: number;
  quality: number;
  minBytes: number;
}

function parseArgs(): Args {
  const out: Args = {
    apply: false,
    dryRun: false,
    bucket: 'deposit-photos',
    concurrency: 6,
    maxDim: 1920,
    quality: 78,
    minBytes: 200_000,
  };
  for (const raw of process.argv.slice(2)) {
    if (raw === '--apply') out.apply = true;
    else if (raw === '--dry-run') out.dryRun = true;
    else if (raw.startsWith('--bucket=')) out.bucket = raw.slice(9);
    else if (raw.startsWith('--concurrency=')) out.concurrency = Math.max(1, parseInt(raw.slice(14), 10) || 6);
    else if (raw.startsWith('--max-dim=')) out.maxDim = Math.max(64, parseInt(raw.slice(10), 10) || 1920);
    else if (raw.startsWith('--quality=')) out.quality = Math.min(100, Math.max(10, parseInt(raw.slice(10), 10) || 78));
    else if (raw.startsWith('--min-bytes=')) out.minBytes = Math.max(0, parseInt(raw.slice(12), 10) || 200_000);
    else {
      console.error(`Unknown arg: ${raw}`);
      process.exit(2);
    }
  }
  if (!out.apply && !out.dryRun) {
    out.dryRun = true;
    console.log('No --apply or --dry-run given. Defaulting to --dry-run.');
  }
  if (out.apply && out.dryRun) {
    console.error('Pass either --apply or --dry-run, not both.');
    process.exit(2);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ObjectRef {
  /** full path inside the bucket */
  path: string;
  size: number;
  contentType: string | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const COMPRESSIBLE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function looksCompressible(meta: ObjectRef): boolean {
  if (meta.contentType && COMPRESSIBLE_MIMES.has(meta.contentType)) return true;
  // Fall back to extension if metadata is missing
  const lower = meta.path.toLowerCase();
  return /\.(jpe?g|png|webp)$/.test(lower);
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Missing env. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local.',
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// List all objects in a bucket (recursive)
// ---------------------------------------------------------------------------

async function listAll(bucket: string): Promise<ObjectRef[]> {
  // The storage list() API is folder-scoped. We walk depth-first.
  const queue: string[] = [''];
  const all: ObjectRef[] = [];
  const PAGE_SIZE = 1000;

  while (queue.length > 0) {
    const prefix = queue.shift()!;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const entry of data) {
        // Folders show up with id === null on Supabase Storage
        if (entry.id === null) {
          queue.push(prefix ? `${prefix}/${entry.name}` : entry.name);
        } else {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          const meta = entry.metadata as { size?: number; mimetype?: string } | null;
          all.push({
            path,
            size: meta?.size ?? 0,
            contentType: meta?.mimetype ?? null,
          });
        }
      }

      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Process a single object
// ---------------------------------------------------------------------------

interface OutcomeSkipped {
  kind: 'skip';
  reason: string;
}
interface OutcomeCompressed {
  kind: 'compress';
  beforeBytes: number;
  afterBytes: number;
}
interface OutcomeFailed {
  kind: 'fail';
  error: string;
}
type Outcome = OutcomeSkipped | OutcomeCompressed | OutcomeFailed;

async function processObject(args: Args, obj: ObjectRef): Promise<Outcome> {
  if (!looksCompressible(obj)) {
    return { kind: 'skip', reason: `not an image (${obj.contentType ?? 'unknown'})` };
  }
  if (obj.size > 0 && obj.size < args.minBytes) {
    return { kind: 'skip', reason: 'already small' };
  }

  // Download
  const { data: blob, error: dlErr } = await supabase.storage
    .from(args.bucket)
    .download(obj.path);
  if (dlErr || !blob) {
    return { kind: 'fail', error: dlErr?.message || 'download returned empty' };
  }

  const inputBuf = Buffer.from(await blob.arrayBuffer());
  const inputBytes = inputBuf.byteLength;

  // Decode + resize + re-encode to WebP
  let outputBuf: Buffer;
  try {
    outputBuf = await sharp(inputBuf, { failOn: 'none' })
      .rotate() // honour EXIF orientation
      .resize({
        width: args.maxDim,
        height: args.maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: args.quality, effort: 4 })
      .toBuffer();
  } catch (err) {
    return { kind: 'fail', error: `sharp: ${err instanceof Error ? err.message : String(err)}` };
  }

  const outputBytes = outputBuf.byteLength;
  if (outputBytes >= inputBytes) {
    return { kind: 'skip', reason: `re-encode larger (${formatBytes(outputBytes)} ≥ ${formatBytes(inputBytes)})` };
  }

  if (args.dryRun) {
    return { kind: 'compress', beforeBytes: inputBytes, afterBytes: outputBytes };
  }

  // Upload back to the same path. upsert keeps the URL stable.
  const { error: upErr } = await supabase.storage
    .from(args.bucket)
    .upload(obj.path, outputBuf, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true,
    });
  if (upErr) {
    return { kind: 'fail', error: `upload: ${upErr.message}` };
  }

  return { kind: 'compress', beforeBytes: inputBytes, afterBytes: outputBytes };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('Config:', {
    bucket: args.bucket,
    mode: args.apply ? 'APPLY' : 'DRY-RUN',
    concurrency: args.concurrency,
    maxDim: args.maxDim,
    quality: args.quality,
    minBytes: args.minBytes,
  });

  console.log('Listing objects...');
  const objects = await listAll(args.bucket);
  console.log(`Found ${objects.length} object(s).`);

  let processed = 0;
  let compressed = 0;
  let skipped = 0;
  let failed = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  // Run with a fixed concurrency by chunking through a worker pool pattern.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= objects.length) return;
      const obj = objects[i];
      try {
        const outcome = await processObject(args, obj);
        processed++;
        if (outcome.kind === 'compress') {
          compressed++;
          totalBefore += outcome.beforeBytes;
          totalAfter += outcome.afterBytes;
          const savedPct = ((1 - outcome.afterBytes / outcome.beforeBytes) * 100).toFixed(0);
          console.log(
            `[${processed}/${objects.length}] ${args.apply ? 'shrunk' : 'would shrink'} ` +
              `${obj.path}  ${formatBytes(outcome.beforeBytes)} → ${formatBytes(outcome.afterBytes)} (-${savedPct}%)`,
          );
        } else if (outcome.kind === 'skip') {
          skipped++;
          // Quiet skips on the happy path; only mention "already small"-style noise occasionally
          if (processed % 50 === 0) {
            console.log(`[${processed}/${objects.length}] progress — skipped: ${skipped}`);
          }
        } else {
          failed++;
          console.warn(`[${processed}/${objects.length}] FAIL ${obj.path}: ${outcome.error}`);
        }
      } catch (err) {
        failed++;
        console.warn(`[${processed}/${objects.length}] CRASH ${obj.path}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  console.log('\n--- Summary ---');
  console.log(`Total objects:  ${objects.length}`);
  console.log(`Compressed:     ${compressed}`);
  console.log(`Skipped:        ${skipped}`);
  console.log(`Failed:         ${failed}`);
  if (compressed > 0) {
    const savedBytes = totalBefore - totalAfter;
    const savedPct = ((savedBytes / totalBefore) * 100).toFixed(1);
    console.log(
      `Size:           ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (saved ${formatBytes(savedBytes)} / ${savedPct}%)`,
    );
  }
  if (args.dryRun) {
    console.log('\nDry-run only. Rerun with --apply to actually overwrite files.');
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
