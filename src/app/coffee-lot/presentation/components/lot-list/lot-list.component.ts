import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { CoffeeLotApi } from '../../../application/coffee-lot.api';
import { CoffeeLot } from '../../../domain/model/coffee-lot.entity';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, finalize, of, Subscription } from 'rxjs';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../../auth/infrastructure/AuthService';
import { SupplierApi } from '../../../../supplier/application/supplier.api';
import { Supplier } from '../../../../supplier/domain/model/supplier.entity';
import type { ApiError } from '../../../../shared/infrastructure/base-api-endpoint';
import { getUserFacingApiMessage } from '../../../../shared/infrastructure/api-error-message';
import { InventoryApi } from '../../../../inventory/application/inventory.api';
import { BaseChartDirective } from 'ng2-charts';
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip
} from 'chart.js';

import { registerables } from 'chart.js';
import type {
  AutofillFieldName,
  DocumentAutofillResponse,
} from '../../../infrastructure/document-autofill.response';

/** Mismos límites que document-autofill-cafelab (se revalidan en el servicio). */
const AUTOFILL_MAX_BYTES = 10 * 1024 * 1024;
const AUTOFILL_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const AUTOFILL_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

/** Campo de la respuesta del autofill → clave del campo en el formulario de lote. */
const AUTOFILL_FORM_KEYS: Record<AutofillFieldName, string> = {
  lotName: 'lot_name',
  supplierName: 'supplier_id',
  coffeeType: 'coffee_type',
  origin: 'origin',
  processingMethod: 'processing_method',
  altitudeMeters: 'altitude',
  initialWeight: 'weight',
  certifications: 'certifications',
};

@Component({
  selector: 'app-lot-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterModule,BaseChartDirective],
  templateUrl: './lot-list.component.html',
  styleUrls: ['./lot-list.component.css'],
})
export class LotListComponent implements OnInit {
  @ViewChild('lotForm') lotForm!: NgForm;
  @ViewChild('editForm') editForm!: NgForm;

  lots: CoffeeLot[] = [];
  suppliers: Supplier[] = [];
  searchQuery = '';
  showRegisterModal = false;
  showEditModal = false;
  showLotDetails = false;
  showDeleteModal = false;
  loading = false;
  error: string | null = null;
  newCertification = '';

  fieldErrors: Record<string, string> = {};
  editFieldErrors: Record<string, string> = {};

  // ── Autocompletar desde guía de remisión (document-autofill) ──
  autofillLoading = false;
  autofillError: string | null = null;
  autofillNotice: string | null = null;
  /** Avisos por campo del formulario (clave = nombre del campo, p. ej. 'lot_name'). */
  autofillHints: Record<string, string[]> = {};
  /** Campos que se rellenaron desde la guía, para resaltarlos. */
  autofilledFields = new Set<string>();
  private autofillSubscription?: Subscription;

  readonly coffeeTypeCanonical = ['Arábica', 'Robusta', 'Mezcla'] as const;
  readonly processCanonical = [
    'Lavado',
    'Natural',
    'Honey',
    'Fermentación anaeróbica',
    'Maceración carbónica',
  ] as const;

  readonly statusCanonical = ['green', 'roasted'] as const;

  readonly certificationCanonical = [
    'FAIR_TRADE',
    'ORGANIC',
    'RAINFOREST',
  ] as const;

  coffeeTypeLabelKey(value: string): string {
    const m: Record<string, string> = {
      Arábica: 'COFFEE_LOT_BC.OPTIONS.COFFEE_TYPE.ARABICA',
      Robusta: 'COFFEE_LOT_BC.OPTIONS.COFFEE_TYPE.ROBUSTA',
      Mezcla: 'COFFEE_LOT_BC.OPTIONS.COFFEE_TYPE.BLEND',
    };

    return m[value] ?? value;
  }

  processLabelKey(value: string): string {
    const m: Record<string, string> = {
      Lavado: 'Lavado',
      Natural: 'Natural',
      Honey: 'Honey',
      'Fermentación anaeróbica': 'Fermentación anaeróbica',
      'Maceración carbónica': 'Maceración carbónica',
    };

    return m[value] ?? value;
  }

  statusLabelKey(value: string): string {
    const m: Record<string, string> = {
      green: 'FORM.STATUS_OPTIONS.GREEN',
      roasted: 'FORM.STATUS_OPTIONS.ROASTED',
    };

    return m[value] ?? value;
  }

  certificationLabelKey(value: string): string {
    const m: Record<string, string> = {
      FAIR_TRADE: 'COFFEE_LOT_BC.OPTIONS.CERTIFICATION.FAIR_TRADE',
      ORGANIC: 'COFFEE_LOT_BC.OPTIONS.CERTIFICATION.ORGANIC',
      RAINFOREST: 'COFFEE_LOT_BC.OPTIONS.CERTIFICATION.RAINFOREST',
      RAINFOREST_ALLIANCE: 'COFFEE_LOT_BC.OPTIONS.CERTIFICATION.RAINFOREST',
    };

    return m[value] ?? value;
  }

  private sanitizeCertifications(values: string[] | undefined): string[] {
    return (values ?? [])
      .filter((value) => value !== 'BIRD_FRIENDLY')
      .map((value) => (value === 'RAINFOREST_ALLIANCE' ? 'RAINFOREST' : value));
  }

  private sanitizeLot(lot: CoffeeLot): CoffeeLot {
    return {
      ...lot,
      certifications: this.sanitizeCertifications(lot.certifications),
    };
  }

  newLot: CoffeeLot = this.getEmptyLot();
  editingLot: CoffeeLot = this.getEmptyLot();
  selectedLot: CoffeeLot | null = null;
  lotToDelete: CoffeeLot | null = null;

  barChartOptions = {
    responsive: true,
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  showAnalyticsModal = false;

analyticsData: any[] = [];

barChartData = {
  labels: [] as string[],
  datasets: [
    {
      data: [] as number[],
      label: 'Kg Used',
    },
  ],
};

  constructor(
    private readonly coffeeLotApi: CoffeeLotApi,
    private readonly supplierApi: SupplierApi,
    private readonly translateService: TranslateService,
    private readonly authService: AuthService,
    private readonly inventoryApi: InventoryApi,
  ) {
    Chart.register(...registerables);
  }

  ngOnInit(): void {
    this.loadLots();
    this.loadSuppliers();
    
  }

  private getEmptyLot(): CoffeeLot {
    return {
      id: 0,
      lot_name: '',
      coffee_type: '',
      processing_method: '',
      altitude: 0,
      weight: 0,
      origin: '',
      certifications: [],
      supplier_id: 0,
      userId: 0,
      status: '',
    };
  }

  openRegisterModal(): void {
    this.error = null;
    this.fieldErrors = {};

    

    if (this.suppliers.length === 0) {
      this.error = this.translateService.instant('COFFEE_LOT_BC.HINT.NEED_SUPPLIER');
      return;
    }

    this.showRegisterModal = true;
  }

  loadSuppliers(): void {
    this.supplierApi
      .getAll()
      .pipe(
        catchError((err) => {
          console.error('Error loading suppliers', err);
          this.error = this.translateService.instant('COFFEE_LOT_BC.ERRORS.LOAD_SUPPLIERS');
          return of([]);
        }),
      )
      .subscribe((suppliers: Supplier[]) => {
        this.suppliers = suppliers;
      });

      console.log(this.suppliers);
    console.log(this.suppliers.length);
  }

  loadLots(): void {
    this.loading = true;
    this.error = null;

    this.coffeeLotApi
      .getAll()
      .pipe(
        catchError((err) => {
          console.error('Error loading lots', err);
          this.error = this.lotErrorMessage(err, 'COFFEE_LOT_BC.ERRORS.LOAD');
          return of([]);
        }),
        finalize(() => (this.loading = false)),
      )
      .subscribe((lots) => {
        this.lots = lots.map((lot) => this.sanitizeLot(lot));
      });
  }

  openAnalytics(): void {

    const userId = Number(this.authService.getCurrentUserId());
  
    this.inventoryApi
      .getAnalyticsByUser(userId)
      .subscribe((data) => {
  
        this.analyticsData = data;
  
        const monthLabels = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
  
        this.barChartData = {
          labels: monthLabels,
          datasets: data.map((lot: any) => ({
            label: lot.coffeeLotName,
            data: lot.monthlyUsage.map(
              (m: any) => m.quantityUsed
            ),
          })),
        };
  
        this.showAnalyticsModal = true;
      });
  }
  
  searchLots(): void {
    if (this.searchQuery.trim()) {
      this.loading = true;
      this.error = null;

      this.coffeeLotApi
        .searchLots(this.searchQuery)
        .pipe(
          catchError((err) => {
            console.error('Error searching lots', err);
            this.error = this.lotErrorMessage(err, 'COFFEE_LOT_BC.ERRORS.SEARCH');
            return of([]);
          }),
          finalize(() => (this.loading = false)),
        )
        .subscribe((lots) => (this.lots = lots.map((lot) => this.sanitizeLot(lot))));
    } else {
      this.loadLots();
    }
  }

  viewLotDetails(lot: CoffeeLot): void {
    this.selectedLot = this.sanitizeLot({ ...lot });
    this.showLotDetails = true;
    this.error = null;
  }

  closeLotDetails(): void {
    this.showLotDetails = false;
    this.selectedLot = null;
    this.error = null;
  }

  editLot(lot: CoffeeLot): void {
    console.log('EDIT CLICK', lot);

    this.editFieldErrors = {};
    this.editingLot = this.sanitizeLot({ ...lot });
    this.showEditModal = true;
    this.showLotDetails = false;
    this.error = null;
  }

  closeEditModal(): void {
    this.showEditModal = false;
    this.editFieldErrors = {};
    this.error = null;

    if (this.editForm) {
      this.editForm.resetForm();
    }
  }

  private collectRegisterFieldErrors(): Record<string, string> {
    const e: Record<string, string> = {};
    const t = (k: string) => this.translateService.instant(k);

    if (!this.newLot.lot_name?.trim()) {
      e['lot_name'] = t('COFFEE_LOT_BC.VALIDATION.LOT_NAME');
    }

    if (!this.newLot.coffee_type?.trim()) {
      e['coffee_type'] = t('COFFEE_LOT_BC.VALIDATION.COFFEE_TYPE');
    }

    if (!this.newLot.processing_method?.trim()) {
      e['processing_method'] = t('COFFEE_LOT_BC.VALIDATION.PROCESSING_METHOD');
    }

    const alt = Number(this.newLot.altitude);
    if (!Number.isFinite(alt) || alt <= 0) {
      e['altitude'] = t('COFFEE_LOT_BC.VALIDATION.ALTITUDE');
    }

    const w = Number(this.newLot.weight);
    if (!Number.isFinite(w) || w <= 0) {
      e['weight'] = t('COFFEE_LOT_BC.VALIDATION.WEIGHT');
    }

    if (!this.newLot.origin?.trim()) {
      e['origin'] = t('COFFEE_LOT_BC.VALIDATION.ORIGIN');
    }

    if (!this.newLot.status?.trim()) {
      e['status'] = t('COFFEE_LOT_BC.VALIDATION.STATUS');
    }

    const sid = Number(this.newLot.supplier_id);
    if (!sid || sid <= 0) {
      e['supplier_id'] = t('COFFEE_LOT_BC.VALIDATION.SUPPLIER');
    }

    if (this.suppliers.length === 0) {
      e['supplier_id'] = t('COFFEE_LOT_BC.VALIDATION.NO_SUPPLIERS');
    }

    return e;
  }

  private collectEditFieldErrors(): Record<string, string> {
    const e: Record<string, string> = {};
    const t = (k: string) => this.translateService.instant(k);

    if (!this.editingLot.lot_name?.trim()) {
      e['lot_name'] = t('COFFEE_LOT_BC.VALIDATION.LOT_NAME');
    }

    if (!this.editingLot.coffee_type?.trim()) {
      e['coffee_type'] = t('COFFEE_LOT_BC.VALIDATION.COFFEE_TYPE');
    }

    if (!this.editingLot.processing_method?.trim()) {
      e['processing_method'] = t('COFFEE_LOT_BC.VALIDATION.PROCESSING_METHOD');
    }

    const alt = Number(this.editingLot.altitude);
    if (!Number.isFinite(alt) || alt <= 0) {
      e['altitude'] = t('COFFEE_LOT_BC.VALIDATION.ALTITUDE');
    }

    const w = Number(this.editingLot.weight);
    if (!Number.isFinite(w) || w <= 0) {
      e['weight'] = t('COFFEE_LOT_BC.VALIDATION.WEIGHT');
    }

    if (!this.editingLot.origin?.trim()) {
      e['origin'] = t('COFFEE_LOT_BC.VALIDATION.ORIGIN');
    }

    if (!this.editingLot.status?.trim()) {
      e['status'] = t('COFFEE_LOT_BC.VALIDATION.STATUS');
    }

    return e;
  }

  registerLot(): void {
    if (this.autofillLoading) {
      return;
    }
    this.fieldErrors = {};

    const client = this.collectRegisterFieldErrors();
    if (Object.keys(client).length > 0) {
      this.fieldErrors = client;
      this.error = this.translateService.instant('COFFEE_LOT_BC.VALIDATION.SUMMARY');
      return;
    }

    this.loading = true;
    this.error = null;

    this.newLot.userId = Number(this.authService.getCurrentUserId());
    this.newLot.supplier_id = Number(this.newLot.supplier_id);
    this.newLot.altitude = Number(this.newLot.altitude);
    this.newLot.weight = Number(this.newLot.weight);
    this.newLot.certifications = this.sanitizeCertifications(this.newLot.certifications);

    this.coffeeLotApi
      .create(this.newLot)
      .pipe(
        catchError((err) => {
          console.error('Error creating lot', err);

          const api = err as ApiError;
          if (api.fieldErrors && Object.keys(api.fieldErrors).length > 0) {
            this.fieldErrors = { ...api.fieldErrors };
          }

          this.error = this.lotErrorMessage(err, 'COFFEE_LOT_BC.ERRORS.REGISTER');
          return of(null);
        }),
        finalize(() => (this.loading = false)),
      )
      .subscribe((result) => {
        if (result !== null) {
          this.showRegisterModal = false;
          this.resetForm();
          this.loadLots();
        }
      });
  }

  cancelRegister(): void {
    this.showRegisterModal = false;
    this.resetForm();
  }

  /**
   * Envía la guía elegida al servicio document-autofill y rellena el formulario con lo
   * que encuentre. No registra el lote: el usuario revisa y pulsa "Registrar".
   */
  onAutofillFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Permite volver a elegir el mismo archivo después.
    input.value = '';
    if (!file || this.autofillLoading) {
      return;
    }

    this.clearAutofillState();

    const t = (k: string, p?: Record<string, unknown>) => this.translateService.instant(k, p);
    const name = file.name.toLowerCase();
    const allowed =
      AUTOFILL_ALLOWED_TYPES.includes(file.type) ||
      AUTOFILL_ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
    if (!allowed) {
      this.autofillError = t('COFFEE_LOT_BC.AUTOFILL.INVALID_TYPE');
      return;
    }
    if (file.size > AUTOFILL_MAX_BYTES) {
      this.autofillError = t('COFFEE_LOT_BC.AUTOFILL.TOO_LARGE');
      return;
    }

    this.autofillLoading = true;
    this.autofillSubscription = this.coffeeLotApi
      .autofillFromDocument(file)
      .pipe(finalize(() => (this.autofillLoading = false)))
      .subscribe({
        next: (response) => this.applyAutofill(response, file.name),
        error: (err) => {
          console.error('Error reading document for autofill', err);
          this.autofillError = this.autofillErrorMessage(err);
        },
      });
  }

  private applyAutofill(response: DocumentAutofillResponse, fileName: string): void {
    const f = response.fields;
    const t = (k: string, p?: Record<string, unknown>) => this.translateService.instant(k, p);
    const filled = new Set<string>();

    const setText = (key: 'lot_name' | 'origin', value: string | null) => {
      if (value?.trim()) {
        this.newLot[key] = value.trim();
        filled.add(key);
      }
    };
    setText('lot_name', f.lotName.value);
    setText('origin', f.origin.value);

    if (f.coffeeType.value && this.coffeeTypeCanonical.some((v) => v === f.coffeeType.value)) {
      this.newLot.coffee_type = f.coffeeType.value;
      filled.add('coffee_type');
    }
    if (
      f.processingMethod.value &&
      this.processCanonical.some((v) => v === f.processingMethod.value)
    ) {
      this.newLot.processing_method = f.processingMethod.value;
      filled.add('processing_method');
    }
    if (typeof f.altitudeMeters.value === 'number') {
      this.newLot.altitude = f.altitudeMeters.value;
      filled.add('altitude');
    }
    if (typeof f.initialWeight.value === 'number') {
      this.newLot.weight = f.initialWeight.value;
      filled.add('weight');
    }

    const certifications = (f.certifications.value ?? []).filter((c) =>
      this.certificationCanonical.some((v) => v === c),
    );
    if (certifications.length > 0) {
      this.newLot.certifications = [...new Set([...this.newLot.certifications, ...certifications])];
      filled.add('certifications');
    }

    // supplierName es informativo: solo se preselecciona si coincide con un único proveedor.
    const supplierName = f.supplierName.value?.trim();
    if (supplierName) {
      const key = this.normalizeForMatch(supplierName);
      const matches = this.suppliers.filter((s) => this.normalizeForMatch(s.name) === key);
      if (matches.length === 1) {
        this.newLot.supplier_id = matches[0].id;
        filled.add('supplier_id');
        this.addAutofillHint(
          'supplier_id',
          t('COFFEE_LOT_BC.AUTOFILL.SUPPLIER_MATCHED', { name: matches[0].name }),
        );
      } else {
        this.addAutofillHint(
          'supplier_id',
          t('COFFEE_LOT_BC.AUTOFILL.SUPPLIER_HINT', { name: supplierName }),
        );
      }
    }

    for (const warning of response.warnings) {
      // Un campo no encontrado ya se nota vacío; las certificaciones son opcionales.
      if (warning.code === 'NOT_FOUND' || warning.field === 'supplierName') {
        continue;
      }
      this.addAutofillHint(AUTOFILL_FORM_KEYS[warning.field], warning.message);
    }

    this.autofilledFields = filled;
    for (const key of filled) {
      delete this.fieldErrors[key];
    }

    this.autofillNotice =
      filled.size > 0
        ? t('COFFEE_LOT_BC.AUTOFILL.DONE', { count: filled.size, file: fileName })
        : t('COFFEE_LOT_BC.AUTOFILL.NONE', { file: fileName });
  }

  private addAutofillHint(formKey: string, message: string): void {
    (this.autofillHints[formKey] ??= []).push(message);
  }

  private normalizeForMatch(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private autofillErrorMessage(err: unknown): string {
    const fallback = this.translateService.instant('COFFEE_LOT_BC.AUTOFILL.ERROR');
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return this.translateService.instant('COFFEE_LOT_BC.ERRORS.NETWORK');
      }
      if (err.status === 401 || err.status === 403) {
        return this.translateService.instant('COFFEE_LOT_BC.ERRORS.UNAUTHORIZED');
      }
      if (err.status === 404) {
        return fallback;
      }
    }
    // El servicio responde { "message": "..." } con textos ya pensados para el usuario.
    return getUserFacingApiMessage(err, fallback);
  }

  private clearAutofillState(): void {
    this.autofillError = null;
    this.autofillNotice = null;
    this.autofillHints = {};
    this.autofilledFields = new Set<string>();
  }

  saveLotChanges(): void {
    this.editFieldErrors = {};

    const client = this.collectEditFieldErrors();
    if (Object.keys(client).length > 0) {
      this.editFieldErrors = client;
      this.error = this.translateService.instant('COFFEE_LOT_BC.VALIDATION.SUMMARY');
      return;
    }

    if (!this.editingLot.id) {
      this.error = this.translateService.instant('COFFEE_LOT_BC.ERRORS.MISSING_ID');
      return;
    }

    this.loading = true;
    this.error = null;

    this.editingLot.userId = Number(this.authService.getCurrentUserId());
    this.editingLot.supplier_id = Number(this.editingLot.supplier_id);
    this.editingLot.altitude = Number(this.editingLot.altitude);
    this.editingLot.weight = Number(this.editingLot.weight);
    this.editingLot.certifications = this.sanitizeCertifications(this.editingLot.certifications);

    this.coffeeLotApi
      .update(this.editingLot.id, this.editingLot)
      .pipe(
        catchError((err) => {
          console.error('Error updating lot', err);

          const api = err as ApiError;
          if (api.fieldErrors && Object.keys(api.fieldErrors).length > 0) {
            this.editFieldErrors = { ...api.fieldErrors };
          }

          this.error = this.lotErrorMessage(err, 'COFFEE_LOT_BC.ERRORS.UPDATE');
          return of(null);
        }),
        finalize(() => (this.loading = false)),
      )
      .subscribe((result) => {
        if (result !== null) {
          this.showEditModal = false;
          this.editFieldErrors = {};
          this.loadLots();
        }
      });
  }

  onSupplierChange(event: Event): void {
    this.newLot.supplier_id = Number((event.target as HTMLSelectElement).value);
  }

  addCertification(value: string): void {
    if (
      value.trim() &&
      this.certificationCanonical.includes(value as (typeof this.certificationCanonical)[number]) &&
      !this.newLot.certifications.includes(value)
    ) {
      this.newLot.certifications.push(value);
      this.newCertification = '';
    }
  }

  addCertificationToEdit(value: string): void {
    if (
      value.trim() &&
      this.certificationCanonical.includes(value as (typeof this.certificationCanonical)[number]) &&
      !this.editingLot.certifications.includes(value)
    ) {
      this.editingLot.certifications.push(value);
      this.newCertification = '';
    }
  }

  removeCertification(index: number): void {
    this.newLot.certifications.splice(index, 1);
  }

  removeCertificationFromEdit(index: number): void {
    this.editingLot.certifications.splice(index, 1);
  }

  getSupplierName(id: number | undefined): string {
    if (!id) return '';

    const supplier = this.suppliers.find((s) => s.id === id);
    return supplier ? supplier.name : '';
  }

  getStatusText(status: string | undefined): string {
    if (!status) return '';
    return this.translateService.instant(this.statusLabelKey(status));
  }

  deleteLot(lot: CoffeeLot): void {
    if (!lot.id) {
      this.error = this.translateService.instant('COFFEE_LOT_BC.ERRORS.MISSING_ID');
      return;
    }

    this.lotToDelete = lot;
    this.showDeleteModal = true;
  }

  confirmDelete(): void {
    if (!this.lotToDelete?.id) {
      this.error = this.translateService.instant('COFFEE_LOT_BC.ERRORS.MISSING_ID');
      return;
    }

    this.loading = true;
    this.error = null;

    this.coffeeLotApi
      .delete(this.lotToDelete.id)
      .pipe(
        catchError((err) => {
          console.error('Error deleting lot', err);
          this.error = this.lotErrorMessage(err, 'COFFEE_LOT_BC.ERRORS.DELETE');
          return of(null);
        }),
        finalize(() => {
          this.loading = false;
          this.showDeleteModal = false;
          this.lotToDelete = null;
        }),
      )
      .subscribe((result) => {
        if (result !== null) {
          this.loadLots();
        }
      });
  }

  cancelDelete(): void {
    this.showDeleteModal = false;
    this.lotToDelete = null;
  }

  resetForm(): void {
    // Si se cierra el modal mientras se lee la guía, la respuesta ya no debe rellenar nada.
    this.autofillSubscription?.unsubscribe();
    this.autofillLoading = false;
    this.newLot = this.getEmptyLot();
    this.fieldErrors = {};
    this.newCertification = '';
    this.clearAutofillState();

    if (this.lotForm) {
      this.lotForm.resetForm();
    }

    this.error = null;
  }

  private lotErrorMessage(err: unknown, i18nKey: string): string {
    const fallback = this.translateService.instant(i18nKey);

    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return this.translateService.instant('COFFEE_LOT_BC.ERRORS.NETWORK');
      }

      if (err.status === 401 || err.status === 403) {
        return this.translateService.instant('COFFEE_LOT_BC.ERRORS.UNAUTHORIZED');
      }

      if (err.status === 404) {
        return this.translateService.instant('COFFEE_LOT_BC.ERRORS.NOT_FOUND');
      }
    }

    const fromApi = getUserFacingApiMessage(err, '');
    if (fromApi) {
      return fromApi;
    }

    return fallback || this.translateService.instant('COFFEE_LOT_BC.ERRORS.GENERIC');
  }
}
