import { describe, expect, it } from "vitest";
import { buildMultiFileSrcDoc } from "./multi-file-srcdoc";

describe("buildMultiFileSrcDoc", () => {
  it("preserva apps com framer-motion quando o bundler real usa o fallback", () => {
    const html = buildMultiFileSrcDoc([
      {
        path: "App.jsx",
        content: `import { motion, AnimatePresence } from "framer-motion";
          export default function App() {
            return <AnimatePresence><motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Pronto</motion.main></AnimatePresence>;
          }`,
      },
    ], "App.jsx");

    expect(html).toContain("function framerMotionShim()");
    expect(html).toContain("spec==='framer-motion'||spec==='motion/react'");
    expect(html).toContain("framer-motion, motion/react");
  });
});
