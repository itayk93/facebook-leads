import { chromium } from "playwright";
import fs from "fs";

const QUERY = `site:facebook.com/groups ("looking for" OR "need" OR "מחפש" OR "צריך") ("developer" OR "מפתח" OR "freelancer" OR "פרילנסר")`;
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY;

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

// Extract more content from Facebook post
async function extractFacebookContent(browser, url) {
  try {
    console.log("🔗 מנסה לשלוף תוכן מלא מ:", url);
    
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
            console.log("✅ נמצא תוכן עם סלקטור:", selector);
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
    
    await context.close();
    
    if (fullContent && fullContent.length > 100) {
      console.log("✅ הצלחנו לשלוף תוכן מלא:", fullContent.length, "תווים");
      return fullContent.substring(0, 1000); // Limit to 1000 chars
    }
    
    return null;
  } catch (error) {
    console.log("❌ שגיאה בשליפת תוכן מפייסבוק:", error.message);
    return null;
  }
}

(async () => {
  console.log("🚀 Starting Enhanced Facebook Leads Scraper...");
  
  // Check if environment variable is set
  if (!CAPSOLVER_API_KEY) {
    console.error("❌ CAPSOLVER_API_KEY environment variable is required!");
    console.log("Please set it in your .env file or GitHub Actions secrets");
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

  console.log("🔎 מחפש בגוגל...");
  await page.goto(
    `https://www.google.com/search?q=${encodeURIComponent(QUERY)}&hl=en`,
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

  // Rest of scraping logic...
  await page.waitForTimeout(3000);

  let allResults = [];
  
  // Scrape multiple pages
  for (let pageNum = 0; pageNum < 3; pageNum++) {
    console.log(`📄 עובד על עמוד ${pageNum + 1}...`);
    
    if (pageNum > 0) {
      // Navigate to next page
      const nextPageUrl = `https://www.google.com/search?q=${encodeURIComponent(QUERY)}&hl=en&start=${pageNum * 10}`;
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

  console.log(`🔥 לידים: ${leads.length}\n`);

  // Remove duplicates based on title
  const uniqueLeads = leads.filter((lead, index, self) =>
    index === self.findIndex((l) => (
      l.title === lead.title
    ))
  );

  console.log(`🎯 לידים ייחודיים: ${uniqueLeads.length}\n`);

  // Extract more content for each lead
  const enhancedLeads = [];
  
  for (let i = 0; i < uniqueLeads.length; i++) {
    const lead = uniqueLeads[i];
    console.log(`🔍 משפר ליד ${i + 1}/${uniqueLeads.length}: ${lead.title.substring(0, 50)}...`);
    
    // Try to get more content from Facebook
    const fullContent = await extractFacebookContent(browser, lead.link);
    
    const enhancedLead = {
      ...lead,
      full_content: fullContent || lead.snippet,
      content_length: fullContent ? fullContent.length : lead.snippet.length,
      enhanced: !!fullContent
    };
    
    enhancedLeads.push(enhancedLead);
    
    // Small delay between requests
    await page.waitForTimeout(2000);
  }

  // Add timestamp
  const finalLeads = {
    timestamp: new Date().toISOString(),
    total_leads: enhancedLeads.length,
    enhanced_leads: enhancedLeads.filter(l => l.enhanced).length,
    leads: enhancedLeads
  };

  fs.writeFileSync("leads-enhanced.json", JSON.stringify(finalLeads, null, 2));
  console.log("\n💾 נשמר ל-leads-enhanced.json");

  // Show enhancement stats
  const enhancedCount = enhancedLeads.filter(l => l.enhanced).length;
  console.log(`📊 סטטיסטיקות שיפור: ${enhancedCount}/${enhancedLeads.length} לידים שופרו`);

  await browser.close();
  console.log("✅ Enhanced scraping completed successfully!");
})();
