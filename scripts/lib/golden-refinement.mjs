function normalizedFiles(app) {
  if (Array.isArray(app?.files) && app.files.length) {
    return app.files
      .filter((file) => file && typeof file.path === "string" && typeof file.content === "string")
      .map((file) => ({ path: file.path.replace(/\\/g, "/").replace(/^\/+/, ""), content: file.content }));
  }
  if (typeof app?.code === "string" && app.code.trim()) {
    return [{ path: "App.jsx", content: app.code }];
  }
  return [];
}

function boundaryPreservedChars(before, after) {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return prefix + suffix;
}

function normalizedText(value) {
  return String(value || "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export function filesForRefinement(app) {
  return normalizedFiles(app);
}

export function evaluateRefinementPreservation(beforeApp, afterApp, requiredText, minimumPreservationRate = 90) {
  const beforeFiles = normalizedFiles(beforeApp);
  const afterFiles = normalizedFiles(afterApp);
  const afterByPath = new Map(afterFiles.map((file) => [file.path, file.content]));
  const beforePaths = new Set(beforeFiles.map((file) => file.path));
  const missingFiles = beforeFiles.filter((file) => !afterByPath.has(file.path)).map((file) => file.path);
  const changedFiles = beforeFiles
    .filter((file) => afterByPath.get(file.path) !== file.content)
    .map((file) => file.path)
    .concat(afterFiles.filter((file) => !beforePaths.has(file.path)).map((file) => file.path));
  const totalChars = beforeFiles.reduce((total, file) => total + file.content.length, 0);
  const preservedChars = beforeFiles.reduce((total, file) => {
    const after = afterByPath.get(file.path);
    if (typeof after !== "string") return total;
    return total + (after === file.content ? file.content.length : boundaryPreservedChars(file.content, after));
  }, 0);
  const preservationRate = totalChars > 0 ? Math.round((preservedChars / totalChars) * 1000) / 10 : 0;
  const targetPresent = normalizedText(afterFiles.map((file) => file.content).join("\n")).includes(normalizedText(requiredText));
  const passed = beforeFiles.length > 0
    && afterFiles.length > 0
    && missingFiles.length === 0
    && changedFiles.length > 0
    && targetPresent
    && preservationRate >= minimumPreservationRate;

  return {
    passed,
    targetPresent,
    preservationRate,
    minimumPreservationRate,
    changedFiles: Array.from(new Set(changedFiles)).sort(),
    missingFiles,
  };
}
