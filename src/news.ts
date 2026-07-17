/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import axios from "axios";
import { JSDOM } from "jsdom";
import Parser from "rss-parser";

import { News } from "./types";
import { logger } from "./util";

export const getRSSFeed = async (
  feed: string,
): Promise<Parser.Output<Record<string, unknown>>> => {
  const parser = new Parser();
  logger.info(`Fetching feed for ${feed}`);

  const maxRetries = 6; // 6 retries + 1 initial attempt = 7 total attempts
  let attemptCount = 0;

  while (attemptCount <= maxRetries) {
    try {
      return await parser.parseURL(feed);
    } catch (error: unknown) {
      attemptCount++;

      // Check if this is a 429 error
      // Some libraries throw errors with a response object, others just with a message
      const errorWithResponse = error as {
        response?: { status?: number; headers?: Record<string, string> };
      };
      const is429Error =
        errorWithResponse?.response?.status === 429 ||
        (error instanceof Error && error.message.includes("Status code 429"));

      if (!is429Error || attemptCount > maxRetries) {
        // If it's not a 429 error, or we've exhausted all retries, throw the error
        if (is429Error && attemptCount > maxRetries) {
          logger.warn(
            `Failed to fetch RSS feed for ${feed} after ${maxRetries + 1} attempts due to rate limiting`,
          );
        }
        throw error;
      }

      // Extract retry delay from Retry-After header or default to 30 seconds
      const retryAfter = errorWithResponse.response?.headers?.["retry-after"];
      const delaySeconds =
        retryAfter && !isNaN(parseInt(retryAfter, 10))
          ? parseInt(retryAfter, 10)
          : 30;
      const delayMs = delaySeconds * 1000;

      logger.warn(
        `Rate limited (429) for feed ${feed}. Retrying in ${delaySeconds} seconds (attempt ${attemptCount}/${maxRetries + 1})`,
      );

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // This should never be reached, but TypeScript needs this to understand the function always returns or throws
  throw new Error("Unexpected end of retry loop");
};

// Common places outlets expose an article's original publish date
const DATE_META_SELECTORS: { selector: string; attr: string }[] = [
  { selector: 'meta[property="article:published_time"]', attr: "content" },
  { selector: 'meta[name="article:published_time"]', attr: "content" },
  { selector: 'meta[property="og:article:published_time"]', attr: "content" },
  { selector: 'meta[itemprop="datePublished"]', attr: "content" },
  { selector: 'meta[name="publish-date"]', attr: "content" },
  { selector: 'meta[name="publishdate"]', attr: "content" },
  { selector: 'meta[name="date"]', attr: "content" },
  { selector: 'meta[name="pubdate"]', attr: "content" },
  { selector: 'meta[name="sailthru.date"]', attr: "content" },
  { selector: "time[datetime]", attr: "datetime" },
];

const parseDate = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

// Looks for a datePublished/dateCreated field in JSON-LD structured data
const extractDateFromJsonLd = (doc: Document): string | undefined => {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts.values()) {
    try {
      const json: unknown = JSON.parse(script.textContent ?? "");
      const candidates = Array.isArray(json) ? json : [json];
      for (const candidate of candidates) {
        const record = candidate as Record<string, unknown>;
        const dateValue = record?.datePublished ?? record?.dateCreated;
        const parsed = parseDate(
          typeof dateValue === "string" ? dateValue : undefined,
        );
        if (parsed) return parsed;
      }
    } catch {
      // Malformed JSON-LD, skip it
    }
  }
  return undefined;
};

export const extractPublishedDate = (doc: Document): string | undefined => {
  for (const { selector, attr } of DATE_META_SELECTORS) {
    const value = doc.querySelector(selector)?.getAttribute(attr);
    const parsed = parseDate(value);
    if (parsed) return parsed;
  }

  return extractDateFromJsonLd(doc);
};

// Fetches the original article page and tries to find its true publish date
export const fetchArticlePublishedDate = async (
  url: string,
): Promise<string | undefined> => {
  try {
    const response = await axios.get<string>(url, {
      timeout: 8000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; tldr-rss/1.0; +https://github.com/kylegrieder/tldr-rss)",
      },
    });
    const dom = new JSDOM(response.data);
    const date = extractPublishedDate(dom.window.document);
    if (!date) {
      logger.debug(`No published date found on ${url}`);
    }
    return date;
  } catch (error) {
    logger.debug(
      `Failed to fetch original publish date from ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
};

export const fetchNews = async (url: string): Promise<News[]> => {
  logger.info(`Downloading site from ${url}`);
  try {
    const siteFetch = await axios.get(url);
    const site = new JSDOM(siteFetch.data as string);
    const doc = site.window.document;

    const news: News[] = [];

    // We get all the headers
    const headers = doc.querySelectorAll("h3");
    logger.info(`Found ${headers.length} headers. Parsing them`);
    for (const header of headers.values()) {
      const title = header.textContent;
      const link = header.parentElement?.getAttribute("href");
      const content =
        header.parentElement?.parentElement?.querySelector("div")?.textContent;
      if (!title || !link || !content) {
        logger.debug(
          `Skipping null elements: ${title ?? "title"} ${url} ${
            content ?? "content"
          }`,
        );
        continue;
      }

      news.push({ title, link, content });
    }

    return news;
  } catch (error) {
    logger.info(
      `Failed to fetch news from ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};
