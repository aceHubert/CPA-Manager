import { describe, expect, it, vi } from 'vitest';
import { resolveConfiguredUsageServiceBase } from './useUsageData';
import type { Config } from '@/types/config';

describe('resolveConfiguredUsageServiceBase', () => {
  it('配置尚未加载时先获取配置，再读取外部 Usage Service 地址', async () => {
    const fetchConfig = vi.fn<() => Promise<Config>>().mockResolvedValue({
      externalUsageService: {
        configured: true,
        serviceBase: 'http://127.0.0.1:18317',
      },
    });

    await expect(resolveConfiguredUsageServiceBase(null, fetchConfig)).resolves.toBe(
      'http://127.0.0.1:18317'
    );
    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });

  it('配置已加载时直接读取地址', async () => {
    const fetchConfig = vi.fn<() => Promise<Config>>();

    await expect(
      resolveConfiguredUsageServiceBase(
        {
          externalUsageService: {
            configured: true,
            serviceBase: 'http://usage.local:18317',
          },
        },
        fetchConfig
      )
    ).resolves.toBe('http://usage.local:18317');
    expect(fetchConfig).not.toHaveBeenCalled();
  });
});
