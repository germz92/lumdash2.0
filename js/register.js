let inviteToken = null;
let inviteValid = false;

function getInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('invite') || params.get('token') || '';
}

function showRegisterError(msg) {
  const el = document.getElementById('registerError');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function setRegisterFormEnabled(enabled) {
  ['regFullName', 'regEmail', 'regPassword', 'registerButton'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

async function validateInviteOnLoad() {
  inviteToken = getInviteTokenFromUrl();
  const note = document.getElementById('registerInviteNote');
  const subtitle = document.getElementById('registerSubtitle');
  const userCountRes = await fetch(`${API_BASE}/api/auth/bootstrap-status`).catch(() => null);

  if (userCountRes?.ok) {
    const bootstrap = await userCountRes.json();
    if (bootstrap.allowOpenRegistration) {
      inviteValid = true;
      if (subtitle) subtitle.textContent = 'Set up the first admin account';
      if (note) {
        note.textContent = 'No accounts exist yet. This first registration creates an admin user.';
        note.style.display = 'block';
      }
      setRegisterFormEnabled(true);
      return;
    }
  }

  if (!inviteToken) {
    showRegisterError('Registration is invite-only. Ask an administrator for an invite link.');
    if (subtitle) subtitle.textContent = 'Invite required';
    setRegisterFormEnabled(false);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/invites/validate/${encodeURIComponent(inviteToken)}`);
    const data = await res.json();
    if (!res.ok || !data.valid) {
      showRegisterError(data.error || 'Invalid or expired invite.');
      setRegisterFormEnabled(false);
      return;
    }

    inviteValid = true;
    const emailInput = document.getElementById('regEmail');
    if (emailInput) {
      emailInput.value = data.email || '';
      emailInput.readOnly = true;
    }
    if (note) {
      note.textContent = `Invited as ${data.role}. Email is locked to your invite.`;
      note.style.display = 'block';
    }
    setRegisterFormEnabled(true);
  } catch (err) {
    showRegisterError('Could not validate invite. Try again later.');
    setRegisterFormEnabled(false);
  }
}

async function register() {
  if (!inviteValid) {
    alert('You need a valid invite to register.');
    return;
  }

  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const fullName = document.getElementById('regFullName').value.trim();
  const password = document.getElementById('regPassword').value;

  if (!email || !fullName || !password) {
    alert('Please fill in all fields.');
    return;
  }
  if (password.length < 6) {
    alert('Password must be at least 6 characters.');
    return;
  }

  const body = { email, fullName, password };
  if (inviteToken) body.inviteToken = inviteToken;

  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || data.message || 'Registration failed');
    return;
  }

  alert('Account created! You can sign in now.');
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', validateInviteOnLoad);
