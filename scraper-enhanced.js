import { chromium } from "playwright";
import fs from "fs";

const QUERY = `site:facebook.com/groups ("looking for" OR "need" OR "מחפש" OR "צריך") ("developer" OR "מפתח" OR "freelancer" OR "פרילנסר")`;
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY;
const GOOGLE_TIME_WINDOW = "y";
const MAX_POST_AGE_DAYS = 365;

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

  const ageRegexes = [
    /(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s*ago/,
    /לפני\s*(\d+)\s*(דקה|דקות|שעה|שעות|יום|ימים|שבוע|שבועות|חודש|חודשים|שנה|שנים)/
  ];

  let amount = null;
  let unit = null;
  for (const regex of ageRegexes) {
    const match = text.match(regex);
    if (match) {
      amount = Number(match[1]);
      unit = match[2];
      break;
    }
  }

  if (!amount || !unit) return null;

  const daysByUnit = {
    minute: 1 / 1440,
    minutes: 1 / 1440,
    "דקה": 1 / 1440,
    "דקות": 1 / 1440,
    hour: 1 / 24,
    hours: 1 / 24,
    "שעה": 1 / 24,
    "שעות": 1 / 24,
    day: 1,
    days: 1,
    "יום": 1,
    "ימים": 1,
    week: 7,
    weeks: 7,
    "שבוע": 7,
    "שבועות": 7,
    month: 30,
    months: 30,
    "חודש": 30,
    "חודשים": 30,
    year: 365,
    years: 365,
    "שנה": 365,
    "שנים": 365
  };

  const days = daysByUnit[unit];
  if (!days) return null;

  return new Date(now.getTime() - amount * days * 24 * 60 * 60 * 1000).toISOString();
}

// Solve captcha with Capsolver API
async function solveCaptchaWithCapsolver(siteKey, pageUrl) {
  try {
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
        break;
      }
    }

    return solution;
  } catch (error) {
    return null;
  }
}

// Extract more content and timestamp from Facebook post
async function extractFacebookContentAndTime(browser, url) {
  try {
    // Create new context for Facebook
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const fbPage = await context.newPage();
    
    await fbPage.goto(url, { waitUntil: "domcontentloaded" });
    await fbPage.waitForTimeout(5000);
    
    // Try multiple selectors for post content
    const contentSelectors = [
      '[data-ad-comet-preview="message"]',
      '[data-testid="message_content"]',
      '.x1yztbdb.x1n2xrhy.x1ja2u2z',
      '.x1iorvi4.x1k2q40k.x1lliihq',
      'div[role="article"] span',
      '.x1qjc9v5.x1oa3qoh',
      '[data-lexical-editor="true"]',
      '.x1lliihq.x6ikm8r.x10wlt62'
    ];
    
    let fullContent = null;
    
    // Try to find content with different selectors
    for (const selector of contentSelectors) {
      try {
        const elements = await fbPage.$$(selector);
        for (const element of elements) {
          const content = await element.innerText().catch(() => null);
          if (content && content.length > 100) {
            fullContent = content;
            break;
          }
        }
        if (fullContent) break;
      } catch (e) {
        continue;
      }
    }
    
    // Fallback: Get all text and find the longest meaningful block
    if (!fullContent) {
      const pageText = await fbPage.evaluate(() => {
        // Get all text elements
        const textElements = document.querySelectorAll('span, div, p');
        const texts = Array.from(textElements)
          .map(el => el.innerText)
          .filter(text => text && text.length > 50);
        return texts;
      });
      
      // Find the longest text that looks like a post
      const sortedTexts = pageText.sort((a, b) => b.length - a.length);
      fullContent = sortedTexts[0] || pageText.join('\n').substring(0, 1000);
    }

    // Extract post time (best-effort)
    const postTime = await fbPage.evaluate(() => {
      const toIso = (val) => {
        try {
          const d = new Date(val);
          if (!isNaN(d.getTime())) return d.toISOString();
        } catch (e) {}
        return null;
      };

      // 1) Meta tags
      const metaSelectors = [
        'meta[property="article:published_time"]',
        'meta[property="og:published_time"]',
        'meta[property="og:updated_time"]',
        'meta[name="publication_date"]'
      ];
      for (const sel of metaSelectors) {
        const el = document.querySelector(sel);
        const content = el?.getAttribute('content');
        const iso = content ? toIso(content) : null;
        if (iso) return { iso, source: sel };
      }

      // 2) time / abbr elements
      const timeEl = document.querySelector('time[datetime]');
      if (timeEl) {
        const iso = toIso(timeEl.getAttribute('datetime'));
        if (iso) return { iso, source: 'time[datetime]' };
      }

      const abbr = document.querySelector('abbr[data-utime]');
      if (abbr) {
        const utime = Number(abbr.getAttribute('data-utime'));
        if (!Number.isNaN(utime) && utime > 0) {
          return { iso: new Date(utime * 1000).toISOString(), source: 'abbr[data-utime]' };
        }
      }

      // 3) LD+JSON
      const ldJson = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map(s => s.textContent)
        .filter(Boolean);

      for (const block of ldJson) {
        try {
          const data = JSON.parse(block);
          const datePublished = data?.datePublished || data?.dateCreated || data?.uploadDate;
          const iso = datePublished ? toIso(datePublished) : null;
          if (iso) return { iso, source: 'ld+json' };
        } catch (e) {
          continue;
        }
      }

      return { iso: null, source: null };
    });
    
    await context.close();
    
    const content = fullContent && fullContent.length > 100
      ? fullContent.substring(0, 1000)
      : null;

    return {
      content,
      post_time: postTime?.iso || null,
      post_time_source: postTime?.source || null
    };
  } catch (error) {
    return {
      content: null,
      post_time: null,
      post_time_source: null
    };
  }
}

(async () => {
  // Check if environment variable is set
  if (!CAPSOLVER_API_KEY) {
    console.error("CAPSOLVER_API_KEY environment variable is required!");
    process.exit(1);
  }
  
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

  await page.goto(
    buildGoogleSearchUrl(),
    { waitUntil: "domcontentloaded" }
  );

  // Check for captcha
  const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
  
  if (captchaExists) {
    // Get site key
    const siteKey = await page.$eval('div[class*="recaptcha"]', el => 
      el.getAttribute('data-sitekey')
    ).catch(() => null);

    if (siteKey) {
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
      } else {
        await page.waitForTimeout(15000);
      }
    }
  }

  // Rest of scraping logic...
  await page.waitForTimeout(3000);

  let allResults = [];
  
  // Scrape multiple pages
  for (let pageNum = 0; pageNum < 3; pageNum++) {
    if (pageNum > 0) {
      // Navigate to next page
      const nextPageUrl = buildGoogleSearchUrl(pageNum * 10);
      await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
      
      // Check for captcha again
      const captchaExists = await page.$('iframe[title*="reCAPTCHA"], div[id*="captcha"], .g-recaptcha');
      if (captchaExists) {
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

    allResults = allResults.concat(results);
    
    // Small delay between pages
    await page.waitForTimeout(1000);
  }

  const leads = allResults.filter(r =>
    r?.snippet?.toLowerCase().match(
      /(looking for|need|מחפש|צריך|freelancer|developer|מפתח)/
    )
  );

  // Remove duplicates based on title
  const uniqueLeads = leads.filter((lead, index, self) =>
    index === self.findIndex((l) => (
      l.title === lead.title
    ))
  );

  // Extract more content for each lead
  const enhancedLeads = [];
  
  for (let i = 0; i < uniqueLeads.length; i++) {
    const lead = uniqueLeads[i];
    
    // Try to get more content and time from Facebook
    const extracted = await extractFacebookContentAndTime(browser, lead.link);
    
    const fallbackSnippet = lead.snippet || "";
    const content = extracted?.content || fallbackSnippet;

    const resolvedPostTime = extracted?.post_time || resolvePostTimeFromSnippet(lead.snippet);

    const enhancedLead = {
      ...lead,
      full_content: content || null,
      content_length: content ? content.length : 0,
      enhanced: !!extracted?.content,
      post_time: resolvedPostTime || null,
      post_time_source: extracted?.post_time
        ? (extracted?.post_time_source || "facebook")
        : (resolvedPostTime ? "google_snippet_relative_time" : null)
    };
    
    enhancedLeads.push(enhancedLead);
    
    // Small delay between requests
    await page.waitForTimeout(2000);
  }

  const sortedLeads = [...enhancedLeads].sort((a, b) => {
    const timeA = a.post_time ? Date.parse(a.post_time) : -Infinity;
    const timeB = b.post_time ? Date.parse(b.post_time) : -Infinity;
    return timeB - timeA;
  });

  const cutoffMs = Number.isFinite(MAX_POST_AGE_DAYS) && MAX_POST_AGE_DAYS > 0
    ? Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000
    : null;

  const freshLeads = cutoffMs
    ? sortedLeads.filter((lead) => {
        if (!lead.post_time) return true;
        const ts = Date.parse(lead.post_time);
        return Number.isFinite(ts) && ts >= cutoffMs;
      })
    : sortedLeads;

  // Add timestamp
  const finalLeads = {
    timestamp: new Date().toISOString(),
    total_leads: freshLeads.length,
    enhanced_leads: freshLeads.filter(l => l.enhanced).length,
    leads: freshLeads
  };

  // Output only JSON
  console.log(JSON.stringify(finalLeads));

  fs.writeFileSync("leads-enhanced.json", JSON.stringify(finalLeads, null, 2));

  await browser.close();
})();
