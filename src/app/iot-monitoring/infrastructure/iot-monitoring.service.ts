import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/infrastructure/AuthService';
import type {
  EnvironmentThreshold,
  IoTMonitoringDashboard,
  IoTMonitoringHistory,
  UpdateEnvironmentThresholdRequest,
} from '../domain/model/environmental-reading.entity';
import type { CoffeeLotSummary } from '../domain/model/coffee-lot-summary.model';

interface TelemetryRecordResponse {
  id: number;
  coffeeLotId: number;
  temperature: number;
  humidity: number;
  timestamp: string | Date;
}

/**
 * Servicio HTTP para el bounded context de IoT Monitoring.
 * Todos los endpoints requieren JWT autenticado; el backend resuelve el userId desde el token.
 */
@Injectable({
  providedIn: 'root',
})
export class IoTMonitoringService {
  private readonly baseUrl = environment.serverBaseUrl;

  private readonly httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
  };

  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService,
  ) { }

  /**
   * GET /api/v1/iot-monitoring/dashboard
   * Retorna dashboard completo: configuración, lectura actual, historial, estados y alertas.
   * @param limit Número máximo de entradas en el historial (default: 20)
   */
  getDashboard(limit = 20): Observable<IoTMonitoringDashboard> {
    const url = `${this.baseUrl}${environment.iotMonitoringDashboardEndpointPath}?limit=${limit}`;
    return this.http.get<IoTMonitoringDashboard>(url, this.httpOptions);
  }

  /**
   * GET /api/v1/environment-thresholds/coffee-lot/{coffeeLotId}
   * Retorna o crea con defaults los umbrales ambientales del lote.
   */
  getEnvironmentThreshold(coffeeLotId: number): Observable<EnvironmentThreshold> {
    const url = `${this.baseUrl}${environment.environmentThresholdsEndpointPath}/coffee-lot/${coffeeLotId}`;
    return this.http.get<EnvironmentThreshold>(url, this.httpOptions);
  }

  /**
   * PUT /api/v1/environment-thresholds/coffee-lot/{coffeeLotId}
   * Actualiza los umbrales ambientales que consume el edge.
   */
  updateEnvironmentThreshold(
    coffeeLotId: number,
    payload: UpdateEnvironmentThresholdRequest,
  ): Observable<EnvironmentThreshold> {
    const url = `${this.baseUrl}${environment.environmentThresholdsEndpointPath}/coffee-lot/${coffeeLotId}`;
    return this.http.put<EnvironmentThreshold>(url, payload, this.httpOptions);
  }

  /**
   * GET /api/v1/telemetry-records/coffee-lot/{coffeeLotId}
   * Retorna el historial real de lecturas ambientales enviadas por el edge.
   */
  getHistoriesByBatch(coffeeLotId: number): Observable<IoTMonitoringHistory[]> {
    const url = `${this.baseUrl}${environment.telemetryRecordsEndpointPath}/coffee-lot/${coffeeLotId}`;
    return this.http.get<TelemetryRecordResponse[]>(url, this.httpOptions).pipe(
      map((records) =>
        (Array.isArray(records) ? records : [])
          .map((record) => ({
            id: Number(record.id),
            connectionState: true,
            temperature: Number(record.temperature),
            humidity: Number(record.humidity),
            iotMonitoringDataId: 0,
            timestamp: record.timestamp,
          }))
          .reverse()
          .slice(0, 10)
      )
    );
  }

  /**
   * GET /api/v1/coffee-lots/user/{userId}
   * Fetches the authenticated user's coffee lots for the lot selector.
   * Owned by the IoT module to avoid cross-module dependencies.
   */
  getCoffeeLots(): Observable<CoffeeLotSummary[]> {
    const userId = Number(this.authService.getCurrentUserId());
    if (!userId || Number.isNaN(userId)) {
      return throwError(() => new Error('No hay un usuario autenticado para cargar lotes IoT.'));
    }
    const url = `${this.baseUrl}${environment.coffeeLotsEndpointPath}/user/${userId}`;
    return this.http.get<any[]>(url, this.httpOptions).pipe(
      map((arr) =>
        (Array.isArray(arr) ? arr : []).map((r) => ({
          id: Number(r.coffeeLotId ?? r.id ?? r.lotId ?? 0),
          lotName: String(r.lotName ?? r.lot_name ?? ''),
          coffeeType: String(r.coffeeType ?? r.coffee_type ?? ''),
          status: String(r.status ?? ''),
          weight: Number(r.weight ?? 0),
          origin: String(r.origin ?? ''),
        }))
      )
    );
  }
}
