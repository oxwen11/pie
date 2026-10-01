import { describe, expect, it } from "vitest";

import {
  createSlashCommandSuggestionItems,
  filterSlashCommandItems,
} from "./slash-command-suggestions";

describe("filterSlashCommandItems", () => {
  it("ranks slash skills with the skill matcher and keeps unmatched commands out", () => {
    const filtered = filterSlashCommandItems(
      createSlashCommandSuggestionItems([
        { name: "skill:building-native-ui", description: "guide", source: "skill" },
        { name: "explain", description: "Explain the selected code", source: "prompt" },
        { name: "skill:ui", description: "Explore UI", source: "skill" },
      ]),
      "ui",
    );
    expect(filtered.map((item) => item.command.name)).toEqual([
      "skill:ui",
      "skill:building-native-ui",
    ]);
    expect(filtered[0]?.match?.ranges).toEqual([{ start: 0, end: 2 }]);
  });
});
