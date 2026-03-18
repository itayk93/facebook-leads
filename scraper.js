import { chromium } from "playwright";
import fs from "fs";

const QUERY = `site:facebook.com/groups ("looking for" OR "need" OR "מחפש" OR "צריך") ("developer" OR "מפתח" OR "freelancer" OR "פרילנסר")`;

// Solve captcha with Capsolver
async function solveCaptcha(page) {
  try {
    // Check if captcha exists
    const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
    if (!captchaExists) {
      return true;
    }

    // Get site key
    const siteKey = await page.$eval('div[class*="recaptcha"]', el => 
      el.getAttribute('data-sitekey') || el.getAttribute('data-sitekey')
    ).catch(() => null);

    if (!siteKey) {
      return false;
    }

    // Solve with Capsolver (you'll need to install their SDK or use API)
    // For now, let's wait for manual solve
    await page.waitForTimeout(15000);
    
    return true;
  } catch (error) {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  const page = await browser.newPage();
  
  // Hide automation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  await page.goto(
    `https://www.google.com/search?q=${encodeURIComponent(QUERY)}&hl=en`,
    { waitUntil: "domcontentloaded" }
  );

  // Handle captcha
  const captchaSolved = await solveCaptcha(page);
  if (!captchaSolved) {
    // Continue without captcha solve
  }

  // Debug - check page content
  const pageContent = await page.content();
  
  // Check what selectors exist
  const allDivs = await page.$$eval('div', divs => divs.length);
  
  // Try different selectors
  const searchResults = await page.$$eval('div[data-ved]', nodes => nodes.length);
  
  // קבלת תוצאות
  const results = await page.$$eval("div[data-ved]", nodes =>
    nodes.map(n => {
      const title = n.querySelector("h3")?.innerText;
      const link = n.querySelector("a")?.href;
      const snippet = n.querySelector("span")?.innerText;

      return { title, link, snippet };
    }).filter(r => r.title && r.link)
  );

  // סינון לידים אמיתיים
  const leads = results.filter(r =>
    r?.snippet?.toLowerCase().match(
      /(looking for|need|מחפש|צריך|freelancer|developer|מפתח)/
    )
  );

  // Output only JSON
  console.log(JSON.stringify(leads));

  // שמירה לקובץ
  fs.writeFileSync("leads.json", JSON.stringify(leads, null, 2));

  await browser.close();
})();
