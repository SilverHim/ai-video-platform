import { useEffect, useState } from 'react';
import type { HealthInfo } from '../../shared/api-contract';
import { api } from '../lib/api-client';

/** 每 10 秒探测一次本机服务 */
export function useHealth() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .health()
        .then((h) => alive && (setHealth(h), setOnline(true)))
        .catch(() => alive && setOnline(false));
    void tick();
    const id = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return { health, online };
}
