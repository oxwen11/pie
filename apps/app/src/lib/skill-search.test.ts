import { describe, expect, it } from "vitest";

import { searchSkills } from "./skill-search";

function skill(name: string, description = "") {
  return { name, description };
}

describe("searchSkills", () => {
  it("keeps the original order for an empty query", () => {
    const items = [skill("b"), skill("a")];
    expect(searchSkills(items, "  ").map((item) => item.name)).toEqual(["b", "a"]);
    expect(searchSkills(items, "")[0]?.match).toBeNull();
  });

  it("ranks an exact name ahead of a boundary name and drops unrelated names", () => {
    const result = searchSkills(
      [
        skill("agent-browser", "Browser automation"),
        skill("building-native-ui", "Complete guide"),
        skill("ui", "Explore UI"),
      ],
      "ui",
    );
    expect(result.map((item) => item.name)).toEqual(["ui", "building-native-ui"]);
    expect(result[1]?.match).toEqual({
      field: "name",
      ranges: [{ start: "building-native-".length, end: "building-native-ui".length }],
    });
  });

  it("matches a separator-insensitive phrase and skips the separator", () => {
    expect(searchSkills([skill("agent-browser")], "agent browser")[0]?.match).toEqual({
      field: "name",
      ranges: [
        { start: 0, end: 5 },
        { start: 6, end: 13 },
      ],
    });
  });

  it("fuzzy-matches a name abbreviation and records those letters", () => {
    const result = searchSkills(
      [skill("github"), skill("agent-browser"), skill("gh-fix-ci")],
      "gfc",
    );
    expect(result.map((item) => item.name)).toEqual(["gh-fix-ci"]);
    expect(result[0]?.match?.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
      { start: 7, end: 8 },
    ]);
  });

  it("ranks a name match ahead of a description-only match", () => {
    const result = searchSkills(
      [skill("release-notes", "Prepare the changelog"), skill("ship", "Cut a release")],
      "release",
    );
    expect(result.map((item) => item.name)).toEqual(["release-notes", "ship"]);
    expect(result[0]?.match?.field).toBe("name");
    expect(result[1]?.match).toEqual({
      field: "description",
      ranges: [{ start: "Cut a ".length, end: "Cut a release".length }],
    });
  });

  it("keeps highlight ranges aligned when lowercase expands", () => {
    expect(searchSkills([skill("İx")], "x")[0]?.match?.ranges).toEqual([{ start: 1, end: 2 }]);
  });

  it("matches a multi-word query across separators without highlighting them", () => {
    expect(searchSkills([skill("gh-fix-ci")], "fix ci")[0]?.match?.ranges).toEqual([
      { start: 3, end: 6 },
      { start: 7, end: 9 },
    ]);
  });
});
