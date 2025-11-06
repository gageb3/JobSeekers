(async () => {
  try {
    const registerRes = await fetch('http://localhost:3000/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test1', password: 'pass1' }),
    });
    const registerText = await registerRes.text();
    console.log('register status', registerRes.status, registerText);
    const setCookie = registerRes.headers.get('set-cookie');
    console.log('set-cookie:', setCookie);

    const headers = {};
    if (setCookie) headers['cookie'] = setCookie.split(';')[0];

    const meRes = await fetch('http://localhost:3000/api/me', { headers });
    console.log('me status', meRes.status, await meRes.text());
  } catch (err) {
    console.error(err);
  }
})();
