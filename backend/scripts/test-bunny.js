/**
 * Quick check that Bunny Stream credentials in backend/.env work.
 * Run from the backend folder: node scripts/test-bunny.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bunny = require('../lib/bunnyStream');

(async () => {
  if (!bunny.isConfigured()) {
    console.error('Missing BUNNY_STREAM_LIBRARY_ID or BUNNY_STREAM_API_KEY in backend/.env');
    process.exit(1);
  }

  try {
    const result = await bunny.listVideos(1, 5);
    console.log(`Connected to library ${process.env.BUNNY_STREAM_LIBRARY_ID}. Videos in library: ${result.totalItems}`);

    for (const v of result.items || []) {
      console.log(`- ${v.title} (${v.guid}) status=${v.status} length=${v.length}s`);
    }

    if (result.items && result.items.length > 0) {
      const first = result.items[0];
      console.log('\nSigned embed URL for first video (valid 6h):');
      console.log(bunny.getSignedEmbedUrl(first.guid));
      const hls = bunny.getHlsUrl(first.guid);
      if (hls) console.log('Direct HLS URL:', hls);
      else console.log('(Set BUNNY_STREAM_CDN_HOSTNAME to get direct HLS/thumbnail URLs)');
    } else {
      console.log('\nLibrary is empty — upload a test video in the Bunny dashboard and run this again to get a signed embed URL.');
    }

    console.log('\nBunny Stream setup looks good.');
  } catch (err) {
    console.error('Bunny Stream check failed:', err.message);
    process.exit(1);
  }
})();
