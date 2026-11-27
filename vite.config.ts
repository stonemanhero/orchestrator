import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleApiRequest } from "./server/orchestrator";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "mmm-orchestrator-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith("/api/")) {
            handleApiRequest(req, res, req.url.split("?")[0]);
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
});
