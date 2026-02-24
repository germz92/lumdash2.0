// Environment config
const ENVIRONMENTS = {
  development: {
    API_BASE: 'http://localhost:3000',
  },
  production: {
    // Make sure to include www if that's how the site is accessed
    API_BASE: 'https://spa-lumdash-backend.onrender.com', 
  }
};

// Detect environment
const isProduction = window.location.hostname !== 'localhost' && 
                     !window.location.hostname.includes('127.0.0.1');

// Set the API base URL
const API_BASE = isProduction ? ENVIRONMENTS.production.API_BASE : ENVIRONMENTS.development.API_BASE;

console.log(`[config.js] Running in ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
console.log(`[config.js] Hostname: ${window.location.hostname}`);
console.log(`[config.js] API_BASE set to: ${API_BASE}`);

// === GLOBAL VERSION CONTROL ===
// Version control system - checks for updates and forces refresh when needed
const CURRENT_VERSION = '2024.12.10.004';

// Make version available globally
window.LUMDASH_VERSION = CURRENT_VERSION;

function checkAndUpdateVersion() {
  try {
    const storedVersion = localStorage.getItem('appVersion');
    
    if (!storedVersion) {
      // First time user - just set the version
      localStorage.setItem('appVersion', CURRENT_VERSION);
      return true;
    }
    
    if (storedVersion !== CURRENT_VERSION) {
      console.log(`🔄 Version update detected: ${storedVersion} → ${CURRENT_VERSION}`);
      
      // Clear caches and update version
      localStorage.setItem('appVersion', CURRENT_VERSION);
      
      // Force hard refresh for new version
      if (window.location.hostname !== 'localhost') {
        console.log('🔄 Forcing hard refresh for version update...');
        window.location.reload(true);
        return false;
      } else {
        console.log('🔄 Development mode - skipping hard refresh');
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Version check failed:', error);
    return true; // Continue anyway
  }
}

// Emergency refresh check for all pages
if (window.LUMDASH_FORCE_REFRESH) {
  const lastRefresh = localStorage.getItem('lumdash_last_refresh');
  const currentTime = Date.now();
  
  // Only refresh once per hour to avoid infinite loops
  if (!lastRefresh || (currentTime - parseInt(lastRefresh)) > 3600000) {
    console.log('🚨 Emergency refresh flag active - updating all users...');
    localStorage.setItem('lumdash_last_refresh', currentTime.toString());
    localStorage.setItem('lumdash_schedule_version', window.LUMDASH_VERSION);
    window.location.reload(true);
  }
}

// Run version check
checkAndUpdateVersion();

console.log('✅ Config loaded - Version:', window.LUMDASH_VERSION);

(async function checkLogin() {
  console.log('[config.js] Running checkLogin...');

  const pathname = window.location.pathname.toLowerCase();
  const isSafePage =
    pathname.endsWith('/index.html') ||
    pathname.endsWith('/register.html') || // ✅ Allow registration page
    pathname.endsWith('/reset-password.html') || // ✅ Allow reset password page
    pathname.endsWith('/dashboard.html') || // ✅ Allow dashboard to load SPA
    pathname.endsWith('/shared-schedule.html') || // ✅ Allow public shared schedule page
    pathname === '/' ||
    pathname === '' ||
    window.location.href.toLowerCase().endsWith('/');

  if (isSafePage) {
    console.log('[config.js] Skipping login check on safe page:', pathname);
    return;
  }

  const token = localStorage.getItem('token');
  if (!token) {
    console.warn('[config.js] No token found, redirecting...');
    window.location.href = 'index.html';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/verify-token`, {
      headers: { Authorization: token }
    });

    const data = await res.json();
    console.log('[config.js] verify-token status:', res.status);
    console.log('[config.js] verify-token response:', data);

    if (!res.ok || !data.valid) {
      console.warn('[config.js] Invalid token. Logging out...');
      localStorage.clear();
      window.location.href = 'index.html';
    }
  } catch (err) {
    console.error('[config.js] Auth check failed:', err);
    window.location.href = 'index.html';
  }
})();

window.API_BASE = API_BASE;

// TinyMCE Configuration
const TINYMCE_API_KEY = 'fas4afhgpg6cpjqy95m2culn60eo1xzhsk3riraqhhlrk8pv';

// Make TinyMCE API key globally accessible
window.TINYMCE_API_KEY = TINYMCE_API_KEY;
