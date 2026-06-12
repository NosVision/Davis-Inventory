/**
 * Job Processor
 * Puppeteer → PDF → SumatraPDF / Windows Print
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class JobProcessor {
  constructor(config) {
    this.config = config;
    this.printerName = config.PRINTER_NAME;
    this.paperWidth = config.PAPER_WIDTH || 80;
    this.tempDir = path.join(__dirname, '..', 'temp');
    this.browser = null;
    this.jobsToday = 0;
    this.lastResetDate = new Date().toDateString();

    // สร้าง temp folder
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Swap the active Windows printer at runtime. Called from the
   * heartbeat loop when store_settings.print_server_printer_name
   * changes in the web app, so the operator doesn't have to download
   * a new config.json after renaming the printer.
   */
  setPrinterName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name === this.printerName) return false;
    this.printerName = name;
    return true;
  }

  /**
   * Pre-launch Puppeteer browser (reuse across jobs)
   */
  async init() {
    const puppeteer = require('puppeteer');
    const executablePath = this._findBrowserExecutable();
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
      console.log(`  [*] Browser executable: ${executablePath}`);
    } else {
      console.log('  [*] Browser executable: Puppeteer managed browser');
    }

    this.browser = await puppeteer.launch(launchOptions);
    console.log('  [OK] Puppeteer browser launched');
  }

  /**
   * พิมพ์ job: HTML → PDF → Printer
   */
  async processJob(html, jobId, jobType) {
    // Reset daily counter
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.jobsToday = 0;
      this.lastResetDate = today;
    }

    const docType = jobType === 'receipt' ? 'ใบฝากเหล้า' : 'ใบแปะขวด';
    console.log(`  [*] ${docType} (${jobId.slice(0, 8)}...)`);

    const htmlFile = path.join(this.tempDir, `print_${jobId}.html`);
    const pdfFile = path.join(this.tempDir, `print_${jobId}.pdf`);

    try {
      // 1. Save HTML
      fs.writeFileSync(htmlFile, html, 'utf8');

      // 2. Render PDF via Puppeteer
      if (!this.browser || !this.browser.connected) {
        await this.init();
      }

      const page = await this.browser.newPage();
      const absolutePath = path.resolve(htmlFile).replace(/\\/g, '/');
      await page.goto(`file:///${absolutePath}`, { waitUntil: 'networkidle0', timeout: 15000 });

      // Label + Receipt both use same paper width (80mm thermal)
      // Height: auto for receipt (long), shorter for label
      const pdfOptions = {
        path: pdfFile,
        width: `${this.paperWidth}mm`,
        height: jobType === 'label' ? '120mm' : '297mm',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      };

      await page.pdf(pdfOptions);
      await page.close();
      console.log('  [2] PDF created');

      // 3. Print via SumatraPDF or Windows
      await this._sendToPrinter(pdfFile);
      this.jobsToday++;

      console.log(`  [OK] Printed! (total today: ${this.jobsToday})`);
    } finally {
      // Cleanup temp files
      setTimeout(() => {
        try { fs.unlinkSync(htmlFile); } catch {}
        try { fs.unlinkSync(pdfFile); } catch {}
      }, 5000);
    }
  }

  /**
   * ส่ง PDF ไปเครื่องพิมพ์
   */
  async _sendToPrinter(pdfPath) {
    const sumatra = this._findSumatraPDF();

    if (sumatra) {
      console.log('  [3] Printing via SumatraPDF');
      await this._execCommand(`"${sumatra}" -print-to "${this.printerName}" -silent "${pdfPath}"`);
    } else {
      console.log('  [3] Printing via Windows handler');
      const psCmd = `Start-Process -FilePath "${pdfPath}" -Verb Print -PassThru | ForEach-Object { Start-Sleep -Seconds 5; Stop-Process -Id $_.Id -ErrorAction SilentlyContinue }`;
      await this._execCommand(`powershell -Command "${psCmd}"`);
    }
  }

  /**
   * หา SumatraPDF
   */
  _findSumatraPDF() {
    const paths = [
      'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
      'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
      (process.env.LOCALAPPDATA || '') + '\\SumatraPDF\\SumatraPDF.exe',
    ];
    return paths.find((p) => p && fs.existsSync(p)) || null;
  }

  /**
   * Prefer an installed browser over Puppeteer's cache. The cache path is tied
   * to the Windows user that installed npm packages, so it often breaks after
   * copying this print server to another POS account.
   */
  _findBrowserExecutable() {
    const configured = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      this.config.CHROME_PATH,
      this.config.BROWSER_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ];

    return configured.find((p) => p && fs.existsSync(p)) || null;
  }

  /**
   * Execute command with timeout
   */
  _execCommand(cmd, timeout = 30000) {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout }, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  }

  /**
   * Cleanup browser
   */
  async shutdown() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  getJobsToday() {
    return this.jobsToday;
  }
}

module.exports = JobProcessor;
