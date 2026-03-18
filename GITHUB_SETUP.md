# Facebook Leads Scraper - GitHub Actions

## 🚀 Setup Instructions

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit - Facebook Leads Scraper"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/facebook-leads.git
git push -u origin main
```

### 2. Add GitHub Secrets
Go to your repository → Settings → Secrets and variables → Actions

Add these secrets:
- `CAPSOLVER_API_KEY`: Your Capsolver API key (`CAP-9DDFD95A16595961E363FC8E1104DB827D8C27DD662A255F0B0BA1570C01D023`)

### 3. Enable GitHub Actions
- Go to Actions tab in your repository
- Enable Actions if not already enabled

## 📋 What the Action Does

### Automatic Schedule
- **Runs every 2 hours** automatically
- **Manual trigger** available via Actions tab
- **Runs on push** to main/master branch

### Process
1. ✅ Sets up Node.js environment
2. ✅ Installs dependencies (Playwright)
3. ✅ Runs the scraper with anti-captcha protection
4. ✅ Filters and deduplicates leads
5. ✅ Commits results back to repository
6. ✅ Creates nice summary report

### Output Structure
```json
{
  "timestamp": "2024-03-18T09:30:00.000Z",
  "total_leads": 24,
  "leads": [
    {
      "title": "מחפש Solo Developer...",
      "link": "https://facebook.com/groups/...",
      "snippet": "מחפש Solo Developer..."
    }
  ]
}
```

## 🔧 Features

### Anti-Detection
- Linux User-Agent for GitHub environment
- Headless mode optimized for CI/CD
- Anti-automation detection
- Captcha solving with Capsolver

### Multi-Page Scraping
- Scrapes 3 pages per run
- Handles captchas between pages
- Removes duplicates automatically

### Smart Filtering
- Filters for relevant keywords
- Hebrew and English support
- Removes duplicate titles

## 📊 Monitoring

### GitHub Actions Dashboard
- View run history
- Check success/failure rates
- See lead counts over time

### Summary Reports
Each run creates a summary with:
- Total leads found
- Scraping timestamp
- Recent leads preview

## 🚨 Troubleshooting

### Common Issues
1. **Captcha detection** - Capsolver handles automatically
2. **Rate limiting** - Built-in delays prevent blocking
3. **Environment issues** - Uses optimized Linux settings

### Logs
Check Actions logs for detailed debugging information.

## 🔄 Customization

### Change Schedule
Edit `.github/workflows/scraper.yml`:
```yaml
schedule:
  - cron: '0 */2 * * *'  # Every 2 hours
```

### Modify Query
Edit `scraper-github.js`:
```javascript
const QUERY = `site:facebook.com/groups ("your" "keywords")`;
```

### Change Pages
Edit the loop in `scraper-github.js`:
```javascript
for (let pageNum = 0; pageNum < 5; pageNum++) { // 5 pages instead of 3
```

## 📈 Next Steps

1. **Set up monitoring** - Get notifications on new leads
2. **Add integrations** - Send leads to CRM/Slack
3. **Expand queries** - Add more keyword combinations
4. **Add analytics** - Track lead quality over time
