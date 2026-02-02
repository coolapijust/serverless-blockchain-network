import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

// Register Service Worker for PWA
registerSW({
  onNeedRefresh() {
    console.log('[PWA] New content available, updating...');
    // Auto-update is enabled in vite.config.ts, but we needs to reload?
    // With registerType: 'autoUpdate', valid SW should update automatically.
  },
  onOfflineReady() {
    console.log('[PWA] App ready to work offline');
  },
})

console.log('[Main] App starting... version 1.0.1-debug');

console.error('!!! APP STARTING - VERSION 1.0.1-UI-LOUD !!!');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
