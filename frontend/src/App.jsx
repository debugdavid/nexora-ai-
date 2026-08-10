import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Auth from './Auth';

export default function App() {
  const [messages, setMessages] = useState([{ role: 'system', content: 'You are Nexora AI, a helpful assistant.' }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [auth, setAuth] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('nexora_token');
    if (token) {
      setAuth({ token });
      loadConversations(token);
    }
  }, []);

  async function loadConversations(token) {
    try {
      const resp = await axios.get('http://localhost:3000/api/conversations', { headers: { Authorization: `Bearer ${token}` } });
      setConversations(resp.data.conversations || []);
    } catch (err) {
      console.error('Could not load convos', err);
    }
  }

  async function send() {
    if (!input.trim()) return;
    if (!auth) return alert('Please login first');
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const resp = await axios.post('http://localhost:3000/api/chat', { messages: newMessages, conversationId }, { headers: { Authorization: `Bearer ${auth.token}` } });
      const assistant = resp.data.reply;
      if (assistant) {
        setMessages(prev => [...prev, assistant]);
        if (resp.data.conversationId) setConversationId(resp.data.conversationId);
        // refresh conversation list
        loadConversations(auth.token);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'No response from model.' }]);
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error contacting server.' }]);
    } finally {
      setLoading(false);
    }
  }

  function onAuth(data) {
    setAuth(data);
    loadConversations(data.token);
  }

  function selectConversation(convo) {
    setConversationId(convo.id);
    // load messages from convo
    const msgs = convo.messages.map(m => ({ role: m.role, content: m.content }));
    const system = { role: 'system', content: 'You are Nexora AI, a helpful assistant.' };
    setMessages([system, ...msgs]);
  }

  return (
    <div className="container">
      <h1>Nexora AI</h1>

      {!auth ? (
        <Auth onAuth={onAuth} />
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ width: 220 }}>
            <h3>Conversations</h3>
            <button onClick={() => loadConversations(auth.token)}>Refresh</button>
            <div style={{ marginTop: 8 }}>
              {conversations.map(c => (
                <div key={c.id} style={{ padding: 8, border: '1px solid #ddd', marginBottom: 8, cursor: 'pointer' }} onClick={() => selectConversation(c)}>
                  <div style={{ fontWeight: 600 }}>{c.title || 'Untitled'}</div>
                  <div style={{ fontSize: 12 }}>{new Date(c.updatedAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div className="chat-window">
              {messages.filter(m => m.role !== 'system').map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <strong>{m.role}</strong>
                  <div>{m.content}</div>
                </div>
              ))}
              {loading && <div className="msg assistant">...thinking</div>}
            </div>

            <div className="composer">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
                placeholder="Type your message..."
              />
              <button onClick={send} disabled={loading}>Send</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
