import { describe, it, expect } from "vitest";
import { normalizeRemoteDraftResult } from "./remote-draft-normalizer";

describe("normalizeRemoteDraftResult", () => {
  it("returns null for missing summary", () => {
    expect(normalizeRemoteDraftResult({ title: "test" })).toBeNull();
  });

  it("sanitizes HTML in remote draft fields", () => {
    const result = normalizeRemoteDraftResult({
      title: "<img src=x onerror=alert(1)>",
      summary: "Summary with <script>bad()</script>",
      sections: [{ heading: "<b>heading</b>", body: "<p>body</p>" }],
      suggestedTags: ["<tag>"],
      warnings: ["<alert>"],
      model: "<model>",
    });
    expect(result).not.toBeNull();
    expect(result?.title).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(result?.summary).toBe("Summary with &lt;script&gt;bad()&lt;/script&gt;");
    expect(result?.sections?.[0].heading).toBe("&lt;b&gt;heading&lt;/b&gt;");
    expect(result?.sections?.[0].body).toBe("&lt;p&gt;body&lt;/p&gt;");
    expect(result?.suggestedTags?.[0]).toBe("&lt;tag&gt;");
    expect(result?.warnings?.[0]).toBe("&lt;alert&gt;");
    expect(result?.model).toBe("&lt;model&gt;");
  });

  it("caps overly long fields", () => {
    const long = "a".repeat(10_000);
    const result = normalizeRemoteDraftResult({ summary: long });
    expect(result?.summary.length).toBeLessThanOrEqual(8001);
  });
});
