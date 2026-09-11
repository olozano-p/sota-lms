import { describe, expect, it } from "vitest";
import { grade, type GradableQuestion } from "./quiz-grading";

const qs: GradableQuestion[] = [
  { id: "q1", type: "single_choice", required: true, correctOptionIds: ["b"] },
  { id: "q2", type: "multi_choice", required: true, correctOptionIds: ["x", "y"] },
  { id: "q3", type: "short_text", required: false, correctOptionIds: [] },
  { id: "q4", type: "long_text", required: true, correctOptionIds: [] },
];

describe("grade", () => {
  it("scores exact matches over the choice questions only", () => {
    const r = grade(
      qs,
      [
        { questionId: "q1", optionIds: ["b"], text: null },
        { questionId: "q2", optionIds: ["x"], text: null },
        { questionId: "q4", optionIds: [], text: "some thoughts" },
      ],
      50,
    );
    expect(r.score).toBe(50);
    expect(r.passed).toBe(true);
    expect(r.correctByQuestion).toEqual({ q1: true, q2: false });
    expect(r.missingRequired).toEqual([]);
  });
  it("reports missing required answers", () => {
    const r = grade(qs, [{ questionId: "q1", optionIds: ["a"], text: null }], null);
    expect(r.missingRequired).toEqual(["q2", "q4"]);
    expect(r.passed).toBeNull();
  });
  it("has no score for reflective forms", () => {
    const r = grade([qs[2]!, qs[3]!], [{ questionId: "q4", optionIds: [], text: "x" }], 60);
    expect(r.score).toBeNull();
    expect(r.passed).toBeNull();
  });
});
