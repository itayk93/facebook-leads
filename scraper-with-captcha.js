import { chromium } from "playwright";
import fs from "fs";

const QUERY = `site:facebook.com/groups ("looking for" OR "need" OR "מחפש" OR "צריך") ("developer" OR "מפתח" OR "freelancer" OR "פרילנסר")`;
const CAPSOLVER_API_KEY = 'CAP-9DDFD95A16595961E363FC8E1104DB827D8C27DD662A255F0B0BA1570C01D023';
const GOOGLE_TIME_WINDOW = "y";

function buildGoogleSearchUrl(start = 0) {
  const tbsParts = ["sbd:1"];
  if (GOOGLE_TIME_WINDOW && GOOGLE_TIME_WINDOW !== "all") {
    tbsParts.unshift(`qdr:${GOOGLE_TIME_WINDOW}`);
  }

  const params = new URLSearchParams({
    q: QUERY,
    hl: "en",
    tbs: tbsParts.join(","),
    start: String(start)
  });

  return `https://www.google.com/search?${params.toString()}`;
}

function resolvePostTimeFromSnippet(snippet) {
  if (!snippet || typeof snippet !== "string") return null;
  const text = snippet.toLowerCase();
  const now = new Date();
  const match = text.match(/(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s*ago/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  const daysByUnit = {
    minute: 1 / 1440,
    minutes: 1 / 1440,
    hour: 1 / 24,
    hours: 1 / 24,
    day: 1,
    days: 1,
    week: 7,
    weeks: 7,
    month: 30,
    months: 30,
    year: 365,
    years: 365
  };

  const days = daysByUnit[unit];
  if (!days || !amount) return null;
  return new Date(now.getTime() - amount * days * 24 * 60 * 60 * 1000).toISOString();
}

// Solve captcha with Capsolver API
async function solveCaptchaWithCapsolver(siteKey, pageUrl) {
  try {
    console.log("🤖 פותר captcha עם Capsolver...");
    
    const response = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CAPSOLVER_API_KEY}`
      },
      body: JSON.stringify({
        clientKey: CAPSOLVER_API_KEY,
        task: {
          type: "ReCaptchaV2TaskProxyless",
          websiteURL: pageUrl,
          websiteKey: siteKey
        }
      })
    });

    const taskData = await response.json();
    console.log("📝 Task created:", taskData.taskId);

    if (taskData.errorId !== 0) {
      throw new Error(taskData.errorDescription);
    }

    // Wait for solution
    let solution = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const resultResponse = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CAPSOLVER_API_KEY}`
        },
        body: JSON.stringify({
          clientKey: CAPSOLVER_API_KEY,
          taskId: taskData.taskId
        })
      });

      const result = await resultResponse.json();
      
      if (result.status === 'ready') {
        solution = result.solution.gRecaptchaResponse;
        console.log("✅ Captcha נפתר!");
        break;
      }
      
      console.log(`⏳ מחכה לפתרון... (${i + 1}/30)`);
    }

    return solution;
  } catch (error) {
    console.log("❌ שגיאה ב-Capsolver:", error.message);
    return null;
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    slowMo: 50,
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
    buildGoogleSearchUrl(),
    { waitUntil: "domcontentloaded" }
  );

  // Check for captcha
  const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
  
  if (captchaExists) {
    console.log("🚨 זוהה captcha!");
    
    // Get site key
    const siteKey = await page.$eval('div[class*="recaptcha"]', el => 
      el.getAttribute('data-sitekey')
    ).catch(() => null);

    if (siteKey) {
      console.log("🔑 Site key:", siteKey);
      
      // Solve with Capsolver
      const solution = await solveCaptchaWithCapsolver(siteKey, page.url());
      
      if (solution) {
        // Inject solution
        await page.evaluate((token) => {
          window.grecaptchaCallback = (token) => {
            console.log("Captcha solved with token:", token);
          };
          
          // Simulate callback
          if (window.grecaptchaCallback) {
            window.grecaptchaCallback(token);
          }
        }, solution);
        
        console.log("✅ Captaptcha נפתר אוטומטית!");
      } else {
        console.log("⏳ ממתין לפתרון ידני (15 שניות)...");
        await page.waitForTimeout(15000);
      }
    }
  } else {
    console.log("✅ אין captcha");
  }

  // Rest of the scraping logic...
  await page.waitForTimeout(3000);

  let allResults = [];
  
  // Scrape multiple pages
  for (let pageNum = 0; pageNum < 3; pageNum++) {
    console.log(`📄 עובד על עמוד ${pageNum + 1}...`);
    
    if (pageNum > 0) {
      // Navigate to next page
      const nextPageUrl = buildGoogleSearchUrl(pageNum * 10);
      console.log(`🔗 עובר לעמוד הבא: ${nextPageUrl}`);
      await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
      
      // Check for captcha again
      const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
      if (captchaExists) {
        console.log("🚨 Captcha בעמוד הבא, ממתין 10 שניות...");
        await page.waitForTimeout(10000);
      }
      
      await page.waitForTimeout(2000);
    }

    const results = await page.$$eval("div[data-ved]", nodes =>
      nodes.map(n => {
        const title = n.querySelector("h3")?.innerText;
        const link = n.querySelector("a")?.href;
        const snippet = n.querySelector("span")?.innerText;

        return { title, link, snippet };
      }).filter(r => r.title && r.link)
    );

    console.log(`📦 עמוד ${pageNum + 1}: ${results.length} תוצאות`);
    allResults = allResults.concat(results);
    
    // Small delay between pages
    await page.waitForTimeout(1000);
  }

  console.log(`📦 סה"כ נמצאו ${allResults.length} תוצאות מ-3 עמודים\n`);

  const leads = allResults.filter(r =>
    r?.snippet?.toLowerCase().match(
      /(looking for|need|מחפש|צריך|freelancer|developer|מפתח)/
    )
  );

  const sortedLeads = leads
    .map((lead) => ({
      ...lead,
      post_time: resolvePostTimeFromSnippet(lead.snippet)
    }))
    .sort((a, b) => {
      const timeA = a.post_time ? Date.parse(a.post_time) : -Infinity;
      const timeB = b.post_time ? Date.parse(b.post_time) : -Infinity;
      return timeB - timeA;
    });

  console.log(`🔥 לידים: ${sortedLeads.length}\n`);

  sortedLeads.forEach((lead, i) => {
    console.log(`\n--- Lead ${i + 1} ---`);
    console.log("Title:", lead.title);
    console.log("Link:", lead.link);
    console.log("Snippet:", lead.snippet);
  });

  fs.writeFileSync("leads.json", JSON.stringify(sortedLeads, null, 2));
  console.log("\n💾 נשמר ל-leads.json");

  await browser.close();
})();
