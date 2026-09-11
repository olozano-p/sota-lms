/** Auto-grading of choice questions. Text questions are never graded (docs/spec.md §1). */

export interface GradableQuestion {
  id: string;
  type: "single_choice" | "multi_choice" | "short_text" | "long_text";
  required: boolean;
  correctOptionIds: string[];
}

export interface Answer {
  questionId: string;
  optionIds: string[];
  text: string | null;
}

export interface GradeResult {
  /** Percentage over the gradable questions; null when the quiz has none. */
  score: number | null;
  passed: boolean | null;
  correctByQuestion: Record<string, boolean>;
  missingRequired: string[];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function isAnswered(q: GradableQuestion, a: Answer | undefined): boolean {
  if (!a) return false;
  return q.type === "short_text" || q.type === "long_text"
    ? (a.text ?? "").trim().length > 0
    : a.optionIds.length > 0;
}

export function grade(
  questions: GradableQuestion[],
  answers: Answer[],
  passThreshold: number | null,
): GradeResult {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const missingRequired = questions
    .filter((q) => q.required && !isAnswered(q, byQuestion.get(q.id)))
    .map((q) => q.id);
  const gradable = questions.filter((q) => q.type === "single_choice" || q.type === "multi_choice");
  const correctByQuestion: Record<string, boolean> = {};
  let correct = 0;
  for (const q of gradable) {
    const ok = sameSet(byQuestion.get(q.id)?.optionIds ?? [], q.correctOptionIds);
    correctByQuestion[q.id] = ok;
    if (ok) correct++;
  }
  const score = gradable.length ? Math.round((correct / gradable.length) * 1000) / 10 : null;
  const passed = score === null || passThreshold === null ? null : score >= passThreshold;
  return { score, passed, correctByQuestion, missingRequired };
}
