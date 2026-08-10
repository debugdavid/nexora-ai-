import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => { setError(null); setMessage(null); }, [mode, email, password]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      const url = `http://localhost:3000/api/auth/${mode}`;
      const resp = await axios.post(url, { email, password });
      if (mode === 'register') {
        setMessage('Registered. Please check your email to verify your account.');
      }
      const { token, user } = resp.data;
      if (token) {
        localStorage.setItem('nexora_token', token);
        onAuth({ token, user });
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Request failed');
    }
  }

  async function requestReset() {
    if (!email) return setError('Enter your email first');
    try {
      await axios.post('http://localhost:3000/api/auth/request-password-reset', { email });
      setMessage('If an account exists, a password reset email has been sent.');
    } catch (err) {
      setError('Could not send reset email');
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
      {message && <div className="message">{message}</div>}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>Switch to {mode === 'login' ? 'Register' : 'Login'}</button>
        <button onClick={requestReset} style={{ marginLeft: 8 }}>Forgot password?</button>
      </div>
    </div>
  );
}
