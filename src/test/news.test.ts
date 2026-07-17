import { JSDOM } from "jsdom";
import Parser from "rss-parser";

import {
  extractPublishedDate,
  fetchArticlePublishedDate,
  fetchNews,
  getRSSFeed,
} from "../news";

// Helper function to create a setTimeout mock that executes immediately
function createMockSetTimeout(): jest.SpyInstance {
  return jest.spyOn(global, "setTimeout").mockImplementation((callback) => {
    // Call callback immediately for test
    (callback as () => void)();
    const mockTimeout: NodeJS.Timeout = {
      ref: () => mockTimeout,
      unref: () => mockTimeout,
      hasRef: () => true,
      refresh: () => mockTimeout,
      [Symbol.toPrimitive]: () => 0,
      [Symbol.dispose]: () => {},
    };
    return mockTimeout;
  });
}

describe("fetchNews", () => {
  it("should return empty array when URL returns 404", async () => {
    // Test with a URL that should return 404
    const result = await fetchNews("https://httpstat.us/404");
    expect(result).toEqual([]);
  });

  it("should return empty array when URL is invalid", async () => {
    // Test with an invalid URL
    const result = await fetchNews(
      "https://invalid-url-that-does-not-exist.invalid",
    );
    expect(result).toEqual([]);
  });
});

describe("extractPublishedDate", () => {
  const docFrom = (html: string): Document => new JSDOM(html).window.document;

  it("finds the date from article:published_time meta tag", () => {
    const doc = docFrom(
      `<html><head><meta property="article:published_time" content="2024-03-15T10:00:00Z"></head></html>`,
    );
    expect(extractPublishedDate(doc)).toBe("2024-03-15T10:00:00.000Z");
  });

  it("falls back to a time[datetime] element", () => {
    const doc = docFrom(
      `<html><body><time datetime="2024-01-02T08:30:00Z">Jan 2</time></body></html>`,
    );
    expect(extractPublishedDate(doc)).toBe("2024-01-02T08:30:00.000Z");
  });

  it("finds the date from JSON-LD structured data", () => {
    const doc = docFrom(
      `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "NewsArticle",
        datePublished: "2024-05-20T14:00:00Z",
      })}</script></head></html>`,
    );
    expect(extractPublishedDate(doc)).toBe("2024-05-20T14:00:00.000Z");
  });

  it("returns undefined when no date is present", () => {
    const doc = docFrom(`<html><head></head><body>No date here</body></html>`);
    expect(extractPublishedDate(doc)).toBeUndefined();
  });

  it("returns undefined for malformed JSON-LD instead of throwing", () => {
    const doc = docFrom(
      `<html><head><script type="application/ld+json">not json</script></head></html>`,
    );
    expect(extractPublishedDate(doc)).toBeUndefined();
  });

  it("ignores unparseable date values", () => {
    const doc = docFrom(
      `<html><head><meta name="date" content="not-a-date"></head></html>`,
    );
    expect(extractPublishedDate(doc)).toBeUndefined();
  });
});

describe("fetchArticlePublishedDate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the published date extracted from the fetched page", async () => {
    const axios = (await import("axios")).default;
    jest.spyOn(axios, "get").mockResolvedValue({
      data: `<html><head><meta property="article:published_time" content="2024-06-01T09:00:00Z"></head></html>`,
    });

    const result = await fetchArticlePublishedDate(
      "https://example.com/article",
    );
    expect(result).toBe("2024-06-01T09:00:00.000Z");
  });

  it("returns undefined when the request fails", async () => {
    const axios = (await import("axios")).default;
    jest.spyOn(axios, "get").mockRejectedValue(new Error("Network error"));

    const result = await fetchArticlePublishedDate(
      "https://example.com/article",
    );
    expect(result).toBeUndefined();
  });
});

describe("getRSSFeed", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("should handle successful RSS feed parsing", async () => {
    // Mock parser to simulate successful parsing
    const mockParser = {
      parseURL: jest.fn().mockResolvedValue({ items: [{ title: "Test" }] }),
    };
    jest
      .spyOn(Parser.prototype, "parseURL")
      .mockImplementation(mockParser.parseURL);

    const result = await getRSSFeed("https://example.com/rss");

    expect(result).toEqual({ items: [{ title: "Test" }] });
    expect(mockParser.parseURL).toHaveBeenCalledWith("https://example.com/rss");

    jest.restoreAllMocks();
  });

  it("should retry on 429 errors up to 7 times total", async () => {
    const error429 = new Error("Too Many Requests") as Error & {
      response: { status: number; headers: Record<string, string> };
    };
    error429.response = {
      status: 429,
      headers: { "retry-after": "1" },
    };

    const mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({ items: [{ title: "Success after retries" }] });

    const result = await getRSSFeed("https://example.com/rss");

    expect(result).toEqual({ items: [{ title: "Success after retries" }] });
    expect(mockParser).toHaveBeenCalledTimes(7);

    jest.restoreAllMocks();
  }, 10000); // 10 second timeout for this test

  it("should fail after 7 attempts for 429 errors", async () => {
    const error429 = new Error("Too Many Requests") as Error & {
      response: { status: number; headers: Record<string, string> };
    };
    error429.response = {
      status: 429,
      headers: { "retry-after": "1" },
    };

    const mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValue(error429);

    await expect(getRSSFeed("https://example.com/rss")).rejects.toThrow(
      "Too Many Requests",
    );
    expect(mockParser).toHaveBeenCalledTimes(7);

    jest.restoreAllMocks();
  }, 10000); // 10 second timeout for this test

  it("should succeed after failing 4 times and succeeding on 5th attempt", async () => {
    const error429 = new Error("Too Many Requests") as Error & {
      response: { status: number; headers: Record<string, string> };
    };
    error429.response = {
      status: 429,
      headers: { "retry-after": "1" },
    };

    const mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({ items: [{ title: "Success on 5th try" }] });

    const result = await getRSSFeed("https://example.com/rss");

    expect(result).toEqual({ items: [{ title: "Success on 5th try" }] });
    expect(mockParser).toHaveBeenCalledTimes(5);

    jest.restoreAllMocks();
  }, 10000); // 10 second timeout for this test

  it("should not retry on non-429 errors", async () => {
    const error404 = new Error("Not Found") as Error & {
      response: { status: number };
    };
    error404.response = { status: 404 };

    const mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValue(error404);

    await expect(getRSSFeed("https://example.com/rss")).rejects.toThrow(
      "Not Found",
    );
    expect(mockParser).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
  });

  it("should use default 30 second delay when retry-after header is missing", async () => {
    const error429 = new Error("Too Many Requests") as Error & {
      response: { status: number; headers: Record<string, string> };
    };
    error429.response = {
      status: 429,
      headers: {},
    };

    // Mock Date.now and setTimeout to test delay
    const setTimeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback, delay) => {
        expect(delay).toBe(30000); // Should be 30 seconds
        // Call callback immediately for test
        (callback as () => void)();
        const mockTimeout: NodeJS.Timeout = {
          ref: () => mockTimeout,
          unref: () => mockTimeout,
          hasRef: () => true,
          refresh: () => mockTimeout,
          [Symbol.toPrimitive]: () => 0,
          [Symbol.dispose]: () => {},
        };
        return mockTimeout;
      });

    const _mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({ items: [{ title: "Success" }] });

    const result = await getRSSFeed("https://example.com/rss");

    expect(result).toEqual({ items: [{ title: "Success" }] });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

    setTimeoutSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("should retry on 429 errors with message only (no response object)", async () => {
    // This simulates how rss-parser throws errors: just Error("Status code 429")
    const error429 = new Error("Status code 429");

    const setTimeoutSpy = createMockSetTimeout();

    const mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValueOnce(error429)
      .mockRejectedValueOnce(error429)
      .mockResolvedValueOnce({ items: [{ title: "Success after retries" }] });

    const result = await getRSSFeed("https://example.com/rss");

    expect(result).toEqual({ items: [{ title: "Success after retries" }] });
    expect(mockParser).toHaveBeenCalledTimes(3);

    setTimeoutSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("should fail after 7 attempts for 429 errors with message only", async () => {
    // This simulates how rss-parser throws errors: just Error("Status code 429")
    const error429 = new Error("Status code 429");

    const setTimeoutSpy = createMockSetTimeout();

    const mockParser = jest
      .spyOn(Parser.prototype, "parseURL")
      .mockRejectedValue(error429);

    await expect(getRSSFeed("https://example.com/rss")).rejects.toThrow(
      "Status code 429",
    );
    expect(mockParser).toHaveBeenCalledTimes(7);

    setTimeoutSpy.mockRestore();
    jest.restoreAllMocks();
  });
});
