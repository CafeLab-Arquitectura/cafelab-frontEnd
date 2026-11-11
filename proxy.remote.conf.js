const target = 'https://includes-glasses-instruments-antonio.trycloudflare.com';

const forward = { target, secure: true, changeOrigin: true };

module.exports = {
  '/api': forward,
  '/users': forward,
  '/plans': forward,
  '/contact-us': forward,
};
