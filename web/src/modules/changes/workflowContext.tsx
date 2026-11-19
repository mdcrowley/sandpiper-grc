import { createContext, useContext, type ReactNode } from 'react';
import { useFetch } from '../../core';
import type { Workflow } from './types';

interface WorkflowState {
  data: Workflow | undefined;
  error: unknown;
  reload: () => void;
}

const Ctx = createContext<WorkflowState>({ data: undefined, error: undefined, reload: () => {} });

/** Loads where one change stands (next moves, approvals, conflicts, review) once for the whole page. */
export function WorkflowProvider({ changeId, children }: { changeId: string | undefined; children: ReactNode }) {
  const { data, error, reload } = useFetch<Workflow>(changeId ? `/api/changes/${changeId}/workflow` : null);
  return <Ctx.Provider value={{ data: data ?? undefined, error, reload }}>{children}</Ctx.Provider>;
}

export const useWorkflow = (): WorkflowState => useContext(Ctx);
