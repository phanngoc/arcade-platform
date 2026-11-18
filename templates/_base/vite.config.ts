import { defineConfig } from 'vite';

// base './': platform phục vụ game ở /g/<id>/ (hoặc domain riêng) — đường dẫn
// tuyệt đối sẽ trỏ ra gốc platform và vỡ hết asset.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
  server: { port: 5173, host: true },
});
