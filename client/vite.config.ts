import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// pdf.js decodes scanned pages (CCITT / JBIG2 black-and-white, JPEG 2000) with small WebAssembly modules that it downloads on demand.
// Serve them from a fixed path (/pdfjs-wasm/) in development and copy them into the build, so "Add transcripts from scans" can read scanned PDFs.
const PDFJS_WASM = ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm']
const pdfjsWasmFile = (name: string) => readFileSync(fileURLToPath(new URL(`./node_modules/pdfjs-dist/wasm/${name}`, import.meta.url)))

function pdfjsWasm(): Plugin {
  return {
    name: 'pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use('/pdfjs-wasm/', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\/+/, ''))
        if (!PDFJS_WASM.includes(name)) return next()
        res.setHeader('Content-Type', 'application/wasm')
        res.end(pdfjsWasmFile(name))
      })
    },
    generateBundle() {
      for (const name of PDFJS_WASM) this.emitFile({ type: 'asset', fileName: `pdfjs-wasm/${name}`, source: pdfjsWasmFile(name) })
    },
  }
}

// The API runs on :4000. Proxying /api makes the browser see ONE origin (localhost:5173),
// so the session cookie "just works" with no CORS or SameSite headaches in development.
export default defineConfig({
  plugins: [react(), pdfjsWasm()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})
