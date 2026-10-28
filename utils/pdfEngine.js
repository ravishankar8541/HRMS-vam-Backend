// Compatibility adapter for the existing templates. Renders via PHP mPDF
// (utils/pdf.php) because Puppeteer's Chromium needs system libraries that
// shared hosting does not provide.
const { execFile } = require('child_process');
const path = require('path');

const PHP = process.env.PHP_EXECUTABLE_PATH || 'php';
const SCRIPT = path.join(__dirname, 'pdf.php');

let queue = Promise.resolve();

function render(html, options) {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT, JSON.stringify({ format: options.format || 'A4', border: options.border || null })];
    execFile(PHP, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        return reject(new Error(
          `PDF render failed (run "composer install" in the backend root on the server): ${error.message}`
        ));
      }
      resolve(stdout);
    }).stdin.end(html);
  });
}

exports.create = (html, options = {}) => ({
  toBuffer(callback) {
    const job = queue.then(() => render(html, options));
    queue = job.catch(() => {});
    job.then(buffer => callback(null, buffer), callback);
  },
});
