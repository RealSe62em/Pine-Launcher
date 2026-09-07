# Search visibility investigation — September 6, 2026

The verified Search Console property is `https://realse62em.github.io/Pine-Launcher/`.

Observed in Google's reports:

- URL Inspection: **URL is on Google**, **Page is indexed**.
- Crawl allowed: Yes. Page fetch: Successful. Indexing allowed: Yes.
- Google-selected canonical matches the inspected homepage.
- Last recorded crawl: August 19, 2026.
- Page indexing report (last updated August 28): one indexed page, zero excluded pages.
- Manual actions: No issues detected.
- Temporary removals: No requests submitted in the last six months.
- Sitemap `/sitemap.xml`: Couldn't fetch; original submission August 19.

The homepage and sitemap are publicly reachable. The sitemap returned valid XML at the canonical project URL. The sitemap was resubmitted on September 6 and Google confirmed **Sitemap submitted successfully**. The report still showed its previous **Couldn't fetch** status immediately afterward, so successful reprocessing has not yet been verified.

This is not evidence that Google removed Pine from its index. Indexed pages are not guaranteed to appear for every query. The Performance report can establish which search terms receive impressions and how positions change. Recheck the sitemap after Google processes the submission; if fetching still fails, inspect its specific error before changing canonical or robots settings.

The project-level robots.txt cannot control the entire github.io host. Google looks for robots.txt at the host root; the root currently returns 404, which does not prohibit crawling. No noindex or canonical change was warranted.

[Search Console sitemap report](https://search.google.com/search-console/sitemaps?resource_id=https%3A%2F%2Frealse62em.github.io%2FPine-Launcher%2F)
