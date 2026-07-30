/**
 * Bunny Stream helper — single integration point for video hosting.
 * All video-portal code should go through this module so the provider
 * can be swapped (e.g. Cloudflare Stream) without touching feature code.
 *
 * Env:
 *   BUNNY_STREAM_LIBRARY_ID    - Stream video library ID
 *   BUNNY_STREAM_API_KEY       - the library's Stream API key (for API calls)
 *   BUNNY_STREAM_TOKEN_KEY     - the library's "Token authentication key" (Security > General), signs embed URLs
 *   BUNNY_STREAM_CDN_HOSTNAME  - optional, e.g. vz-xxxxx.b-cdn.net (for direct HLS/thumbnail URLs)
 *
 * API reference: https://docs.bunny.net/stream/http-api
 */

const crypto = require('crypto');
const fs = require('fs');
const { Readable } = require('stream');
const { spawn } = require('child_process');
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = null;
}

const API_BASE = 'https://video.bunnycdn.com';

function config() {
  return {
    libraryId: process.env.BUNNY_STREAM_LIBRARY_ID || '',
    apiKey: process.env.BUNNY_STREAM_API_KEY || '',
    tokenKey: process.env.BUNNY_STREAM_TOKEN_KEY || '',
    cdnHostname: process.env.BUNNY_STREAM_CDN_HOSTNAME || ''
  };
}

function isConfigured() {
  const { libraryId, apiKey } = config();
  return !!(libraryId && apiKey);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error('Bunny Stream is not configured (set BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY)');
  }
}

async function bunnyFetch(path, options = {}) {
  assertConfigured();
  const { libraryId, apiKey } = config();
  const res = await fetch(`${API_BASE}/library/${libraryId}${path}`, {
    ...options,
    headers: {
      AccessKey: apiKey,
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bunny Stream ${options.method || 'GET'} ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Create a video object; returns { guid, title, ... }. Upload the file separately. */
async function createVideo(title, collectionId = null) {
  const body = { title: String(title || 'Untitled') };
  if (collectionId) body.collectionId = collectionId;
  return bunnyFetch('/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Presigned credentials for browser → Bunny TUS direct upload.
 * Signature: SHA256(libraryId + apiKey + expirationTime + videoId)
 * Docs: https://docs.bunny.net/stream/tus-resumable-uploads
 */
function createTusUploadCredentials(videoId, expiresInSeconds = 86400) {
  assertConfigured();
  const { libraryId, apiKey } = config();
  const guid = String(videoId || '').trim();
  if (!guid) throw new Error('videoId is required for TUS credentials');
  const expirationTime = Math.floor(Date.now() / 1000) + Math.max(3600, Number(expiresInSeconds) || 86400);
  const signature = crypto
    .createHash('sha256')
    .update(`${libraryId}${apiKey}${expirationTime}${guid}`)
    .digest('hex');
  return {
    endpoint: 'https://video.bunnycdn.com/tusupload',
    libraryId: String(libraryId),
    videoId: guid,
    expirationTime,
    signature
  };
}

/**
 * Upload a video file (Buffer) to a previously created video object.
 * Fine for review proxies; files over ~2GB should use Bunny's TUS endpoint instead.
 */
async function uploadVideoBuffer(videoId, buffer) {
  return bunnyFetch(`/videos/${videoId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer
  });
}

/**
 * Upload a video file from disk, streamed (no full-file memory buffer).
 * Preferred path for portal uploads; files over ~2GB should use TUS instead.
 */
async function uploadVideoFile(videoId, filePath) {
  assertConfigured();
  const { libraryId, apiKey } = config();
  const res = await fetch(`${API_BASE}/library/${libraryId}/videos/${videoId}`, {
    method: 'PUT',
    headers: {
      AccessKey: apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/octet-stream'
    },
    body: Readable.toWeb(fs.createReadStream(filePath)),
    duplex: 'half'
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bunny Stream upload failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Have Bunny pull the file from a public URL (e.g. a direct download link). */
async function fetchVideoFromUrl(url, title) {
  return bunnyFetch('/videos/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title: String(title || 'Untitled') })
  });
}

/** Video details, including transcoding status (status 4 = finished). */
async function getVideo(videoId) {
  return bunnyFetch(`/videos/${videoId}`);
}

async function listVideos(page = 1, itemsPerPage = 100) {
  return bunnyFetch(`/videos?page=${page}&itemsPerPage=${itemsPerPage}&orderBy=date`);
}

async function deleteVideo(videoId) {
  return bunnyFetch(`/videos/${videoId}`, { method: 'DELETE' });
}

/**
 * Signed embed URL for the Bunny iframe player.
 * Requires "Embed View Token Authentication" enabled on the library and the
 * library's "Token authentication key" (Security > General) in BUNNY_STREAM_TOKEN_KEY.
 * Token = SHA256_HEX(tokenKey + videoId + expires).
 */
function getSignedEmbedUrl(videoId, ttlSeconds = 3600 * 6) {
  assertConfigured();
  const { libraryId, tokenKey } = config();
  if (!tokenKey) {
    throw new Error('BUNNY_STREAM_TOKEN_KEY is not set (Stream > library > Security > Token authentication key)');
  }
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = crypto.createHash('sha256')
    .update(tokenKey + videoId + expires)
    .digest('hex');
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}`;
}

/** Unsigned embed URL (only if embed token auth is disabled on the library). */
function getEmbedUrl(videoId) {
  const { libraryId } = config();
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`;
}

/** Direct HLS playlist URL — for a custom player (hls.js). Needs BUNNY_STREAM_CDN_HOSTNAME. */
function getHlsUrl(videoId) {
  const { cdnHostname } = config();
  if (!cdnHostname) return null;
  return `https://${cdnHostname}/${videoId}/playlist.m3u8`;
}

/** Default thumbnail URL. Needs BUNNY_STREAM_CDN_HOSTNAME. */
function getThumbnailUrl(videoId, fileName = 'thumbnail.jpg') {
  const { cdnHostname } = config();
  if (!cdnHostname) return null;
  return `https://${cdnHostname}/${videoId}/${fileName}`;
}

/**
 * Map a playback time to Bunny's seek-sprite cell (6×6 grid, ~1–2s per frame).
 * Used to capture an approximate frame without downloading the full video.
 * Needs BUNNY_STREAM_CDN_HOSTNAME. Returns { spriteUrl, x, y, width, height }.
 */
async function getSeekFrameCrop(videoId, timeSeconds) {
  assertConfigured();
  const { cdnHostname } = config();
  if (!cdnHostname) {
    throw new Error('BUNNY_STREAM_CDN_HOSTNAME is required to capture a frame thumbnail');
  }

  const info = await getVideo(videoId);
  const length = Math.max(0, Number(info?.length) || 0);
  const count = Math.max(0, Number(info?.thumbnailCount) || 0);
  if (!length || !count) {
    throw new Error('Seek thumbnails are not ready yet — wait for processing to finish, then try again');
  }

  const t = Math.max(0, Math.min(length, Number(timeSeconds) || 0));
  const interval = length / count;
  const frame = Math.min(count - 1, Math.max(0, Math.floor(t / interval)));
  const page = Math.floor(frame / 36);
  const idx = frame % 36;
  const col = idx % 6;
  const row = Math.floor(idx / 6);

  const vw = Math.max(1, Number(info.width) || 1920);
  const vh = Math.max(1, Number(info.height) || 1080);
  const cellW = 300;
  const cellH = Math.max(1, Math.round(cellW * (vh / vw)));

  return {
    spriteUrl: `https://${cdnHostname}/${videoId}/seek/_${page}.jpg`,
    x: col * cellW,
    y: row * cellH,
    width: cellW,
    height: cellH,
    frameIndex: frame,
    timeSeconds: t
  };
}

/**
 * Download a seek-sprite JPEG. Bunny CDN hotlink protection requires a mediadelivery Referer
 * (Cloudinary fetch gets 403 without it), so we pull the bytes ourselves.
 */
async function fetchSeekSprite(videoId, timeSeconds) {
  const crop = await getSeekFrameCrop(videoId, timeSeconds);
  const res = await fetch(crop.spriteUrl, {
    headers: {
      Referer: 'https://iframe.mediadelivery.net/',
      Accept: 'image/jpeg,image/*;q=0.8,*/*;q=0.5'
    }
  });
  if (!res.ok) {
    throw new Error(`Could not download seek frame (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('Seek frame download was empty');
  return { ...crop, buffer, contentType: res.headers.get('content-type') || 'image/jpeg' };
}

function getMp4Url(videoId, height = 720) {
  const { cdnHostname } = config();
  if (!cdnHostname) return null;
  return `https://${cdnHostname}/${videoId}/play_${height}p.mp4`;
}

/**
 * Extract an exact JPEG frame at timeSeconds from the Bunny MP4 fallback.
 * Uses ffmpeg-static + Referer (CDN hotlink protection). Falls back to seek sprites.
 */
async function extractFrameAtTime(videoId, timeSeconds) {
  const t = Math.max(0, Number(timeSeconds) || 0);
  const mp4Url = getMp4Url(videoId, 720) || getMp4Url(videoId, 480);
  if (!ffmpegPath || !mp4Url) {
    const sprite = await fetchSeekSprite(videoId, t);
    return {
      buffer: sprite.buffer,
      contentType: sprite.contentType,
      timeSeconds: sprite.timeSeconds,
      source: 'seek-sprite',
      crop: sprite
    };
  }

  try {
    const buffer = await new Promise((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-headers', 'Referer: https://iframe.mediadelivery.net/\r\n',
        '-i', mp4Url,
        '-ss', String(t),
        '-frames:v', '1',
        '-q:v', '2',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1'
      ];
      const proc = spawn(ffmpegPath, args, { windowsHide: true });
      const chunks = [];
      const errChunks = [];
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* noop */ }
        reject(new Error('Frame extract timed out'));
      }, 60000);
      proc.stdout.on('data', (c) => chunks.push(c));
      proc.stderr.on('data', (c) => errChunks.push(c));
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        const out = Buffer.concat(chunks);
        if (code !== 0 || !out.length) {
          const msg = Buffer.concat(errChunks).toString('utf8').trim();
          reject(new Error(msg || `ffmpeg exited with code ${code}`));
          return;
        }
        resolve(out);
      });
    });

    return {
      buffer,
      contentType: 'image/jpeg',
      timeSeconds: t,
      source: 'mp4-frame',
      crop: null
    };
  } catch (err) {
    console.warn('Exact MP4 frame extract failed, falling back to seek sprite:', err.message);
    const sprite = await fetchSeekSprite(videoId, t);
    return {
      buffer: sprite.buffer,
      contentType: sprite.contentType,
      timeSeconds: sprite.timeSeconds,
      source: 'seek-sprite',
      crop: sprite
    };
  }
}

/**
 * Upload a custom thumbnail image (Buffer) for a Bunny video.
 * POST /library/{id}/videos/{videoId}/thumbnail with raw image bytes.
 */
async function setThumbnail(videoId, buffer, contentType = 'image/jpeg') {
  assertConfigured();
  const { libraryId, apiKey } = config();
  const res = await fetch(`${API_BASE}/library/${libraryId}/videos/${videoId}/thumbnail`, {
    method: 'POST',
    headers: {
      AccessKey: apiKey,
      Accept: 'application/json',
      'Content-Type': contentType || 'application/octet-stream'
    },
    body: buffer
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bunny Stream set thumbnail failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Set thumbnail by telling Bunny to fetch an image URL. */
async function setThumbnailFromUrl(videoId, thumbnailUrl) {
  return bunnyFetch(`/videos/${videoId}/thumbnail?thumbnailUrl=${encodeURIComponent(thumbnailUrl)}`, {
    method: 'POST'
  });
}

module.exports = {
  isConfigured,
  createVideo,
  createTusUploadCredentials,
  uploadVideoBuffer,
  uploadVideoFile,
  fetchVideoFromUrl,
  getVideo,
  listVideos,
  deleteVideo,
  getSignedEmbedUrl,
  getEmbedUrl,
  getHlsUrl,
  getThumbnailUrl,
  getSeekFrameCrop,
  fetchSeekSprite,
  extractFrameAtTime,
  getMp4Url,
  setThumbnail,
  setThumbnailFromUrl
};
