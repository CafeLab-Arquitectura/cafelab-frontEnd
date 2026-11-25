const target = 'https://magnificent-floral-pregnant-feb.trycloudflare.com';

const forward = { target, secure: true, changeOrigin: true };

module.exports = {
  '/api': forward,
  '/users': forward,
  '/plans': forward,
  '/contact-us': forward,
};
