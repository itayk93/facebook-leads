import { chromium } from "playwright";
import fs from "fs";

const QUERY = `site:facebook.com/groups ("מחפש" OR "מחפשים" OR "צריך" OR "דרוש" OR "דרושה" OR "looking for" OR "need") ("מפתח" OR "מתכנת" OR "פרילנסר" OR "developer" OR "freelancer" OR "אפליקציה" OR "אתר" OR "מערכת" OR "app" OR "website" OR "automation" OR "אוטומציה" OR "AI" OR "lovable" OR "base44")`;
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || 'CAP-9DDFD95A16595961E363FC8E1104DB827D8C27DD662A255F0B0BA1570C01D023';
const GOOGLE_TIME_WINDOW = "w";
const MAX_POST_AGE_DAYS = 10;
const SEARCH_PROFILES = [
  { hl: "iw", lr: "lang_iw" },
  { hl: "iw" }
];

function buildGoogleSearchUrl(start = 0, profileIndex = 0) {
  const profile = SEARCH_PROFILES[profileIndex] || SEARCH_PROFILES[0];
  const tbsParts = ["sbd:1"];
  if (GOOGLE_TIME_WINDOW && GOOGLE_TIME_WINDOW !== "all") {
    tbsParts.unshift(`qdr:${GOOGLE_TIME_WINDOW}`);
  }

  const params = new URLSearchParams({
    q: QUERY,
    hl: profile.hl,
    tbs: tbsParts.join(","),
    start: String(start)
  });
  if (profile.lr) params.set("lr", profile.lr);

  return `https://www.google.com/search?${params.toString()}`;
}

async function assertGoogleNotBlocked(page) {
  const url = page.url();
  if (url.includes("google.com/sorry")) {
    throw new Error(`Google blocked this run with /sorry page: ${url}`);
  }

  const bodyText = await page.evaluate(() => (document.body?.innerText || "").toLowerCase());
  if (bodyText.includes("unusual traffic") || bodyText.includes("about this page")) {
    throw new Error("Google blocked this run due to unusual traffic.");
  }
}

async function navigateGoogleWithFallback(page, start = 0, preferredProfileIndex = 0) {
  const order = [preferredProfileIndex, ...SEARCH_PROFILES.keys()].filter(
    (idx, pos, arr) => arr.indexOf(idx) === pos
  );

  let lastError = null;
  for (const profileIndex of order) {
    const url = buildGoogleSearchUrl(start, profileIndex);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    try {
      await assertGoogleNotBlocked(page);
      return profileIndex;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Google blocked all configured search profiles.");
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

function inferOpportunityType(text) {
  if (/(שותף|שותפה|אחוזים|cofounder|equity)/.test(text)) return "שותפות / אחוזים";
  if (/(ייעוץ|יועץ|consult|ייעוץ בפרטי|audit)/.test(text)) return "ייעוץ";
  if (/(שדרוג|תחזוקה|תיקון|ייצוב|הטמעה|שיפור|שיפורים|מיגרציה)/.test(text)) return "תחזוקה / שדרוג";
  if (/(לבנות|בנייה|הקמה|מאפס|mvp|אפליקציה|אתר|מערכת|דשבורד|crm|backend|frontend|full.?stack)/.test(text)) {
    return "בנייה מאפס";
  }
  if (/(פרילנסר|פרילנס|מפתח|מתכנת|חברה|ספק|סטודיו|agency)/.test(text)) return "פרילנס / ספק";
  return "לא רלוונטי";
}

function pickEvidenceQuote(rawText) {
  const text = (rawText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const triggers = [
    "מחפש", "מחפשים", "צריך", "דרוש", "דרושה", "פרילנסר", "מפתח", "מתכנת", "בתשלום",
    "אשלם", "פרויקט", "הצעת מחיר", "זמינות", "עלויות", "לפנות בפרטי", "לפרודקשן", "NDA"
  ];

  const parts = text.split(/[\n.!?]+/).map((p) => p.trim()).filter(Boolean);
  const hit = parts.find((p) => triggers.some((t) => p.includes(t)));
  const quote = hit || parts[0] || "";
  return quote.slice(0, 180);
}

function classifyLead(lead) {
  const raw = `${lead?.title || ""}\n${lead?.snippet || ""}`;
  const text = raw.toLowerCase();

  const providerSelfPromo = /(for hire|available for freelance|מחפש עבודה|זמין לעבודה|מחפש משרה|אני פרילנסר|אני מציע|i offer)/.test(text);
  const explicitNeed = /(מחפש|מחפשים|צריך|צריכה|דרוש|דרושה|looking for|need|מי פנוי|לפנות בפרטי)/.test(text);
  const roleOrVendor = /(מפתח|מתכנת|פרילנסר|פרילנס|ספק|חברה|סטודיו|agency|developer|programmer|expert|מומחה|יועץ)/.test(text);
  const techScope = /(אפליקציה|אתר|מערכת|crm|dashboard|דשבורד|automation|אוטומציה|api|integration|אינטגרציה|backend|frontend|ui\/ux|ux|סליקה|הרשאות|multi.?tenant|agent|בוט|chatbot|ai)/.test(text);
  const executionIntent = /(לבנות|הקמה|פיתוח|לפתח|שדרוג|תיקון|תחזוקה|ייצוב|הטמעה|לחבר|לסיים|להרים|פרודקשן)/.test(text);
  const commercialHint = /(בתשלום|אשלם|תקציב|עלות|עלויות|שעות|הצעת מחיר|פרויקט|לקוח|nda|אחוזים|חצי משרה|pay|budget|quote|rates)/.test(text);

  const obviousNonTech = /(מנעול|הובלה|דירה|רכב|ב.מ.וו|מפתחות|שיפוצים|היכרויות)/.test(text);
  if (providerSelfPromo || (obviousNonTech && !techScope)) {
    return {
      classification: "לא ליד",
      evidence_quote: pickEvidenceQuote(raw),
      reason_he: providerSelfPromo
        ? "הפוסט נראה כהצעת שירות/חיפוש עבודה של הכותב ולא בקשת ביצוע בתשלום."
        : "הפוסט כולל מילות מפתח לא-טכנולוגיות ולכן אינו בקשת שירות טכנולוגי.",
      opportunity_type: "לא רלוונטי"
    };
  }

  let score = 0;
  if (explicitNeed) score += 2;
  if (roleOrVendor) score += 2;
  if (techScope) score += 2;
  if (executionIntent) score += 1;
  if (commercialHint) score += 2;

  let classification = "לא ליד";
  if (score >= 6 && (commercialHint || executionIntent)) classification = "חזק";
  else if (score >= 4 && (explicitNeed || roleOrVendor) && techScope) classification = "בינוני";
  else if (score >= 3 && (commercialHint || executionIntent || explicitNeed)) classification = "חלש";

  const reason = classification === "לא ליד"
    ? "לא נמצא חיפוש שירות טכנולוגי מספיק ברור או הקשר מסחרי אמיתי."
    : (classification === "חזק"
      ? "יש חיפוש ברור לביצוע עבודה טכנולוגית עם הקשר מסחרי/פרויקטלי."
      : classification === "בינוני"
        ? "יש בקשה ממשית לאיש מקצוע טכנולוגי אך בלי סימני תשלום חזקים."
        : "יש רמיזה מקצועית-מסחרית, אך הכוונה לרכישת שירות אינה חד-משמעית.");

  return {
    classification,
    evidence_quote: pickEvidenceQuote(raw),
    reason_he: reason,
    opportunity_type: classification === "לא ליד" ? "לא רלוונטי" : inferOpportunityType(text)
  };
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
  console.log("🚀 Starting Facebook Leads Scraper...");
  
  const browser = await chromium.launch({
    headless: true,
    slowMo: 50,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
  let activeProfileIndex = await navigateGoogleWithFallback(page, 0, 0);

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
      const nextPageUrl = buildGoogleSearchUrl(pageNum * 10, activeProfileIndex);
      console.log(`🔗 עובר לעמוד הבא: ${nextPageUrl}`);
      activeProfileIndex = await navigateGoogleWithFallback(page, pageNum * 10, activeProfileIndex);
      
      // Check for captcha again
      const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
      if (captchaExists) {
        console.log("🚨 Captcha בעמוד הבא, ממתין 10 שניות...");
        await page.waitForTimeout(10000);
      }
      
      await page.waitForTimeout(2000);
    }

    const results = await page.evaluate(() => {
      const seen = new Set();
      const items = [];
      const headings = Array.from(document.querySelectorAll("h3"));

      for (const h3 of headings) {
        const title = h3.innerText?.trim();
        const anchor = h3.closest("a");
        const link = anchor?.href || "";

        if (!title || !link || seen.has(link)) continue;

        const container = anchor.closest("div");
        const rawText = container?.innerText || "";
        const snippet = rawText.replace(/\s+/g, " ").trim().slice(0, 500);

        items.push({ title, link, snippet });
        seen.add(link);
      }

      return items.filter((r) => r.title && r.link);
    });

    console.log(`📦 עמוד ${pageNum + 1}: ${results.length} תוצאות`);
    allResults = allResults.concat(results);
    
    // Small delay between pages
    await page.waitForTimeout(1000);
  }

  console.log(`📦 סה"כ נמצאו ${allResults.length} תוצאות מ-3 עמודים\n`);

  const leads = allResults.filter((r) => {
    const text = `${r?.title || ""} ${r?.snippet || ""}`.toLowerCase();
    return /(מחפש|מחפשים|צריך|צריכה|דרוש|דרושה|מפתח|מתכנת|פרילנסר|אפליקציה|אתר|מערכת|אוטומציה|בוט|ai|developer|freelancer|lovable|base44)/.test(text);
  });

  console.log(`🔥 לידים: ${leads.length}\n`);

  // Remove duplicates based on title
  const uniqueLeads = leads.filter((lead, index, self) =>
    index === self.findIndex((l) => (
      l.title === lead.title
    ))
  );

  console.log(`🎯 לידים ייחודיים: ${uniqueLeads.length}\n`);

  const leadsSortedByNewest = uniqueLeads
    .map((lead) => ({
      ...lead,
      post_time: resolvePostTimeFromSnippet(lead.snippet),
      ...classifyLead(lead)
    }))
    .sort((a, b) => {
      const timeA = a.post_time ? Date.parse(a.post_time) : -Infinity;
      const timeB = b.post_time ? Date.parse(b.post_time) : -Infinity;
      return timeB - timeA;
    });

  const cutoffMs = Number.isFinite(MAX_POST_AGE_DAYS) && MAX_POST_AGE_DAYS > 0
    ? Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000
    : null;

  const freshLeads = cutoffMs
    ? leadsSortedByNewest.filter((lead) => {
        if (!lead.post_time) return true;
        const ts = Date.parse(lead.post_time);
        return Number.isFinite(ts) && ts >= cutoffMs;
      })
    : leadsSortedByNewest;

  const filteredLeads = freshLeads.filter((lead) => lead.classification !== "לא ליד");

  // Add timestamp
  const finalLeads = {
    timestamp: new Date().toISOString(),
    total_leads: filteredLeads.length,
    leads: filteredLeads
  };

  fs.writeFileSync("leads.json", JSON.stringify(finalLeads, null, 2));
  console.log("\n💾 נשמר ל-leads.json");

  await browser.close();
  console.log("✅ Scraping completed successfully!");
})();
