import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => setError(null), [mode, email, password]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const url = `http://localhost:3000/api/auth/${mode}`;
      const resp = await axios.post(url, { email, password });
      const { token, user } = resp.data;
      localStorage.setItem('nexora_token', token);
      onAuth({ token, user });
    } catch (err) {
      setError(err?.response?.data?.error || 'Request failed');
    }
  }

  return (
    <div className="auth">
      <h3>{mode === 'login' ? 'Login' : 'Register'}</h3>
      <form onSubmit={submit}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
        <button type="submit">{mode === 'login' ? 'Login' : 'Register'}</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>Switch to {mode === 'login' ? 'Register' : 'Login'}</button>
      </div>
    </div>
  );
}
