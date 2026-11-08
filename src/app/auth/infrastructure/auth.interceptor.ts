import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenService } from './token.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenService = inject(TokenService);
  let token = tokenService.getToken();
  if (token?.startsWith('Bearer ')) {
    token = token.slice(7).trim() || null;
  }
  const isAuthEndpoint = req.url.includes('/api/v1/authentication/');
  const isProfileCreation = req.method === 'POST' && req.url.includes('/api/v1/profiles');

  let headers = req.headers;
  if (!headers.has('Content-Type') && !(req.body instanceof FormData)) {
    headers = headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) {
    headers = headers.set('Accept', 'application/json');
  }

  if (token && !isAuthEndpoint && !isProfileCreation) {
    headers = headers.set('Authorization', `Bearer ${token}`);
  }

  return next(req.clone({ headers }));
};
