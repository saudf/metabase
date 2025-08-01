import { mockSettings } from "__support__/settings";
import { render, screen } from "__support__/ui";
import { createMockColumn } from "metabase-types/api/mocks";

import type { OptionsType } from "./types";
import { formatValue } from "./value";

describe("formatValue", () => {
  const setup = (value: any, overrides: Partial<OptionsType> = {}) => {
    mockSettings();
    const column = createMockColumn({
      base_type: "type/Float",
    });
    const options: OptionsType = {
      view_as: "auto",
      column: column,
      type: "cell",
      jsx: true,
      rich: true,
      clicked: {
        value: value,
        column: column,
        origin: {
          rowIndex: 0,
          row: [value],
          cols: [column],
        },
        data: [
          {
            value: value,
            col: column,
          },
        ],
      },
      ...overrides,
    };
    render(<>{formatValue(value, options)}</>);
  };

  describe("link", () => {
    it("should not apply prefix or suffix more than once for links with no link_text", () => {
      setup(23.12, {
        view_as: "link",
        prefix: "foo ",
        suffix: " bar",
        link_url: "http://google.ca",
      });
      expect(
        screen.getByText((content) => content.startsWith("foo")),
      ).toBeInTheDocument();
      expect(
        screen.getByText((content) => content.endsWith("bar")),
      ).toBeInTheDocument();
      expect(screen.getByText("23.12")).toBeInTheDocument();
    });

    it("should not apply prefix or suffix to null values", () => {
      setup(null, {
        prefix: "foo ",
        suffix: " bar",
      });

      const anyContent = screen.queryByText(/./);
      expect(anyContent).not.toBeInTheDocument();
    });

    it("should trim values to specified decimals", () => {
      setup(23.123459, {
        decimals: 5,
        number_style: "decimal",
        number_separators: ".",
      });
      expect(screen.getByText("23.12346")).toBeInTheDocument();
    });

    it("should preserve number separator formatting when displayed as a link with no URL set", () => {
      setup(100000.0, {
        view_as: "link",
        number_style: "decimal",
        number_separators: ".,",
      });
      expect(screen.getByText("100,000")).toBeInTheDocument();
    });

    it("should preserve number separator formatting when displayed as a link with a custom URL", () => {
      setup(100000.0, {
        view_as: "link",
        number_style: "decimal",
        number_separators: ".,",
        link_url: "http://example.com",
      });
      expect(screen.getByText("100,000")).toBeInTheDocument();
    });
  });

  describe("remapped column", () => {
    it("should apply formatting settings", () => {
      const column = createMockColumn({
        base_type: "type/Float",
        remapped_to_column: createMockColumn({
          base_type: "type/Text",
        }),
        remapping: new Map([
          [1, "One"],
          [2, "2"],
          [3, "Three"],
        ]),
      } as any);
      setup(1, { column, scale: 100 });
      expect(screen.getByText("One")).toBeInTheDocument();

      setup(2, { column, scale: 100 });
      expect(screen.getByText("200")).toBeInTheDocument();
    });
  });
});
