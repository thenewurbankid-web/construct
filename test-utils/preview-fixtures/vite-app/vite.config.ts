import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deliberately plain: no Construct plugin. Live preview v2 reaches this app
// from the outside (an injecting loopback proxy), which is the whole point.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1' },
});
