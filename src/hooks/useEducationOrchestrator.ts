// ==========================================
// FILE: src/hooks/useEducationOrchestrator.ts
// ==========================================

import { useState, useCallback } from 'react';
import { StudentProfile, AutomationResult } from '../types/education';
import { NewWorldOrderEducationOrchestrator } from '../index';

export interface UseEducationOrchestratorState {
  isExecuting: boolean;
  auditTrail: AutomationResult[];
  error: string | null;
  completedSchoolsCount: number;
}

/**
 * Custom React Hook for managing state, trigger lifecycle, 
 * and asynchronous execution of the NWO Education & FAFSA Pipeline.
 */
export function useEducationOrchestrator() {
  const [state, setState] = useState<UseEducationOrchestratorState>({
    isExecuting: false,
    auditTrail: [],
    error: null,
    completedSchoolsCount: 0,
  });

  const orchestrator = new NewWorldOrderEducationOrchestrator();

  const runPipeline = useCallback(async (profile: StudentProfile) => {
    setState((prev) => ({ ...prev, isExecuting: true, error: null, auditTrail: [] }));

    try {
      const result = await orchestrator.runFullEducationPipeline(profile);
      setState({
        isExecuting: false,
        auditTrail: result.auditTrail,
        error: null,
        completedSchoolsCount: result.totalSchoolsProcessed,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown execution failure';
      setState((prev) => ({
        ...prev,
        isExecuting: false,
        error: errorMessage,
      }));
    }
  }, []);

  return {
    ...state,
    runPipeline,
  };
}
