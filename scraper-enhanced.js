import fs from "fs";

const SEARCH_QUERIES = [
  {
    label: "🔥 חיפוש 1 — כוונה + כסף",
    terms: `site:facebook.com/groups ("base44" OR "lovable") ("מחפש" OR "צריך") ("תשלום" OR "אשלם" OR "פרילנסר" OR "תקציב")`
  },
  {
    label: "🔥 חיפוש 2 — כאב (הרבה יותר חזק)",
    terms: `site:facebook.com/groups ("base44" OR "lovable") ("לא עובד" OR "תקוע" OR "בעיה")`
  }
];
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const GOOGLE_TIME_WINDOW = "w";
const MAX_POST_AGE_DAYS = 7;
const INCLUDE_UNKNOWN_TIME = process.env.INCLUDE_UNKNOWN_TIME === "true";
const SEARCH_PROFILES = [
  { hl: "iw", lr: "lang_iw" },
  { hl: "iw" }
];

async function searchGoogleAPI(query, start = 1) {
  const params = new URLSearchParams({
    key: GOOGLE_API_KEY,
    cx: GOOGLE_CX,
    q: query,
    start: String(start),
    num: "10"
  });
  if (GOOGLE_TIME_WINDOW && GOOGLE_TIME_WINDOW !== "all") {
    params.set("dateRestrict", `${GOOGLE_TIME_WINDOW}1`);
  }

  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Google API error ${response.status}: ${err?.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return (data.items || []).map(item => ({
    title: item.title || "",
    link: item.link || "",
    snippet: item.snippet || ""
  }));
}

async function collectSearchResultsForQuery(searchQuery) {
  const aggregated = [];

  for (let pageNum = 0; pageNum < 3; pageNum++) {
    const start = pageNum * 10 + 1;
    const results = await searchGoogleAPI(searchQuery.terms, start);
    aggregated.push(
      ...results.map(result => ({
        ...result,
        query_label: searchQuery.label
      }))
    );
    if (results.length < 10) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return aggregated;
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
  const raw = `${lead?.title || ""}\n${lead?.snippet || ""}\n${lead?.full_content || ""}`;
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
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    console.error("GOOGLE_API_KEY and GOOGLE_CX environment variables are required!");
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

  const allResults = [];
  for (const searchQuery of SEARCH_QUERIES) {
    const queryResults = await collectSearchResultsForQuery(searchQuery);
    allResults.push(...queryResults);
  }

  const leads = allResults.filter((r) => {
    const text = `${r?.title || ""} ${r?.snippet || ""}`.toLowerCase();
    return /(מחפש|מחפשים|צריך|צריכה|דרוש|דרושה|מפתח|מתכנת|פרילנסר|אפליקציה|אתר|מערכת|אוטומציה|בוט|ai|developer|freelancer|lovable|base44)/.test(text);
  });

  // Remove duplicates based on link
  const uniqueLeads = leads.filter((lead, index, self) =>
    index === self.findIndex((l) => (
      l.link === lead.link
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

    const classification = classifyLead({
      ...lead,
      full_content: content || null
    });

    const enhancedLead = {
      ...lead,
      full_content: content || null,
      content_length: content ? content.length : 0,
      enhanced: !!extracted?.content,
      post_time: resolvedPostTime || null,
      post_time_source: extracted?.post_time
        ? (extracted?.post_time_source || "facebook")
        : (resolvedPostTime ? "google_snippet_relative_time" : null),
      classification: classification.classification,
      evidence_quote: classification.evidence_quote,
      reason_he: classification.reason_he,
      opportunity_type: classification.opportunity_type
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

  // Strict 24h mode by default: exclude leads with unknown timestamps.
  // Set INCLUDE_UNKNOWN_TIME=true to include unknown-timestamp leads.
  const freshLeads = cutoffMs
    ? sortedLeads.filter((lead) => {
        if (!lead.post_time) return INCLUDE_UNKNOWN_TIME;
        const ts = Date.parse(lead.post_time);
        return Number.isFinite(ts) && ts >= cutoffMs;
      })
    : sortedLeads;

  const finalFilteredLeads = freshLeads.filter((lead) => lead.classification !== "לא ליד");
  const unknownTimeCount = finalFilteredLeads.filter((lead) => !lead.post_time).length;
  const unknownTimeExcluded = sortedLeads.filter((lead) => !lead.post_time).length - unknownTimeCount;

  // Add timestamp
  const finalLeads = {
    timestamp: new Date().toISOString(),
    window: "7d",
    debug: {
      raw_results: allResults.length,
      keyword_filtered: leads.length,
      unique_links: uniqueLeads.length,
      enhanced_attempts: enhancedLeads.length,
      within_window_or_unknown: freshLeads.length,
      unknown_post_time: unknownTimeCount,
      unknown_post_time_excluded: unknownTimeExcluded,
      include_unknown_time: INCLUDE_UNKNOWN_TIME
    },
    total_leads: finalFilteredLeads.length,
    enhanced_leads: finalFilteredLeads.filter((l) => l.enhanced).length,
    search_groups: SEARCH_QUERIES.map((q) => ({
      label: q.label,
      query: q.terms
    })),
    leads: finalFilteredLeads,
    new_leads: finalFilteredLeads,
    raw_results: allResults.length,
    keyword_filtered: leads.length,
    unique_links: uniqueLeads.length,
    enhanced_attempts: enhancedLeads.length,
    raw_results_items: allResults,
    keyword_filtered_items: leads
  };

  // Output only JSON
  console.log(JSON.stringify(finalLeads));

  fs.writeFileSync("leads-enhanced.json", JSON.stringify(finalLeads, null, 2));

  await browser.close();
})();
