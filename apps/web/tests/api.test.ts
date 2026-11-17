import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scan API client", () => {
  it("sends a bodyless scan request without a JSON content type", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ scanId: "scan-id", status: "queued" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.scans.start();

    const [, options] = fetchMock.mock.calls[0]!;
    expect(options?.method).toBe("POST");
    expect(options?.body).toBeUndefined();
    expect(options?.headers).toBeUndefined();
  });
});
