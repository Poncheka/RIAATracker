import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  // DEMO_SINGLEFILE=1 inlines everything into one HTML file (used for the hosted demo).
  plugins: process.env.DEMO_SINGLEFILE ? [viteSingleFile()] : [],
  server: { fs: { allow: [".."] } }, // engine lives in ../supabase/functions/_shared
});
