import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/jetbrains-mono';
import './tokens.css';
import './app.css';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { SettingsProvider } from './settings.jsx';
import { ToastProvider } from './toast.jsx';
import { MotionConfig } from 'motion/react';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SettingsProvider>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </MotionConfig>
    </SettingsProvider>
  </StrictMode>,
);
