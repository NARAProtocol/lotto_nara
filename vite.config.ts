import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/lotto/",
  plugins: [react()],
  build: {
    outDir: "dist/lotto",
  },
  server: {
    port: 4173,
  },
});