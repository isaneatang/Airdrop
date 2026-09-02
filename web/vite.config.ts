import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Deployment secrets and VITE_* frontend settings live in the repository root.
  envDir: "..",
  server: { host: true },
});
