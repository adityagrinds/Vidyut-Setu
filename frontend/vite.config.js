import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5188,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          charts: ["recharts"],
          realtime: ["socket.io-client"],
          icons: ["lucide-react"],
        },
      },
    },
  },
  preview: {
    port: 4188,
    strictPort: true,
  },
});
