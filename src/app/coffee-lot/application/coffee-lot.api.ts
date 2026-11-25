import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { CoffeeLotApiEndpoint } from '../infrastructure/coffee-lot-api-endpoint';
import type { CoffeeLot } from '../domain/model/coffee-lot.entity';
import { DocumentAutofillApiEndpoint } from '../infrastructure/document-autofill-api-endpoint';
import type { DocumentAutofillResponse } from '../infrastructure/document-autofill.response';

/**
 * Fachada del bounded context Coffee Lot (equivalente a {@code SupplierApi}).
 */
@Injectable({
  providedIn: 'root',
})
export class CoffeeLotApi {
  constructor(
    private readonly coffeeLotApiEndpoint: CoffeeLotApiEndpoint,
    private readonly documentAutofillApiEndpoint: DocumentAutofillApiEndpoint,
  ) {}

  /** Lee una guía de remisión y devuelve sugerencias para el formulario. No crea el lote. */
  autofillFromDocument(file: File): Observable<DocumentAutofillResponse> {
    return this.documentAutofillApiEndpoint.autofill(file);
  }

  getAll(): Observable<CoffeeLot[]> {
    return this.coffeeLotApiEndpoint.getAll();
  }

  getAvailable(): Observable<CoffeeLot[]> {
    return this.coffeeLotApiEndpoint.getAvailable();
  }

  consumeStock(
    lotId: number,
    quantityKg: number,
    options?: { finalProduct?: string; dateUsed?: string },
  ): Observable<CoffeeLot> {
    return this.coffeeLotApiEndpoint.consumeStock(lotId, quantityKg, options);
  }

  getById(id: number): Observable<CoffeeLot> {
    return this.coffeeLotApiEndpoint.getById(id);
  }


  searchLots(query: string): Observable<CoffeeLot[]> {
    const q = query.trim().toLowerCase();
    return this.getAll().pipe(
      map((rows) =>
        !q
          ? rows
          : rows.filter(
              (l) =>
                l.lot_name.toLowerCase().includes(q) ||
                l.coffee_type.toLowerCase().includes(q),
            ),
      ),
    );
  }

  create(entity: CoffeeLot): Observable<CoffeeLot> {
    return this.coffeeLotApiEndpoint.create(entity);
  }

  update(id: number, entity: CoffeeLot): Observable<CoffeeLot> {
    return this.coffeeLotApiEndpoint.update(entity, id);
  }

  delete(id: number): Observable<void> {
    return this.coffeeLotApiEndpoint.delete(id);
  }
}
