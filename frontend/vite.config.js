import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": { target: "digital-marketing-analytics.railway.internal", changeOrigin: true },
      "/qr": { target: "digital-marketing-analytics.railway.internal", changeOrigin: true },
    },
  },  
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":   ["react", "react-dom"],
          "vendor-charts":  ["recharts"],
          "vendor-icons":   ["lucide-react"],
          "vendor-axios":   ["axios"],
        },
      },
    },
  },
});
