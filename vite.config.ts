import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = dirname(fileURLToPath(import.meta.url));

// TransVoice standalone frontend build.
// Two HTML entries live at the frontend root; the voice runtime lives in src/voice/.
// base stays default '/' — all asset/script references in the HTML and the service
// worker are absolute (/src/..., /favicon.svg, /worklets/...), and server.js serves
// dist/ statically at the origin root.
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        voiceTutor: resolve(projectRoot, 'voice-tutor.html'),
        voiceTutorApp: resolve(projectRoot, 'voice-tutor-app.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('/src/voice/')) {
            return 'voice-runtime';
          }
          return undefined;
        },
      },
    },
  },
});
