async function register() {
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const fullName = document.getElementById('regFullName').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (!email || !fullName || !password) {
    alert('Please fill in all fields.');
    return;
  }

  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, fullName, password })
  });

  const data = await res.json();
  alert(data.message || JSON.stringify(data));

  if (data.message === 'User created') {
    window.location.href = 'index.html';
  }
}
