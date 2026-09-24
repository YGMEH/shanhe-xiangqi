import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 4173,
    host: "0.0.0.0",
    watch: {
      // 编辑器/工具改写 .js 时会先落一个临时文件再改名, Vite 的 fs watcher
      // 会去 watch 那个瞬间消失的临时文件, 抛 EBUSY 并让整个 dev server 崩溃
      // (表现为浏览器 ERR_CONNECTION_REFUSED)。
      // 忽略临时产物并改用轮询, 避免和写入方抢文件句柄。
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/*.tmpdir/**"],
      usePolling: true,
      interval: 300,
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
});
