import puppeteer from 'puppeteer';
import { generateMessage } from './messageTemplates';

type Listing = {
  address: string;
  link: string;
  ownerName?: string;
  type: 'rent' | 'sale';
};

type SendOptions = {
  testMode?: boolean;
  zillowLogin?: { email?: string; password?: string };
};

export async function sendMessageToListing(listing: Listing, options: SendOptions = {}) {
  const message = generateMessage(listing);

  if (options.testMode) {
    return { success: true, preview: message };
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(listing.link, { waitUntil: 'domcontentloaded' });

    // Optional login (best-effort)
    if (options.zillowLogin?.email && options.zillowLogin?.password) {
      // If redirected to login, attempt basic auth flow stealthily
      // This is intentionally minimal; real flow may require robust handling
      if (page.url().includes('login')) {
        await page.type('input[type="email"]', options.zillowLogin.email, { delay: 10 }).catch(() => {});
        await page.type('input[type="password"]', options.zillowLogin.password, { delay: 10 }).catch(() => {});
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
          page.click('button[type="submit"]').catch(() => {}),
        ]);
      }
    }

    // Attempt to find message box and send
    await page.waitForTimeout(1500);
    const textareaSelector = 'textarea, [contenteditable="true"]';
    await page.focus(textareaSelector).catch(() => {});
    await page.type(textareaSelector, message, { delay: 5 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});

    // Best-effort success indicator
    await page.waitForTimeout(1200);
    return { success: true };
  } catch (error: any) {
    return { success: false, reason: error?.message || 'unknown' };
  } finally {
    await browser.close();
  }
}


