import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Loads CLAUDE_API_KEY / GROQ_API_KEY from .env (not prefixed with VITE_ —
  // these must NOT be exposed to the renderer, only baked into the main process)
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      electron([
        {
          entry: 'electron/main.ts',
          // Let the plugin start/restart Electron automatically in dev mode
          onstart(options) {
            // ELECTRON_RUN_AS_NODE=1 in the shell env forces Electron to run as plain
            // Node.js, which breaks require('electron') — unset it before spawning.
            options.startup(['.', '--no-sandbox'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })
          },
          vite: {
            define: {
              __CLAUDE_KEY__: JSON.stringify(env.CLAUDE_API_KEY ?? ''),
              __GROQ_KEY__:   JSON.stringify(env.GROQ_API_KEY ?? ''),
            },
            build: {
              outDir: 'dist-electron',
              rollupOptions: { external: ['electron'] }
            }
          }
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: { external: ['electron'] }
            }
          }
        }
      ]),
      renderer()
    ],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') }
    }
  }
})
