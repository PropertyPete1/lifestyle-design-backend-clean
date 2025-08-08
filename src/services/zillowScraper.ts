import puppeteer from 'puppeteer';
import { scanRedFlags } from './redFlagScanner';

export type ScrapeInput = {
  propertyType: 'rent' | 'sale' | 'both';
  zipCodes: string[];
  redFlagDetection?: boolean;
};

export type Listing = {
  address: string;
  price?: string;
  bedrooms?: number;
  link: string;
  ownerName?: string;
  type: 'rent' | 'sale';
};

function buildQueries(propertyType: 'rent' | 'sale' | 'both', zipCodes: string[]): string[] {
  const parts: Array<{ type: 'rent' | 'sale'; q: string }> = [];
  const types = propertyType === 'both' ? (['rent', 'sale'] as const) : [propertyType];
  for (const z of zipCodes) {
    for (const t of types) {
      const label = t === 'rent' ? 'For Rent By Owner' : 'For Sale By Owner';
      const q = `site:zillow.com ${label} ${z}`;
      parts.push({ type: t, q });
    }
  }
  return parts.map(p => p.q);
}

export async function scrapeZillowDuckDuckGo(input: ScrapeInput): Promise<Listing[]> {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36'
  );

  const queries = buildQueries(input.propertyType, input.zipCodes);
  const results: Listing[] = [];

  try {
    for (const q of queries) {
      await page.goto('https://duckduckgo.com/', { waitUntil: 'domcontentloaded' });
      await page.type('input[name="q"]', q, { delay: 10 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.keyboard.press('Enter'),
      ]);

      const links = await page.$$eval('a.result__a, a[data-testid="result-title-a"]', (as) =>
        as.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent || '' }))
      );

      for (const link of links) {
        if (!link.href.includes('zillow.com')) continue;
        // Quick metadata guess from text
        const text = link.text.toLowerCase();
        const isRent = text.includes('rent') || text.includes('for rent');
        const isSale = text.includes('sale') || text.includes('for sale');

        const type: 'rent' | 'sale' = isRent && !isSale ? 'rent' : 'sale';
        const listing: Listing = {
          address: link.text.trim() || 'Unknown address',
          link: link.href,
          type,
        };

        if (input.redFlagDetection) {
          const scan = scanRedFlags(link.text || '');
          if (scan.flagged) continue;
        }

        results.push(listing);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}


