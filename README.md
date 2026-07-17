# TLDR RSS

[![Update RSS](https://github.com/Bullrich/tldr-rss/actions/workflows/deploy.yml/badge.svg)](https://github.com/Bullrich/tldr-rss/actions/workflows/deploy.yml)

Recollection of [TLDR](https://tldr.tech) feeds. Unified into a single RSS feed.

Why?

Because `TLDR` feed publishes only one article per day, but inside this article it has many articles (around 12). I created this tool to access all of them from my RSS reader instead of having to go into each single one individually.

## Article dates

Each article's `pubDate` is the article's actual original publish date, extracted
from the source page itself (via `article:published_time`/`og:*` meta tags, common
`date`/`pubdate` meta names, `<time datetime>` elements, or JSON-LD `datePublished`).
If no date can be found on the source page (e.g. it blocks scraping or has no
metadata), the date falls back to the date of the TLDR digest issue that linked it.

## Configuration

### Environment Variables

- `MAX_DAYS` (optional): Maximum number of days in the past to fetch articles from. Defaults to 10 if not set.
- `SITE_BASE_URL` (optional): Base URL used for the `<link>`/`atom:link` fields in the generated RSS feeds. Defaults to `https://kylegrieder.github.io/tldr-rss`.

Example:
```bash
MAX_DAYS=7 yarn start  # Fetch articles from the last 7 days
```

## Hosting on GitHub Pages

This repo already ships a `.github/workflows/deploy.yml` workflow that builds the
feeds daily and deploys `./site` to GitHub Pages. To turn it on for your fork:

1. Go to the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Run the "Update RSS" workflow once manually (**Actions → Update RSS → Run workflow**),
   or wait for its daily schedule (`0 12 * * *` UTC).
4. Your feeds will be live at `https://<your-username>.github.io/tldr-rss/<feed>.rss`
   (e.g. `tech.rss`, `ai.rss`, `feed.rss` for the combined feed).
