import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { DictationState, ExamProfile, Folder } from './types'

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: () => api<{ items: Folder[] }>('/folders').then((r) => r.items) })
}

export function useExamProfiles() {
  return useQuery({
    queryKey: ['exam-profiles'],
    queryFn: () => api<{ items: ExamProfile[] }>('/exam-profiles').then((r) => r.items),
    staleTime: 5 * 60_000,
  })
}

/** Anything showing dictation cards must refresh after seen/favourite/folder/attempt changes. */
export function useInvalidateLibrary() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['dictations'] })
    void qc.invalidateQueries({ queryKey: ['dictation'] })
    void qc.invalidateQueries({ queryKey: ['sets'] })
    void qc.invalidateQueries({ queryKey: ['folders'] })
  }
}

export function useSetDictationState(dictationId: string) {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (body: { seen?: boolean; favourite?: boolean }) =>
      api<{ state: DictationState }>(`/dictations/${dictationId}/state`, { method: 'PUT', body }),
    onSuccess: invalidate,
  })
}

export function useSetDictationFolders(dictationId: string) {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (folderIds: string[]) =>
      api<{ state: DictationState }>(`/dictations/${dictationId}/folders`, { method: 'PUT', body: { folderIds } }),
    onSuccess: invalidate,
  })
}

export function useCreateFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api<{ folder: Folder }>('/folders', { method: 'POST', body: { name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['folders'] }),
  })
}
