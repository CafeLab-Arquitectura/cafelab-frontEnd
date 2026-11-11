const target = 'http://141.148.45.231:8080';

const forward = { target, secure: false, changeOrigin: true };

module.exports = {
  '/api': forward,
  '/users': forward,
  '/plans': forward,
  '/contact-us': forward,
};
