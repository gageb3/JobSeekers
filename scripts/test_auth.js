(async () => {
  try {
    const registerRes = await fetch('http://localhost:3000/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test1', password: 'pass1' }),
    });
    const registerData = await registerRes.json();
    console.log('register status', registerRes.status, registerData);

    const token = registerData.token;
    if (!token) {
      console.error('No token received during registration');
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };

    const meRes = await fetch('http://localhost:3000/api/me', { headers });
    console.log('me status', meRes.status, await meRes.json());
  } catch (err) {
    console.error(err);
  }
})();
