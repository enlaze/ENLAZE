// Next's own test hook: avoid Google Fonts HTTP during the real page E2E.
module.exports = new Proxy({}, { get: () => '@font-face { font-family: Inter; src: url(disposable-font.woff2) format("woff2"); font-weight: 100 900; }' });
