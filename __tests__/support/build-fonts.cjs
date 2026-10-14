// Both Next bundlers can serialize this explicit Google Fonts test response.
// No font download: typography is outside this service-initialization check.
module.exports = {
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap':
    '@font-face { font-family: Inter; src: local(Arial); font-style: normal; font-weight: 100 900; }',
};
