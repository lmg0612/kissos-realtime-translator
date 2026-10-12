import { useReducer } from 'react'
import {
  initialSessionState,
  sessionReducer,
} from './reducer'

export function useSessionStore() {
  return useReducer(sessionReducer, initialSessionState)
}
