import { chromium } from "playwright";
import fs from "fs";

const QUERY = `site:facebook.com/groups ("looking for" OR "need" OR "מחפש" OR "צריך") ("developer" OR "מפתח" OR "freelancer" OR "פרילנסר")`;

// Solve captcha with Capsolver
async function solveCaptcha(page) {
  try {
    console.log("🤖 מנסה לפתור captcha...");
    
    // Check if captcha exists
    const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
    if (!captchaExists) {
      console.log("✅ אין captcha");
      return true;
    }

    // Get site key
    const siteKey = await page.$eval('div[class*="recaptcha"]', el => 
      el.getAttribute('data-sitekey') || el.getAttribute('data-sitekey')
    ).catch(() => null);

    if (!siteKey) {
      console.log("❌ לא מצאתי site key");
      return false;
    }

    console.log("🔑 Site key:", siteKey);

    // Solve with Capsolver (you'll need to install their SDK or use API)
    // For now, let's wait for manual solve
    console.log("⏳ ממתין לפתרון captcha ידני (15 שניות)...");
    await page.waitForTimeout(15000);
    
    return true;
  } catch (error) {
    console.log("❌ שגיאה בפתרון captcha:", error.message);
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

  console.log("🔎 מחפש בגוגל...");
  await page.goto(
    `https://www.google.com/search?q=${encodeURIComponent(QUERY)}&hl=en`,
    { waitUntil: "domcontentloaded" }
  );

  // Handle captcha
  const captchaSolved = await solveCaptcha(page);
  if (!captchaSolved) {
    console.log("❌ לא הצלחנו לפתור את ה-captcha, מנסה להמשיך בלי בעיה...");
  }

  // Debug - check page content
  const pageContent = await page.content();
  console.log("Page loaded, length:", pageContent.length);
  
  // Check what selectors exist
  const allDivs = await page.$$eval('div', divs => divs.length);
  console.log("Total divs found:", allDivs);
  
  // Try different selectors
  const searchResults = await page.$$eval('div[data-ved]', nodes => nodes.length);
  console.log("Search results with data-ved:", searchResults);
  
  // קבלת תוצאות
  const results = await page.$$eval("div[data-ved]", nodes =>
    nodes.map(n => {
      const title = n.querySelector("h3")?.innerText;
      const link = n.querySelector("a")?.href;
      const snippet = n.querySelector("span")?.innerText;

      return { title, link, snippet };
    }).filter(r => r.title && r.link)
  );

  console.log(`📦 נמצאו ${results.length} תוצאות\n`);

  // סינון לידים אמיתיים
  const leads = results.filter(r =>
    r?.snippet?.toLowerCase().match(
      /(looking for|need|מחפש|צריך|freelancer|developer|מפתח)/
    )
  );

  console.log(`🔥 לידים: ${leads.length}\n`);

  leads.forEach((lead, i) => {
    console.log(`\n--- Lead ${i + 1} ---`);
    console.log("Title:", lead.title);
    console.log("Link:", lead.link);
    console.log("Snippet:", lead.snippet);
  });

  // שמירה לקובץ
  fs.writeFileSync("leads.json", JSON.stringify(leads, null, 2));
  console.log("\n💾 נשמר ל-leads.json");

  await browser.close();
})();
