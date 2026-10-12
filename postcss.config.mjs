import { fileURLToPath } from "node:url";

export default {
  plugins: {
    "@tailwindcss/postcss": {},
    [fileURLToPath(new URL("./scripts/postcss-v3-spacing.cjs", import.meta.url))]: {},
  },
};
