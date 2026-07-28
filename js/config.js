// Detect when Material Symbols font is loaded to prevent FOUT
(function detectFontLoaded() {
  // If already has the class, don't re-run
  if (document.documentElement.classList.contains('fonts-loaded')) {
    return;
  }
  
  // Check if fonts are already loaded
  if (document.fonts && document.fonts.check('24px "Material Symbols Outlined"')) {
    document.documentElement.classList.add('fonts-loaded');
    return;
  }
  
  // Use Font Loading API if available
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function() {
      document.documentElement.classList.add('fonts-loaded');
    });
    
    // Also check periodically as a backup
    let checkCount = 0;
    const checkInterval = setInterval(function() {
      checkCount++;
      if (document.fonts.check('24px "Material Symbols Outlined"') || checkCount > 20) {
        document.documentElement.classList.add('fonts-loaded');
        clearInterval(checkInterval);
      }
    }, 50);
  } else {
    // Fallback: add class after a short delay
    setTimeout(function() {
      document.documentElement.classList.add('fonts-loaded');
    }, 300);
  }
})();

// Environment config
const ENVIRONMENTS = {
  development: {
    API_BASE: 'http://localhost:3000',
  },
  beta: {
    // Beta backend on Render
    API_BASE: 'https://lumdash2-0.onrender.com', 
  },
  production: {
    // Production backend on Render
    API_BASE: 'https://spa-lumdash-backend.onrender.com', 
  }
};

// Detect environment based on hostname
function detectEnvironment() {
  const hostname = window.location.hostname.toLowerCase();
  
  // Development: localhost or 127.0.0.1
  if (hostname === 'localhost' || hostname.includes('127.0.0.1')) {
    return 'development';
  }
  
  // Beta: beta.lumdash.app or any beta subdomain
  if (hostname.startsWith('beta.') || hostname.includes('beta')) {
    return 'beta';
  }
  
  // Production: everything else (lumdash.app, www.lumdash.app, etc.)
  return 'production';
}

const CURRENT_ENV = detectEnvironment();
const API_BASE = ENVIRONMENTS[CURRENT_ENV].API_BASE;

console.log(`[config.js] Running in ${CURRENT_ENV.toUpperCase()} mode`);
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
      
      // Force hard refresh for new version (skip in development)
      if (CURRENT_ENV !== 'development') {
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
    pathname.endsWith('/crew-response.html') || // ✅ Allow public crew availability response page
    pathname.endsWith('/portal.html') || // ✅ Allow public client video portal page
    pathname.endsWith('/dashboard.html') || // ✅ Allow dashboard to load SPA
    pathname.endsWith('/inventory-management.html') || // ✅ Allow inventory page
    pathname.endsWith('/crew-planner.html') || // ✅ Allow crew planner page
    pathname.endsWith('/crew-calendar.html') || // ✅ Allow crew calendar page
    pathname.endsWith('/event-calendar.html') || // ✅ Allow event calendar page
    pathname.endsWith('/users.html') || // ✅ Allow users/admin page
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
    } else if (data.roleMismatch) {
      console.warn(
        '[config.js] Your session role is out of date (token:',
        data.user?.role,
        'database:',
        data.dbRole,
        '). Log out and log back in to receive notifications correctly.'
      );
    }
  } catch (err) {
    console.error('[config.js] Auth check failed:', err);
    window.location.href = 'index.html';
  }
})();

window.API_BASE = API_BASE;
window.CURRENT_ENV = CURRENT_ENV;

// TinyMCE Configuration
const TINYMCE_API_KEY = 'fas4afhgpg6cpjqy95m2culn60eo1xzhsk3riraqhhlrk8pv';

// Make TinyMCE API key globally accessible
window.TINYMCE_API_KEY = TINYMCE_API_KEY;
window.OPENWEATHER_API_KEY = 'bb0782c87e76343d9c02574bec1333a3';