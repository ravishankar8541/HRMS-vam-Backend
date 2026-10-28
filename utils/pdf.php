<?php
// Renders HTML (stdin) to PDF (stdout) via mPDF. Invoked by utils/pdfEngine.js
// because Puppeteer's Chromium cannot run on shared hosting (missing system libs).
$options = json_decode($argv[1] ?? '{}', true);
if (!is_array($options)) $options = [];

require __DIR__ . '/../vendor/autoload.php';

$config = ['mode' => 'utf-8', 'format' => $options['format'] ?? 'A4'];
$margin = $options['border'] ?? null;
if (is_string($margin)) {
    $mm = (int) preg_replace('/[^0-9]/', '', $margin);
    foreach (['top', 'right', 'bottom', 'left'] as $side) $config['margin_' . $side] = $mm;
} elseif (is_array($margin)) {
    foreach (['top', 'right', 'bottom', 'left'] as $side) {
        if (isset($margin[$side])) $config['margin_' . $side] = (int) preg_replace('/[^0-9]/', '', (string) $margin[$side]);
    }
}

$mpdf = new \Mpdf\Mpdf($config);
$mpdf->WriteHTML(stream_get_contents(STDIN));
echo $mpdf->Output('', 'S');
