import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {src: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js", dest: "./lib"},
        {src: "node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx", dest: "./lib"},
        {src: "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx", dest: "./lib"},
        {src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "./lib"},
        {src: "node_modules/onnxruntime-web/dist/*.mjs", dest: "./lib"},
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        setup: resolve(__dirname, 'mic-permission.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        offscreen: resolve(__dirname, 'offscreen.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return `src/${chunkInfo.name}/index.js`;
        },
      },
    },
  },
})
