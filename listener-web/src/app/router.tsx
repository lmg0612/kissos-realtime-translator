import { createBrowserRouter, Navigate } from 'react-router-dom'
import EntrancePage from '../pages/entrance/EntrancePage'
import SessionPage from '../pages/session/SessionPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/entrance" replace />,
  },
  {
    path: '/entrance',
    element: <EntrancePage />,
  },
  {
    path: '/session/:sessionId',
    element: <SessionPage />,
  },
  {
    path: '*',
    element: <Navigate to="/entrance" replace />,
  },
])
