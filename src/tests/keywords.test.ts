import { describe, expect, it } from "vitest";
import { extractKeywords } from "@/lib/pipeline/keywords";

describe("extractKeywords", () => {
  it("removes stopwords and normalizes deterministic verb forms", () => {
    const keywords = extractKeywords("분석하고 정리했다 그리고 테스트했다 테스트했다");

    expect(keywords).toEqual(["분석하다", "정리하다", "테스트하다"]);
  });

  it("allows configurable stopwords", () => {
    const keywords = extractKeywords("alpha beta gamma", { stopwords: ["beta"] });

    expect(keywords).toEqual(["alpha", "gamma"]);
  });
});
