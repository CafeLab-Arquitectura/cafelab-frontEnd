import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatListModule } from '@angular/material/list';
import { MatToolbar } from '@angular/material/toolbar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { interval, startWith, Subscription, switchMap } from 'rxjs';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

import { AuthService } from '../../../../auth/infrastructure/AuthService';
import { ToolbarComponent } from '../../../../public/presentation/components/toolbar/toolbar.component';
import {
  CreateIoTMonitoringHistoryRequest,
  IoTMonitoringData,
  IoTMonitoringHistory,
  ThresholdRange,
  UpdateIoTMonitoringDataRequest,
} from '../../../domain/model/environmental-reading.entity';
import { IoTMonitoringService } from '../../../infrastructure/iot-monitoring.service';
import { ConfigureThresholdsDialogComponent } from '../../components/configure-thresholds-dialog/configure-thresholds-dialog.component';
import { CoffeeLotSummary } from '../../../domain/model/coffee-lot-summary.model';

type IotSection = 'lots' | 'configuration' | 'alerts' | 'analytics';
const REALTIME_REFRESH_MS = 5_000;

// Register only the Chart.js components we need (tree-shakeable)
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

@Component({
  selector: 'app-iot-monitoring-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatDialogModule,
    MatListModule,
    MatToolbar,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    ToolbarComponent,
    TranslateModule,
  ],
  templateUrl: './iot-monitoring-dashboard.component.html',
  styleUrls: ['./iot-monitoring-dashboard.component.css', '../iot-monitoring-breadcrumb-shell.css'],
})
export class IotMonitoringDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('historyChart') chartCanvasRef!: ElementRef<HTMLCanvasElement>;
  private historyChart: Chart | null = null;
  private realtimeSubscription?: Subscription;

  monitoringData: IoTMonitoringData = {
    id: 0,
    sensorConnected: true,
    dehumidifierConnected: true,
    minTemperature: 18,
    maxTemperature: 24,
    minHumidity: 50,
    maxHumidity: 65,
    userId: 0,
  };

  thresholds: ThresholdRange = {
    minTemperature: 18,
    maxTemperature: 24,
    minHumidity: 50,
    maxHumidity: 65,
  };

  currentReading: IoTMonitoringHistory | null = null;
  readingHistory: IoTMonitoringHistory[] = [];
  activeAlerts: string[] = [];
  sensorStatus = '';
  environmentalStatus = '';
  dehumidifierStatus = '';
  lastUpdate: Date = new Date();

  isLoading = false;
  isSavingManualReading = false;
  private chartReady = false;
  activeSection: IotSection = 'lots';

  readonly moduleOptions: { id: IotSection; titleKey: string; descriptionKey: string }[] = [
    {
      id: 'lots',
      titleKey: 'IOT.SECTIONS.LOTS.TITLE',
      descriptionKey: 'IOT.SECTIONS.LOTS.DESCRIPTION',
    },
    {
      id: 'configuration',
      titleKey: 'IOT.SECTIONS.CONFIGURATION.TITLE',
      descriptionKey: 'IOT.SECTIONS.CONFIGURATION.DESCRIPTION',
    },
    {
      id: 'alerts',
      titleKey: 'IOT.SECTIONS.ALERTS.TITLE',
      descriptionKey: 'IOT.SECTIONS.ALERTS.DESCRIPTION',
    },
    {
      id: 'analytics',
      titleKey: 'IOT.SECTIONS.ANALYTICS.TITLE',
      descriptionKey: 'IOT.SECTIONS.ANALYTICS.DESCRIPTION',
    },
  ];

  coffeeLots: CoffeeLotSummary[] = [];
  selectedLotId: number | null = null;
  readonly manualReadingForm;

  constructor(
    private readonly fb: FormBuilder,
    private readonly dialog: MatDialog,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly iotService: IoTMonitoringService,
    private readonly snackBar: MatSnackBar,
    private readonly translate: TranslateService,
  ) {
    this.manualReadingForm = this.fb.group({
      temperature: [20, [Validators.required, Validators.min(0), Validators.max(40)]],
      humidity: [60, [Validators.required, Validators.min(0), Validators.max(100)]],
      connectionState: [true, [Validators.required]],
      timestamp: [this.toDatetimeLocalValue(new Date()), [Validators.required]],
    });
  }

  ngOnInit(): void {
    this.loadMonitoringConfig();
    this.loadCoffeeLots();
  }

  ngAfterViewInit(): void {
    this.chartReady = true;
    // If data already arrived before view was ready, paint now
    if (this.readingHistory.length > 0) {
      setTimeout(() => this.renderChart(), 0);
    }
  }

  ngOnDestroy(): void {
    this.realtimeSubscription?.unsubscribe();
    this.historyChart?.destroy();
  }

  // ─── Status getters ────────────────────────────────────────────────────────

  get environmentStatusKey(): string {
    if (this.environmentalStatus) return this.environmentalStatus;
    if (!this.currentReading) return 'IOT.DASHBOARD.STATUS_OPTIMAL';
    const isTempOk =
      this.currentReading.temperature >= this.thresholds.minTemperature &&
      this.currentReading.temperature <= this.thresholds.maxTemperature;
    const isHumidityOk =
      this.currentReading.humidity >= this.thresholds.minHumidity &&
      this.currentReading.humidity <= this.thresholds.maxHumidity;
    return isTempOk && isHumidityOk ? 'IOT.DASHBOARD.STATUS_OPTIMAL' : 'IOT.DASHBOARD.STATUS_WARNING';
  }

  get isEnvironmentOptimal(): boolean {
    return (
      this.environmentalStatus === 'OPTIMAL' ||
      this.environmentStatusKey === 'IOT.DASHBOARD.STATUS_OPTIMAL'
    );
  }

  get dehumidifierStatusKey(): string {
    if (this.dehumidifierStatus) return this.dehumidifierStatus;
    if (!this.currentReading) return 'IOT.DASHBOARD.DEHUMIDIFIER_OFF';
    return this.currentReading.humidity > this.thresholds.maxHumidity &&
      this.monitoringData.dehumidifierConnected
      ? 'IOT.DASHBOARD.DEHUMIDIFIER_ON'
      : 'IOT.DASHBOARD.DEHUMIDIFIER_OFF';
  }

  // ─── Data loading ──────────────────────────────────────────────────────────

  private loadMonitoringConfig(): void {
    this.iotService.getData().subscribe({
      next: (data) => {
        this.monitoringData = data;
        this.thresholds = {
          minTemperature: data.minTemperature,
          maxTemperature: data.maxTemperature,
          minHumidity: data.minHumidity,
          maxHumidity: data.maxHumidity,
        };
      },
      error: (err) => {
        console.error('[IoT Dashboard] Error loading monitoring config:', err);
        this.showSnackBar('IOT.MESSAGES.CONFIG_LOAD_ERROR', 'IOT.MESSAGES.CLOSE');
      },
    });
  }

  saveManualReading(): void {
    if (!this.selectedLotId) {
      this.showSnackBar('IOT.MANUAL.NO_LOT_SELECTED', 'IOT.MESSAGES.CLOSE');
      return;
    }

    if (this.manualReadingForm.invalid) {
      this.manualReadingForm.markAllAsTouched();
      return;
    }

    const raw = this.manualReadingForm.getRawValue();
    const payload: CreateIoTMonitoringHistoryRequest = {
      connectionState: raw.connectionState === true,
      temperature: Number(raw.temperature),
      humidity: Number(raw.humidity),
      timestamp: new Date(String(raw.timestamp)).toISOString(),
      batchId: this.selectedLotId,
    };

    this.isSavingManualReading = true;
    this.iotService.createManualHistory(payload).subscribe({
      next: () => {
        this.isSavingManualReading = false;
        this.showSnackBar('IOT.MANUAL.SAVE_SUCCESS', 'IOT.MESSAGES.OK', 3000);
        this.manualReadingForm.patchValue({ timestamp: this.toDatetimeLocalValue(new Date()) });
        this.refreshSelectedLotHistory();
      },
      error: (err) => {
        console.error('[IoT Manual Reading] Error saving reading:', err);
        this.isSavingManualReading = false;
        this.showSnackBar('IOT.MANUAL.SAVE_ERROR', 'IOT.MESSAGES.CLOSE');
      },
    });
  }

  // ─── Configure dialog ──────────────────────────────────────────────────────

  openConfigureRanges(): void {
    const dialogRef = this.dialog.open(ConfigureThresholdsDialogComponent, {
      width: '520px',
      data: this.thresholds,
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((result?: ThresholdRange) => {
      if (!result) return;

      const payload: UpdateIoTMonitoringDataRequest = {
        sensorConnected: this.monitoringData.sensorConnected,
        dehumidifierConnected: this.monitoringData.dehumidifierConnected,
        minTemperature: result.minTemperature,
        maxTemperature: result.maxTemperature,
        minHumidity: result.minHumidity,
        maxHumidity: result.maxHumidity,
      };

      this.iotService.updateData(this.monitoringData.id, payload).subscribe({
        next: (updated) => {
          this.monitoringData = updated;
          this.thresholds = { ...result };
          this.showSnackBar('IOT.MESSAGES.CONFIG_UPDATE_SUCCESS', 'IOT.MESSAGES.OK', 3000);
          if (this.selectedLotId) {
            this.refreshSelectedLotHistory();
          }
        },
        error: (err) => {
          console.error('[IoT Config] Error updating thresholds:', err);
          this.showSnackBar('IOT.MESSAGES.CONFIG_UPDATE_ERROR', 'IOT.MESSAGES.CLOSE');
        },
      });
    });
  }

  // ─── Chart ─────────────────────────────────────────────────────────────────

  private renderChart(): void {
    if (!this.chartCanvasRef) return;

    // Readings arrive newest-first from backend; reverse to show oldest → newest left-to-right
    const ordered = this.getChronologicalHistory();
    const labels = ordered.map((_, index) => `#${index + 1}`);
    const temps = ordered.map((r) => r.temperature);
    const humids = ordered.map((r) => r.humidity);

    if (this.historyChart) {
      // Update existing chart data in-place (smoother than destroy/recreate)
      this.historyChart.data.labels = labels;
      this.historyChart.data.datasets[0].data = temps;
      this.historyChart.data.datasets[1].data = humids;
      this.historyChart.update('active');
      return;
    }

    this.historyChart = new Chart(this.chartCanvasRef.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Temperatura (°C)',
            data: temps,
            borderColor: '#c06040',
            backgroundColor: 'rgba(192, 96, 64, 0.08)',
            pointBackgroundColor: '#c06040',
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.35,
            fill: true,
            yAxisID: 'yTemp',
          },
          {
            label: 'Humedad (%)',
            data: humids,
            borderColor: '#5c8d89',
            backgroundColor: 'rgba(92, 141, 137, 0.10)',
            pointBackgroundColor: '#5c8d89',
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.35,
            fill: true,
            yAxisID: 'yHumid',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { font: { size: 12, family: 'Inter, sans-serif' }, padding: 16 },
          },
          tooltip: {
            backgroundColor: '#2d3a36',
            titleFont: { size: 12 },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 6,
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, maxRotation: 45, color: '#45615a' },
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: '°C', color: '#c06040', font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { color: '#c06040', font: { size: 11 } },
          },
          yHumid: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: '%', color: '#5c8d89', font: { size: 11 } },
            grid: { drawOnChartArea: false },
            ticks: { color: '#5c8d89', font: { size: 11 } },
          },
        },
      },
    });
  }

  // ─── Lot selection ─────────────────────────────────────────────────────────

  getSelectedLotName(): string {
    if (!this.selectedLotId) return '';
    const lot = this.coffeeLots.find((l) => l.id === this.selectedLotId);
    return lot
      ? lot.lotName
      : this.translate.instant('IOT.LOTS.FALLBACK', { id: this.selectedLotId });
  }

  getChronologicalHistory(): IoTMonitoringHistory[] {
    return [...this.readingHistory].reverse();
  }

  get selectedLot(): CoffeeLotSummary | null {
    if (!this.selectedLotId) return null;
    return this.coffeeLots.find((lot) => lot.id === this.selectedLotId) ?? null;
  }

  get selectedLotLabel(): string {
    const lot = this.selectedLot;
    if (!lot) return this.getSelectedLotName();
    return lot.coffeeType ? `${lot.lotName}: ${lot.coffeeType}` : lot.lotName;
  }

  get selectedLotMeta(): string {
    const lot = this.selectedLot;
    if (!lot) return '';

    const parts: string[] = [];
    if (lot.status) {
      parts.push(this.translate.instant('IOT.ANALYTICS.STATUS_META', { status: lot.status }));
    }
    if (lot.weight && lot.weight > 0) {
      parts.push(this.translate.instant('IOT.ANALYTICS.WEIGHT_META', { weight: lot.weight }));
    }
    if (lot.origin) {
      parts.push(this.translate.instant('IOT.ANALYTICS.ORIGIN_META', { origin: lot.origin }));
    }

    return parts.join(' - ');
  }

  get averageTemperature(): number | null {
    return this.average(this.readingHistory.map((reading) => reading.temperature));
  }

  get averageHumidity(): number | null {
    return this.average(this.readingHistory.map((reading) => reading.humidity));
  }

  get environmentalHealthScore(): number | null {
    if (this.readingHistory.length === 0) return null;
    const healthyReadings = this.readingHistory.filter((reading) => {
      const tempOk =
        reading.temperature >= this.thresholds.minTemperature &&
        reading.temperature <= this.thresholds.maxTemperature;
      const humidityOk =
        reading.humidity >= this.thresholds.minHumidity &&
        reading.humidity <= this.thresholds.maxHumidity;
      return tempOk && humidityOk;
    }).length;

    return Math.round((healthyReadings / this.readingHistory.length) * 100);
  }

  get environmentalStabilityKey(): string {
    const score = this.environmentalHealthScore;
    if (score === null) return 'IOT.ANALYTICS.NO_DATA';
    if (score >= 90) return 'IOT.ANALYTICS.STABILITY_OPTIMAL';
    if (score >= 75) return 'IOT.ANALYTICS.STABILITY_STABLE';
    return 'IOT.ANALYTICS.STABILITY_AT_RISK';
  }

  get environmentalGradeKey(): string {
    const score = this.environmentalHealthScore;
    if (score === null) return 'IOT.ANALYTICS.NO_BASELINE';
    if (score >= 90) return 'IOT.ANALYTICS.GRADE_A';
    if (score >= 75) return 'IOT.ANALYTICS.GRADE_B';
    return 'IOT.ANALYTICS.GRADE_C';
  }

  get averageTemperatureStatusKey(): string {
    const average = this.averageTemperature;
    if (average === null) return 'IOT.ANALYTICS.NO_DATA';
    return average >= this.thresholds.minTemperature && average <= this.thresholds.maxTemperature
      ? 'IOT.ANALYTICS.IN_RANGE'
      : 'IOT.ANALYTICS.OUT_OF_RANGE';
  }

  get averageHumidityStatusKey(): string {
    const average = this.averageHumidity;
    if (average === null) return 'IOT.ANALYTICS.NO_DATA';
    return average >= this.thresholds.minHumidity && average <= this.thresholds.maxHumidity
      ? 'IOT.ANALYTICS.IN_RANGE'
      : 'IOT.ANALYTICS.OUT_OF_RANGE';
  }

  selectSection(section: IotSection): void {
    this.activeSection = section;
    if (section === 'analytics' && this.readingHistory.length > 0) {
      setTimeout(() => this.renderChart(), 0);
    }
  }

  loadCoffeeLots(): void {
    this.iotService.getCoffeeLots().subscribe({
      next: (lots: CoffeeLotSummary[]) => {
        this.coffeeLots = lots;
        if (lots.length === 0) {
          this.selectedLotId = null;
          this.currentReading = null;
          this.readingHistory = [];
          this.activeAlerts = [];
          return;
        }

        const rawLotId = this.route.snapshot.queryParamMap.get('lotId');
        const requestedLotId = rawLotId ? Number(rawLotId) : null;
        const requestedLot =
          requestedLotId && Number.isFinite(requestedLotId)
            ? lots.find((lot) => lot.id === requestedLotId)
            : undefined;

        this.selectedLotId = requestedLot?.id ?? lots[0].id;
        this.startRealtimeHistory(this.selectedLotId);
      },
      error: (err) => {
        console.error('[IoT Dashboard] Error loading coffee lots:', err);
      },
    });
  }

  onLotChange(): void {
    if (this.selectedLotId) {
      this.startRealtimeHistory(this.selectedLotId);
    }
  }

  private average(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private startRealtimeHistory(batchId: number): void {
    this.realtimeSubscription?.unsubscribe();
    this.isLoading = this.readingHistory.length === 0;
    this.realtimeSubscription = interval(REALTIME_REFRESH_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.iotService.getHistoriesByBatch(batchId)),
      )
      .subscribe({
        next: (histories: IoTMonitoringHistory[]) => {
          this.applyBatchHistory(histories);
          this.isLoading = false;
        },
        error: (err) => {
          console.error('[IoT Dashboard] Error loading realtime batch history:', err);
          this.isLoading = false;
          this.showSnackBar('IOT.MESSAGES.HISTORY_LOAD_ERROR', 'IOT.MESSAGES.CLOSE');
        },
      });
  }

  private refreshSelectedLotHistory(): void {
    if (!this.selectedLotId) return;
    this.iotService.getHistoriesByBatch(this.selectedLotId).subscribe({
      next: (histories: IoTMonitoringHistory[]) => this.applyBatchHistory(histories),
      error: (err) => {
        console.error('[IoT Dashboard] Error refreshing batch history:', err);
        this.showSnackBar('IOT.MESSAGES.HISTORY_LOAD_ERROR', 'IOT.MESSAGES.CLOSE');
      },
    });
  }

  loadBatchHistory(batchId: number): void {
    this.isLoading = true;
    this.iotService.getHistoriesByBatch(batchId).subscribe({
      next: (histories: IoTMonitoringHistory[]) => {
        this.applyBatchHistory(histories);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('[IoT Dashboard] Error loading batch history:', err);
        this.isLoading = false;
        this.showSnackBar('IOT.MESSAGES.HISTORY_LOAD_ERROR', 'IOT.MESSAGES.CLOSE');
      },
    });
  }

  private applyBatchHistory(histories: IoTMonitoringHistory[]): void {
    this.readingHistory = histories;
    this.currentReading = histories.length > 0 ? histories[0] : null;
    this.lastUpdate = new Date();
    this.activeAlerts = [];

    if (this.currentReading) {
      if (this.currentReading.temperature < this.thresholds.minTemperature) {
        this.activeAlerts.push('IOT.ALERTS.TEMPERATURE_BELOW_MIN');
      } else if (this.currentReading.temperature > this.thresholds.maxTemperature) {
        this.activeAlerts.push('IOT.ALERTS.TEMPERATURE_ABOVE_MAX');
      }
      if (this.currentReading.humidity < this.thresholds.minHumidity) {
        this.activeAlerts.push('IOT.ALERTS.HUMIDITY_BELOW_MIN');
      } else if (this.currentReading.humidity > this.thresholds.maxHumidity) {
        this.activeAlerts.push('IOT.ALERTS.HUMIDITY_ABOVE_MAX');
      }
    }

    this.environmentalStatus = '';
    this.dehumidifierStatus = '';
    if (this.chartReady) {
      setTimeout(() => this.renderChart(), 0);
    }
  }

  private toDatetimeLocalValue(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  private showSnackBar(messageKey: string, actionKey: string, duration = 4000): void {
    this.snackBar.open(
      this.translate.instant(messageKey),
      this.translate.instant(actionKey),
      { duration },
    );
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  goToHome(): void {
    const user = this.authService.getCurrentUser();
    if (!user) {
      void this.router.navigate(['/login']);
      return;
    }
    if (user.home) {
      void this.router.navigate([user.home]);
      return;
    }
    switch (user.plan) {
      case 'barista':
        void this.router.navigate(['/dashboard/barista']);
        break;
      case 'owner':
        void this.router.navigate(['/dashboard/owner']);
        break;
      case 'full':
        void this.router.navigate(['/dashboard/complete']);
        break;
      default:
        void this.router.navigate(['/']);
    }
  }
}
