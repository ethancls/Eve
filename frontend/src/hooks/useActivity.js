import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export function useActivity(limit = 50) {
  return useQuery({
    queryKey: ['activity', limit],
    queryFn: () => api.getActivity(limit),
    refetchInterval: 15000,
  })
}
