import { describe, expect, it } from "vitest";
import { parseApiResponse } from "@/lib/api-client";

describe("parseApiResponse", () => {
  it("parses successful JSON responses", async () => {
    const res = new Response(JSON.stringify({ success: true, data: { id: "123" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await parseApiResponse(res);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ id: "123" });
    expect(result.error).toBeNull();
  });

  it("handles JSON error responses gracefully", async () => {
    const res = new Response(
      JSON.stringify({ success: false, error: { message: "Invalid status transition" } }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }
    );
    const result = await parseApiResponse(res);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid status transition");
  });

  it("handles HTML responses without throwing JSON.parse syntax errors", async () => {
    const html = "<!DOCTYPE html><html><body>Error 500</body></html>";
    const res = new Response(html, {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
    const result = await parseApiResponse(res);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Server returned an unexpected error (500)");
  });

  it("detects 401 unauthenticated HTML responses", async () => {
    const html = "<!DOCTYPE html><html><body>Login required</body></html>";
    const res = new Response(html, {
      status: 401,
      headers: { "Content-Type": "text/html" },
    });
    const result = await parseApiResponse(res);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Your session has expired. Please log in again.");
  });

  it("detects 404 HTML responses", async () => {
    const html = "<!DOCTYPE html><html><body>Not Found</body></html>";
    const res = new Response(html, {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
    const result = await parseApiResponse(res);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("The requested item or endpoint was not found.");
  });
});
