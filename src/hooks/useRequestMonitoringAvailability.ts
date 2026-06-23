import { useEffect, useState } from 'react';
import {
  isUsageServiceId,
  normalizeUsageServiceBase,
  usageServiceApi,
} from '@/services/api/usageService';
import { useAuthStore, useConfigStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';

export type RequestMonitoringUnavailableReason =
  | 'checking'
  | 'service_not_configured'
  | 'service_unavailable'
  | 'monitoring_disabled';

export interface RequestMonitoringAvailability {
  checking: boolean;
  available: boolean;
  serviceBase: string;
  reason: RequestMonitoringUnavailableReason | '';
}

export function useRequestMonitoringAvailability(): RequestMonitoringAvailability {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const [state, setState] = useState<RequestMonitoringAvailability>({
    checking: true,
    available: false,
    serviceBase: '',
    reason: 'checking',
  });

  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      const resolvedConfig = config ?? (await fetchConfig(undefined));
      const configuredBase =
        resolvedConfig.externalUsageService?.configured &&
        resolvedConfig.externalUsageService.serviceBase
          ? resolvedConfig.externalUsageService.serviceBase
          : '';
      const candidates = Array.from(
        new Set(
          [configuredBase, apiBase, detectApiBaseFromLocation()]
            .map((value) => normalizeUsageServiceBase(value || ''))
            .filter(Boolean)
        )
      );

      if (!managementKey || candidates.length === 0) {
        setState({
          checking: false,
          available: false,
          serviceBase: '',
          reason: 'service_not_configured',
        });
        return;
      }

      setState((current) => ({ ...current, checking: true, reason: 'checking' }));
      const hasConfiguredUsageService = Boolean(configuredBase);

      for (const candidate of candidates) {
        try {
          const info = await usageServiceApi.getInfo(candidate);
          if (!isUsageServiceId(info.service)) {
            continue;
          }
          const response = await usageServiceApi.getManagerConfig(candidate, managementKey);
          const collectorEnabled = response.config.collector?.enabled !== false;
          const hasCPAConnection = Boolean(
            response.config.cpaConnection?.cpaBaseUrl &&
              response.config.cpaConnection?.managementKey
          );
          if (cancelled) return;
          setState({
            checking: false,
            available: collectorEnabled && hasCPAConnection,
            serviceBase: candidate,
            reason: !collectorEnabled
              ? 'monitoring_disabled'
              : hasCPAConnection
                ? ''
                : 'service_not_configured',
          });
          return;
        } catch {
          // A regular CPA panel or an unreachable external Usage Service is handled below.
        }
      }

      if (cancelled) return;
      setState({
        checking: false,
        available: false,
        serviceBase: '',
        reason: hasConfiguredUsageService ? 'service_unavailable' : 'service_not_configured',
      });
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, [apiBase, config, fetchConfig, managementKey]);

  return state;
}
