export type ValidationIssue = { path: Array<string | number>; message: string };

export function validationIssues(error: unknown): ValidationIssue[] | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  const asIssues = (value: unknown): ValidationIssue[] | null => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const valid = value.every((issue) => {
      if (!issue || typeof issue !== "object") return false;
      const item = issue as Record<string, unknown>;
      return Array.isArray(item.path) && typeof item.message === "string";
    });
    return valid ? value as ValidationIssue[] : null;
  };
  for (const key of ["issues", "errors", "aggregateErrors"]) {
    const issues = asIssues(candidate[key]);
    if (issues) return issues;
  }
  if (typeof candidate.message === "string") {
    try {
      const issues = asIssues(JSON.parse(candidate.message));
      if (issues) return issues;
    } catch {
      // Ordinary error messages are not JSON and are not validation failures.
    }
  }
  return null;
}
