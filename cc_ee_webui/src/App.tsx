import { Routes, Route, Navigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { RootState } from './store'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'

function App() {
  const { isAuthenticated, isLoading } = useSelector((state: RootState) => state.auth)

  if (isLoading) {
    return null
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chat/:sessionId?"
        element={isAuthenticated ? <ChatPage /> : <Navigate to="/login" replace />}
      />
      <Route path="/" element={<Navigate to="/chat" replace />} />
    </Routes>
  )
}

export default App
