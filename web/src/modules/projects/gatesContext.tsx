import { createContext, useContext, type ReactNode } from 'react';
import { useFetch } from '../../core';
import type { ProjectGates } from './types';

interface GatesState {
  data: ProjectGates | undefined;
  error: unknown;
  reload: () => void;
}

const Ctx = createContext<GatesState | null>(null);

/** One fetch of a project's gates, shared by the stepper in the header and the Gate tab. */
export function GatesProvider({ projectId, children }: { projectId: string | undefined; children: ReactNode }) {
  const { data, error, reload } = useFetch<ProjectGates>(projectId ? `/api/projects/${projectId}/gates` : null);
  return <Ctx.Provider value={{ data: data ?? undefined, error, reload }}>{children}</Ctx.Provider>;
}

export function useGates(): GatesState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useGates must be used inside GatesProvider');
  return value;
}
