import React, { useState } from 'react';
import axios from 'axios';

export default function App() {
  const [messages, setMessages] = useState([
    { role: 'system', content: 'You are Nexora AI, a helpful assistant.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const resp = await axios.post('http://localhost:3000/api/chat', { messages: newMessages });
      const assistant = resp.data.reply;
      if (assistant) {
        setMessages(prev => [...prev, assistant]);
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

  return (
    <div className="container">
      <h1>Nexora AI</h1>
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
  );
}
