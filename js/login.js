// LOGIN CHECK ON LOAD
// Show splash by default, hide login form
document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('splashScreen');
  const authWrapper = document.getElementById('authWrapper');
  if (authWrapper) authWrapper.style.display = 'none';
  if (splash) splash.style.display = 'flex';

  const token = localStorage.getItem('token');

  // ✅ If token exists, verify it
  if (token) {
    try {
      const res = await fetch(`${API_BASE}/api/verify-token`, {
        headers: { Authorization: token }
      });

      if (res.ok) {
        // Let the dashboard handle page restoration instead of forcing #events
        window.location.href = 'dashboard.html';
        return;
      }
      
    } catch (err) {
      console.warn('[index] Token check failed:', err);
      localStorage.clear();
    }
  }

  // If not authenticated, hide splash and show login form
  if (splash) splash.style.display = 'none';
  if (authWrapper) authWrapper.style.display = '';

  // ✅ Allow pressing Enter key to login
  const passwordField = document.getElementById('password');
  if (passwordField) {
    passwordField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        login();
      }
    });
  }

  const forgotLink = document.getElementById('forgotPasswordLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', function(e) {
      e.preventDefault();
      showForgotPasswordModal();
    });
  }
});

// LOGIN
window.login = async function () {
  if (window.loginLock) return;
  window.loginLock = true;

  const email = document.getElementById('email').value.trim().toLowerCase();
  const password = document.getElementById('password').value.trim();

  if (!email || !password) {
    alert('Please enter both email and password.');
    window.loginLock = false;
    return;
  }

  const loginBtn = document.getElementById('loginButton');
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    let data;
    try {
      data = await res.json();
    } catch {
      alert('Server returned an invalid response.');
      throw new Error('Invalid JSON from server');
    }

    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('fullName', data.fullName);

      // Optional: extract and store user ID
      const payload = JSON.parse(atob(data.token.split('.')[1]));
      if (payload?.id) localStorage.setItem('userId', payload.id);

      console.log('[login.js] Logged in, token:', data.token);
      // Let the dashboard handle page restoration instead of forcing #events
      window.location.replace('dashboard.html');
    } else {
      alert(data.error || 'Login failed');
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
      }
      window.loginLock = false;
    }
  } catch (err) {
    console.error('Login error:', err);
    alert('Login failed. Please try again later.');
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login';
    }
    window.loginLock = false;
  }
};

// REGISTER
window.register = async function () {
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const fullName = document.getElementById('regFullName').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (!email || !fullName || !password) {
    alert('Please fill in all fields.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fullName, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    alert(data.message || 'User created');

    if (data.message === 'User created') {
      window.location.href = 'index.html';
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
    console.error(err);
  }
};

function showForgotPasswordModal() {
  // Create modal HTML
  let modal = document.getElementById('forgotPasswordModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'forgotPasswordModal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.4)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div style="background:#fff;padding:32px 24px;border-radius:16px;max-width:350px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.18);display:flex;flex-direction:column;align-items:center;">
        <h2 style="margin-bottom:12px;">Reset Password</h2>
        <input id="forgotEmail" type="email" placeholder="Enter your email" style="width:100%;padding:12px;margin-bottom:16px;border-radius:8px;border:1.5px solid #ccc;">
        <button id="sendResetBtn" style="width:100%;padding:12px 0;background:#CC0007;color:#fff;border:none;border-radius:8px;font-weight:bold;">Send Reset Link</button>
        <div id="forgotMsg" style="margin-top:12px;font-size:0.98rem;color:#333;"></div>
        <button id="closeForgotModal" style="margin-top:18px;background:none;border:none;color:#888;font-size:1.1rem;cursor:pointer;">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';

  document.getElementById('closeForgotModal').onclick = function() {
    modal.style.display = 'none';
  };
  document.getElementById('sendResetBtn').onclick = async function() {
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) {
      document.getElementById('forgotMsg').textContent = 'Please enter your email.';
      return;
    }
    document.getElementById('forgotMsg').textContent = 'Sending...';
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      document.getElementById('forgotMsg').textContent = data.message || 'Check your email for a reset link.';
    } catch (err) {
      document.getElementById('forgotMsg').textContent = 'Error sending reset email.';
    }
  };
}
