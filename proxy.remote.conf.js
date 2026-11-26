const target = 'https://spy-mins-communication-editions.trycloudflare.com';

const forward = { target, secure: true, changeOrigin: true };

module.exports = {
  '/api': forward,
  '/users': forward,
  '/plans': forward,
  '/contact-us': forward,
};
