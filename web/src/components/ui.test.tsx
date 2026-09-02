import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Amount, Field, Input } from "./ui";

describe("UI primitives", () => {
  it("formats large bigint amounts without Number precision loss", () => {
    render(<Amount value={9007199254740993n * 10n ** 18n} precision={0} />);
    expect(screen.getByText("9,007,199,254,740,993")).toBeInTheDocument();
  });

  it("associates field messages with its input", () => {
    render(<Field label="Amount" error="Invalid amount"><Input /></Field>);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Invalid amount");
  });
});
