// Tailwind registers both core and custom utilities with the same name.
// Keep the legacy sibling rules in globals.css and remove only the core v4
// last-child rules, so their bottom margins cannot double the old spacing.
module.exports = () => ({
  postcssPlugin: "ad-studio-v3-spacing",
  OnceExit(root) {
    const legacyParents = new Set();
    root.walkRules((rule) => {
      const selector = (rule.selector || "").replace(/\s+/g, "");
      if ((selector.includes("space-y-") || selector.includes("space-x-")) &&
          selector.endsWith(">:not([hidden])~:not([hidden])")) {
        legacyParents.add(selector.slice(0, selector.lastIndexOf(">:not([hidden])")));
      }
    });
    root.walkRules((rule) => {
      const selector = (rule.selector || "").replace(/\s+/g, "");
      if ([...legacyParents].some((parent) => selector.includes(`:where(${parent}>:not(:last-child))`))) rule.remove();
    });
  },
});
module.exports.postcss = true;
