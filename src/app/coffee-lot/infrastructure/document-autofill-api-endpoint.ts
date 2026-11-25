import { Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SKIP_RETRY } from '../../shared/infrastructure/retry.interceptor';
import type { DocumentAutofillResponse } from './document-autofill.response';

/**
 * Envía la guía de remisión (JPG, PNG o PDF de 1 página) al servicio document-autofill
 * a través del API Gateway. El JWT lo agrega authInterceptor; el Gateway inyecta X-User-Id.
 */
@Injectable({
  providedIn: 'root',
})
export class DocumentAutofillApiEndpoint {
  private readonly endpointUrl = `${environment.serverBaseUrl}${environment.documentAutofillEndpointPath}`;

  constructor(private readonly http: HttpClient) {}

  autofill(file: File): Observable<DocumentAutofillResponse> {
    const body = new FormData();
    body.append('file', file, file.name);

    // Sin Content-Type: el navegador pone multipart/form-data con su boundary.
    // SKIP_RETRY: el servicio ya reintenta una vez contra Document AI; reintentar aquí
    // multiplicaría las llamadas (y el costo) y ocultaría el 502/504 al formulario.
    return this.http.post<DocumentAutofillResponse>(this.endpointUrl, body, {
      context: new HttpContext().set(SKIP_RETRY, true),
    });
  }
}
