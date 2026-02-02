import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log('[Main] App starting... version 1.0.1-debug');

console.error('!!! APP STARTING - VERSION 1.0.1-UI-LOUD !!!');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
