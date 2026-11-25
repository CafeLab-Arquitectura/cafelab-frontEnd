import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, retry, timer } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Marca una petición para que este interceptor no la reintente ni oculte su error.
 * Úsalo cuando el backend ya tiene su propia política de reintento (p. ej. document-autofill)
 * o cuando el componente necesita recibir el 5xx para mostrar su propio mensaje.
 */
export const SKIP_RETRY = new HttpContextToken<boolean>(() => false);

/**
 * Interceptor que reintenta automáticamente las peticiones HTTP que fallen
 * con errores de servidor (5xx), hasta MAX_RETRIES veces con un delay entre intentos.
 *
 * - Errores 5xx → se reintenta hasta MAX_RETRIES veces
 * - Si agotan los reintentos → toast global + retorna EMPTY (no rompe la UI)
 * - Errores 4xx → NO se reintenta, se propaga al componente normalmente
 */
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_RETRY)) {
    return next(req);
  }

  const snackBar = inject(MatSnackBar);

  return next(req).pipe(
    retry({
      count: MAX_RETRIES,
      delay: (error, retryCount) => {
        if (error instanceof HttpErrorResponse && error.status >= 500) {
          console.warn(
            `[RetryInterceptor] Intento ${retryCount}/${MAX_RETRIES} fallido con status ${error.status} — reintentando en ${RETRY_DELAY_MS}ms`,
            error.url,
          );
          return timer(RETRY_DELAY_MS);
        }
        throw error;
      },
    }),
    catchError((error) => {
      if (error instanceof HttpErrorResponse && error.status >= 500) {
        console.error(`[RetryInterceptor] Fallaron los ${MAX_RETRIES} intentos para`, error.url);
        snackBar.open(
          'No se pudo conectar con el servidor. Por favor, intenta nuevamente en unos momentos.',
          'Cerrar',
          { duration: 6000, panelClass: 'snackbar-error' },
        );
        return EMPTY;
      }
      throw error;
    }),
  );
};
