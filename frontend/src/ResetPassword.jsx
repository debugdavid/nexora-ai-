import React, { useState } from 'react';
import axios from 'axios';

export default function ResetPassword() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3000/api/auth/reset-password', { token, password });
      setMessage('Password reset successful. You can now login.');
    } catch (err) {
      setError(err?.response?.data?.error || 'Reset failed');
    }
  }

  if (!token) return <div>Invalid reset link.</div>;

  return (
    <div style={{ padding: 20 }}>
      <h3>Reset your password</h3>
      <form onSubmit={submit}>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password" />
        <button type="submit">Reset password</button>
      </form>
      {message && <div>{message}</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}
