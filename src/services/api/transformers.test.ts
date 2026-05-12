import { describe, expect, it } from 'vitest';
import { normalizeConfigResponse } from './transformers';

describe('normalizeConfigResponse external usage service', () => {
  it('从 /config 结构化结果读取已配置的外部 Usage Service', () => {
    const config = normalizeConfigResponse({
      debug: false,
      'external-usage-service': {
        'base-url': 'http://127.0.0.1:18317/',
      },
    });

    expect(config.externalUsageService).toEqual({
      serviceBase: 'http://127.0.0.1:18317',
      configured: true,
    });
  });

  it('地址非空就视为启用，不需要 enabled 开关', () => {
    const config = normalizeConfigResponse({
      'external-usage-service': {
        enabled: false,
        'base-url': 'http://usage.local:18317',
      },
    });

    expect(config.externalUsageService).toEqual({
      serviceBase: 'http://usage.local:18317',
      configured: true,
    });
  });
});
