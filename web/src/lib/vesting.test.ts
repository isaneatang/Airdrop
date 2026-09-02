import { describe, expect, it } from "vitest";
import { vestedAmount } from "./vesting";

describe("vesting mirror", () => {
  it("matches the terminal exactness and cliff rules", () => {
    expect(vestedAmount(100n, 10n, 20n, 110n, 19n)).toBe(0n);
    expect(vestedAmount(100n, 10n, 20n, 110n, 60n)).toBe(50n);
    expect(vestedAmount(100n, 10n, 20n, 110n, 110n)).toBe(100n);
    expect(vestedAmount(100n, 10n, 20n, 110n, 999n)).toBe(100n);
  });
});
