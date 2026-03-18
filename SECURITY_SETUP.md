# Facebook Leads Scraper - Secure Setup

## 🔒 Security First

All sensitive data is now properly secured:
- ✅ **No hardcoded API keys**
- ✅ **Environment variables only**
- ✅ **Git protection with .gitignore**
- ✅ **GitHub Actions secrets**

## 🚀 Quick Setup

### 1. Local Development
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your API key
nano .env
```

### 2. GitHub Setup
```bash
# Initialize git
git init
git add .
git commit -m "🔥 Secure Facebook Leads Scraper"

# Add remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/facebook-leads.git
git branch -M main
git push -u origin main
```

### 3. GitHub Secrets
Go to your repository → Settings → Secrets and variables → Actions

Add:
- **Name:** `CAPSOLVER_API_KEY`
- **Secret:** `your_actual_api_key_here`

## 📁 File Structure
```
facebook-leads/
├── .env.example           # Environment template
├── .gitignore            # Protects sensitive files
├── .github/workflows/
│   └── scraper.yml       # GitHub Actions workflow
├── scraper-enhanced.js   # Main scraper (secure)
├── package.json
└── README.md
```

## 🔧 Environment Variables

### Required
```bash
CAPSOLVER_API_KEY=your_capsolver_api_key
```

### Optional
```bash
QUERY=custom_search_query
PAGES_TO_SCRAPE=3
HEADLESS=true
```

## 🛡️ Security Features

### 1. Code Protection
```javascript
// ❌ BAD - Hardcoded key
const API_KEY = "CAP-9DDFD95A...";

// ✅ GOOD - Environment variable
const API_KEY = process.env.CAPSOLVER_API_KEY;
```

### 2. Git Protection
`.gitignore` prevents:
- `.env` files from being committed
- API keys from being exposed
- Local secrets from leaking

### 3. GitHub Actions
Secrets are injected at runtime:
```yaml
env:
  CAPSOLVER_API_KEY: ${{ secrets.CAPSOLVER_API_KEY }}
```

## 🚨 Important Notes

### Never Commit
- `.env` files
- API keys
- Secrets
- Credentials

### Always Use
- Environment variables
- GitHub Secrets
- `.env.example` for documentation

## 🔄 GitHub Actions Workflow

The workflow now:
1. ✅ Uses secure secrets
2. ✅ Runs enhanced scraper
3. ✅ Commits `leads-enhanced.json`
4. ✅ Shows enhanced statistics
5. ✅ Protects all sensitive data

## 📊 Enhanced Output

```json
{
  "timestamp": "2026-03-18T11:00:00.000Z",
  "total_leads": 25,
  "enhanced_leads": 25,
  "leads": [
    {
      "title": "Solo Developer for AI Startup",
      "full_content": "Complete post content...",
      "enhanced": true
    }
  ]
}
```

## ✅ Security Checklist

- [ ] API key in `.env` only
- [ ] `.env` in `.gitignore`
- [ ] GitHub secrets configured
- [ ] No hardcoded keys in code
- [ ] Environment validation enabled

Your scraper is now **100% secure**! 🔒
