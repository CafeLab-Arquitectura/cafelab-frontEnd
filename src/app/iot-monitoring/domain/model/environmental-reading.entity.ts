export interface ThresholdRange {
  minTemperature: number;
  maxTemperature: number;
  minHumidity: number;
  maxHumidity: number;
}

export interface EnvironmentThreshold extends ThresholdRange {
  id: number;
  coffeeLotId: number;
  syncIntervalSeconds: number;
}

export interface UpdateEnvironmentThresholdRequest extends ThresholdRange {
  coffeeLotId: number;
  syncIntervalSeconds: number;
}

export interface IoTMonitoringData {
  id: number;
  sensorConnected: boolean;
  dehumidifierConnected: boolean;
  minTemperature: number;
  maxTemperature: number;
  minHumidity: number;
  maxHumidity: number;
  userId: number;
}

export interface IoTMonitoringHistory {
  id: number;
  connectionState: boolean;
  temperature: number;
  humidity: number;
  iotMonitoringDataId: number;
  timestamp: string | Date;
}

/** Corresponds to IoTMonitoringDashboardResource on the backend */
export interface IoTMonitoringDashboard {
  monitoringData: IoTMonitoringData;
  currentReading: IoTMonitoringHistory | null;
  readingHistory: IoTMonitoringHistory[];
  sensorStatus: string;
  environmentalStatus: string;
  dehumidifierStatus: string;
  activeAlerts: string[];
}

