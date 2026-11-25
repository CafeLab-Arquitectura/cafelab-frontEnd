/**
 * Contrato de POST /api/v1/documents/autofill (servicio document-autofill-cafelab).
 * Son sugerencias: el lote no se crea hasta que el usuario guarda el formulario.
 */

export type AutofillFieldName =
  | 'lotName'
  | 'supplierName'
  | 'coffeeType'
  | 'origin'
  | 'processingMethod'
  | 'altitudeMeters'
  | 'initialWeight'
  | 'certifications';

export type AutofillWarningCode =
  | 'NOT_FOUND'
  | 'INVALID_VALUE'
  | 'INVALID_NUMBER'
  | 'UNKNOWN_CERTIFICATION'
  | 'LOW_CONFIDENCE';

export interface AutofillField<T> {
  /** null si no se encontró o no es válido. */
  value: T | null;
  /** null si no se encontró. */
  confidence: number | null;
}

export interface AutofillWarning {
  field: AutofillFieldName;
  code: AutofillWarningCode;
  message: string;
}

export interface DocumentAutofillResponse {
  extractionId: number | null;
  cached: boolean;
  fields: {
    lotName: AutofillField<string>;
    supplierName: AutofillField<string>;
    coffeeType: AutofillField<string>;
    origin: AutofillField<string>;
    processingMethod: AutofillField<string>;
    altitudeMeters: AutofillField<number>;
    initialWeight: AutofillField<number>;
    certifications: AutofillField<string[]>;
  };
  warnings: AutofillWarning[];
}
