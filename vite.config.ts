import { defineConfig } from 'vite';
// Relative asset paths so the build works inside the Android WebView (Capacitor).
export default defineConfig({ base: './' });
