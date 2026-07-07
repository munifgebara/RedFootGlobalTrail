import { defineConfig } from 'vite';

// base './' => caminhos relativos, funciona no GitHub Pages sob /<repo>/
// outDir 'docs' => o Pages pode servir direto da pasta docs/ do branch main
export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
});
