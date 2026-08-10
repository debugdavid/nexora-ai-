import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ResetPassword from './ResetPassword';
import './styles.css';

const path = window.location.pathname;
if (path.startsWith('/reset')) {
  createRoot(document.getElementById('root')).render(<ResetPassword />);
} else {
  createRoot(document.getElementById('root')).render(<App />);
}
