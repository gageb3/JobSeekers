// Simple client-side login handler (mock auth)
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const msg = document.getElementById('loginMsg');

  // Check if token exists in localStorage and validate it
  const token = localStorage.getItem('token');
  if (token) {
    fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.ok) {
          window.location = '/home';
        } else {
          localStorage.removeItem('token');
        }
      })
      .catch(() => {});
  }

  // Register toggle
  let isRegister = false;
  const toggle = document.getElementById('toggleRegister');
  const formTitle = document.getElementById('formTitle');
  const submitBtn = form.querySelector('button[type="submit"]');
  const confirmWrap = document.getElementById('confirmWrap');

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    isRegister = !isRegister;
    if (isRegister) {
      formTitle.textContent = 'Create an account';
      submitBtn.textContent = 'Register';
      confirmWrap.style.display = '';
      toggle.textContent = 'Back to login';
    } else {
      formTitle.textContent = 'Welcome — please sign in';
      submitBtn.textContent = 'Sign in';
      confirmWrap.style.display = 'none';
      toggle.textContent = 'Create account';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const passwordConfirm = document.getElementById('passwordConfirm')?.value;

    if (!username || !password) {
      msg.textContent = 'Please enter username and password.';
      return;
    }

    if (isRegister) {
      if (!passwordConfirm) {
        msg.textContent = 'Please confirm your password.';
        return;
      }
      if (password !== passwordConfirm) {
        msg.textContent = 'Passwords do not match.';
        return;
      }

      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          msg.textContent = data.error || 'Registration failed';
          return;
        }
        localStorage.setItem('token', data.token);
        window.location = '/home';
      } catch (err) {
        msg.textContent = 'Network error';
      }
      return;
    }

    // Normal login
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || 'Login failed';
        return;
      }
      localStorage.setItem('token', data.token);
      window.location = '/home';
    } catch (err) {
      msg.textContent = 'Network error';
    }
  });
});
