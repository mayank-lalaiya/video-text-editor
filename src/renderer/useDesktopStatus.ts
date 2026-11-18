import { useCallback, useEffect, useRef, useState } from 'react';
import type { BootstrapData } from '../shared/contracts.ts';
import { loadBundledFonts } from './text/fonts.ts';
import { getDesktopApi } from './desktop.ts';

export interface DesktopStatus {
  phase: 'checking' | 'ready' | 'error';
  data: BootstrapData | null;
  errors: string[];
}

async function readDesktopStatus(): Promise<DesktopStatus> {
  try {
    const result = await getDesktopApi().getBootstrap();
    if (!result.ok) throw new Error(result.error);
    const resourceErrors = result.data.checks.some(
      (check) => check.status === 'error',
    );
    const errors: string[] = [];
    if (!resourceErrors) {
      try {
        await loadBundledFonts();
      } catch (error) {
        console.error('Bundled fonts could not be decoded.', error);
        errors.push(
          `The bundled fonts could not load: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return {
      phase: resourceErrors || errors.length > 0 ? 'error' : 'ready',
      data: result.data,
      errors,
    };
  } catch (error) {
    console.error('Desktop startup checks failed.', error);
    return {
      phase: 'error',
      data: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function useDesktopStatus() {
  const [status, setStatus] = useState<DesktopStatus>({
    phase: 'checking',
    data: null,
    errors: [],
  });
  const requestId = useRef(0);

  const check = useCallback(async () => {
    const currentRequest = ++requestId.current;
    const next = await readDesktopStatus();
    if (currentRequest === requestId.current) setStatus(next);
  }, []);

  const refresh = useCallback(() => {
    setStatus({ phase: 'checking', data: null, errors: [] });
    void check();
  }, [check]);

  useEffect(() => {
    void check();
    return () => {
      requestId.current += 1;
    };
  }, [check]);

  return { status, refresh };
}
